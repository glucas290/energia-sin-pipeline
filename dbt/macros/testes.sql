{% test chave_unica(model, colunas) %}
select {{ colunas | join(', ') }}, count(*) as ocorrencias
from {{ model }}
group by {{ colunas | join(', ') }}
having count(*) > 1
{% endtest %}


{# falha se a proporção de linhas em quarentena para a fonte passar do limite #}
{% test quarentena_abaixo_de(model, fonte, limite) %}
with totais as (
    select
        count(*) filter (where motivo_rejeicao is not null) as rejeitadas,
        count(*) as lidas
    from {{ ref('stg_' ~ fonte) }}
)
select *
from totais
where lidas > 0 and rejeitadas::double / lidas > {{ limite }}
{% endtest %}
