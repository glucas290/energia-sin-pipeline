{% macro dados_dir() -%}
    {{ env_var('DADOS_DIR', '../data') }}
{%- endmacro %}


{#
  Lê CSVs da bronze com todas as colunas como texto; a tipagem é feita no modelo,
  com try_cast, para que valor inválido vire quarentena em vez de erro de leitura.
  Com lista vazia (execução incremental sem arquivo novo) devolve um select vazio
  com as mesmas colunas.
#}
{% macro ler_bronze(arquivos, colunas) -%}
    {%- if arquivos | length == 0 -%}
        select
        {%- for c in colunas %}
            null::varchar as {{ c }},
        {%- endfor %}
            null::varchar as filename
        where false
    {%- else -%}
        select {{ colunas | join(', ') }}, filename
        from read_csv(
            [{%- for a in arquivos -%}'{{ a }}'{{ ', ' if not loop.last }}{%- endfor -%}],
            delim = ';', header = true, all_varchar = true,
            union_by_name = true, filename = true
        )
    {%- endif -%}
{%- endmacro %}


{% macro arquivos_bronze(fonte) -%}
    {{ return([dados_dir() ~ '/bronze/' ~ fonte ~ '/*.csv']) }}
{%- endmacro %}


{#
  Arquivos da fonte baixados depois do último processamento registrado na tabela
  incremental. Na primeira execução (ou em --full-refresh) devolve o glob completo.
#}
{% macro arquivos_alterados(fonte) -%}
    {%- if not is_incremental() -%}
        {{ return(arquivos_bronze(fonte)) }}
    {%- endif -%}
    {%- if not execute -%}
        {{ return([]) }}
    {%- endif -%}
    {%- set sql -%}
        select caminho_local
        from {{ source('controle', 'manifesto') }}
        where fonte = '{{ fonte }}'
          and baixado_em > (select coalesce(max(baixado_em), timestamptz '1900-01-01') from {{ this }})
        order by caminho_local
    {%- endset -%}
    {%- set linhas = run_query(sql).columns[0].values() -%}
    {%- set arquivos = [] -%}
    {%- for c in linhas -%}
        {%- do arquivos.append(dados_dir() ~ '/' ~ c) -%}
    {%- endfor -%}
    {{ return(arquivos) }}
{%- endmacro %}
