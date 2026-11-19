{% set colunas = ['id_subsistema', 'nom_subsistema', 'din_instante', 'val_cargaenergiamwmed'] %}

with origem as (
    {{ ler_bronze(arquivos_bronze('carga'), colunas) }}
),

tipado as (
    select
        parse_filename(filename) as arquivo_origem,
        -- alguns anos trazem só a data, outros data e hora
        try_cast(din_instante as timestamp)::date as data,
        trim(id_subsistema) as subsistema_id,
        try_cast(val_cargaenergiamwmed as double) as carga_mwmed,
        din_instante as din_instante_bruto,
        val_cargaenergiamwmed as valor_bruto
    from origem
)

select
    t.arquivo_origem,
    t.data,
    t.subsistema_id,
    t.carga_mwmed,
    case
        when t.data is null then 'data inválida: ' || coalesce(t.din_instante_bruto, 'nula')
        when s.subsistema_id is null then 'subsistema desconhecido: ' || coalesce(t.subsistema_id, 'nulo')
        when t.carga_mwmed is null then 'carga ausente ou não numérica: ' || coalesce(t.valor_bruto, 'nula')
        when t.carga_mwmed < 0 then 'carga negativa'
    end as motivo_rejeicao,
    case when motivo_rejeicao is not null then to_json({
        subsistema: t.subsistema_id, din_instante: t.din_instante_bruto, valor: t.valor_bruto
    }) end as registro_bruto
from tipado t
left join {{ ref('subsistemas') }} s
    on s.subsistema_id = t.subsistema_id and s.pertence_sin
