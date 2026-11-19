{#
  on-run-end: grava o resultado do build em controle.execucoes_dbt e o volume de linhas
  lidas, gravadas na silver e rejeitadas para a quarentena em controle.qualidade.
#}
{% macro registrar_execucao(results) %}
    {% if not execute %}{{ return('') }}{% endif %}

    {% set erros = results | selectattr('status', 'in', ['error', 'fail', 'runtime error']) | list %}
    {% set avisos = results | selectattr('status', 'equalto', 'warn') | list %}

    {% set sql %}
        create schema if not exists controle;

        create table if not exists controle.execucoes_dbt (
            invocation_id varchar primary key,
            comando       varchar,
            inicio        timestamptz,
            fim           timestamptz,
            status        varchar,
            nos           integer,
            erros         integer,
            avisos        integer,
            falhas        varchar[]
        );

        insert or replace into controle.execucoes_dbt values (
            '{{ invocation_id }}',
            '{{ flags.WHICH }}',
            '{{ run_started_at }}'::timestamptz,
            current_timestamp,
            '{{ "erro" if erros else "sucesso" }}',
            {{ results | length }},
            {{ erros | length }},
            {{ avisos | length }},
            [{% for r in erros %}'{{ r.node.name }}'{{ ', ' if not loop.last }}{% endfor %}]::varchar[]
        );
    {% endset %}
    {% do run_query(sql) %}

    {% set fontes = ['carga', 'geracao', 'intercambio', 'capacidade'] %}
    {% set existentes = [] %}
    {% for f in fontes %}
        {% set rel = adapter.get_relation(database=target.database, schema='silver', identifier='stg_' ~ f) %}
        {% if rel is not none %}{% do existentes.append((f, rel)) %}{% endif %}
    {% endfor %}

    {% if existentes %}
        {% set sql %}
            create table if not exists controle.qualidade (
                invocation_id     varchar,
                fonte             varchar,
                linhas_lidas      bigint,
                linhas_gravadas   bigint,
                linhas_rejeitadas bigint,
                registrado_em     timestamptz
            );

            delete from controle.qualidade where invocation_id = '{{ invocation_id }}';

            insert into controle.qualidade
            {% for f, rel in existentes %}
            select
                '{{ invocation_id }}', '{{ f }}', count(*),
                count(*) filter (where motivo_rejeicao is null),
                count(*) filter (where motivo_rejeicao is not null),
                current_timestamp
            from {{ rel }}
            {% if not loop.last %}union all{% endif %}
            {% endfor %};
        {% endset %}
        {% do run_query(sql) %}
    {% endif %}
{% endmacro %}
