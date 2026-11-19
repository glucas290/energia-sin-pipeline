{% set fontes = ['carga', 'geracao', 'intercambio', 'capacidade'] %}

{% for f in fontes %}
select
    '{{ f }}' as fonte,
    arquivo_origem,
    motivo_rejeicao,
    registro_bruto,
    current_timestamp as detectado_em
from {{ ref('stg_' ~ f) }}
where motivo_rejeicao is not null
{% if not loop.last %}union all{% endif %}
{% endfor %}
