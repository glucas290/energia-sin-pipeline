{{
    config(
        materialized='incremental',
        incremental_strategy='delete+insert',
        unique_key='arquivo_origem',
    )
}}

{#
  Incremental por arquivo: só lê os CSVs que a ingestão baixou desde o último build e
  substitui todas as linhas desses arquivos. Como o ONS regrava meses inteiros, o
  arquivo é a unidade natural de reprocessamento.
#}

{% set colunas = [
    'din_instante', 'id_subsistema', 'id_estado', 'cod_modalidadeoperacao', 'nom_tipousina',
    'nom_tipocombustivel', 'nom_usina', 'id_ons', 'ceg', 'val_geracao'
] %}

with origem as (
    {{ ler_bronze(arquivos_alterados('geracao'), colunas) }}
),

tipado as (
    select
        parse_filename(o.filename) as arquivo_origem,
        m.baixado_em,
        try_cast(o.din_instante as timestamp) as instante,
        trim(o.id_subsistema) as subsistema_id,
        trim(o.id_estado) as uf,
        trim(o.cod_modalidadeoperacao) as modalidade_operacao,
        trim(o.nom_tipousina) as tipo_usina,
        trim(o.nom_tipocombustivel) as combustivel,
        trim(o.nom_usina) as nome_usina,
        nullif(trim(o.id_ons), '') as id_ons,
        nullif(nullif(trim(o.ceg), ''), '-') as ceg,
        try_cast(o.val_geracao as double) as geracao_mwmed,
        o.din_instante as din_instante_bruto,
        o.val_geracao as valor_bruto
    from origem o
    left join {{ source('controle', 'manifesto') }} m
        on m.fonte = 'geracao' and parse_filename(m.caminho_local) = parse_filename(o.filename)
)

select
    t.arquivo_origem,
    t.baixado_em,
    t.instante::date as data,
    hour(t.instante) as hora,
    -- Desde mai/2026 os agregados de pequenas usinas vêm sem id_ons e com outro nome
    -- (PQU ACRAC FOTOV MMGD → PQU ACRAC MMGD). O id antigo é reconstruível a partir do
    -- nome novo: PQU_<código>_<GD para MMGD | inicial do tipo para Tipo III>.
    coalesce(
        t.id_ons,
        case
            when t.nome_usina like 'PQU %' then
                'PQU_' || split_part(t.nome_usina, ' ', 2) || '_'
                || case when t.modalidade_operacao like '%MMGD%' then 'GD' else left(t.tipo_usina, 1) end
        end,
        t.nome_usina
    ) as chave_natural,
    t.id_ons,
    t.nome_usina,
    t.ceg,
    t.uf,
    t.subsistema_id,
    f.fonte_id,
    t.combustivel,
    t.modalidade_operacao,
    t.modalidade_operacao like 'Pequenas Usinas%' as agregado_pequenas_usinas,
    t.geracao_mwmed,
    case
        when t.instante is null then 'data inválida: ' || coalesce(t.din_instante_bruto, 'nula')
        when s.subsistema_id is null then 'subsistema desconhecido: ' || coalesce(t.subsistema_id, 'nulo')
        when f.fonte_id is null then 'tipo de usina desconhecido: ' || coalesce(t.tipo_usina, 'nulo')
        when t.nome_usina is null or t.nome_usina = '' then 'usina sem nome'
        -- nulo é permitido (usina sem medição na hora); texto não numérico não
        when t.geracao_mwmed is null and nullif(trim(t.valor_bruto), '') is not null
            then 'geração não numérica: ' || t.valor_bruto
        when t.geracao_mwmed < 0 then 'geração negativa'
    end as motivo_rejeicao,
    case when motivo_rejeicao is not null then to_json({
        din_instante: t.din_instante_bruto, subsistema: t.subsistema_id, tipo: t.tipo_usina,
        usina: t.nome_usina, id_ons: t.id_ons, valor: t.valor_bruto
    }) end as registro_bruto
from tipado t
left join {{ ref('subsistemas') }} s
    on s.subsistema_id = t.subsistema_id and s.pertence_sin
left join {{ ref('fontes') }} f
    on f.nom_tipousina = t.tipo_usina
