{% set colunas = [
    'id_subsistema', 'id_estado', 'nom_tipousina', 'nom_usina', 'ceg', 'cod_equipamento',
    'nom_combustivel', 'dat_entradaoperacao', 'dat_desativacao', 'val_potenciaefetiva'
] %}

with origem as (
    {{ ler_bronze(arquivos_bronze('capacidade'), colunas) }}
),

tipado as (
    select
        parse_filename(filename) as arquivo_origem,
        trim(cod_equipamento) as cod_equipamento,
        trim(id_subsistema) as subsistema_id,
        trim(id_estado) as uf,
        trim(nom_tipousina) as tipo_usina,
        trim(nom_usina) as nome_usina,
        nullif(trim(ceg), '') as ceg,
        trim(nom_combustivel) as combustivel,
        try_cast(dat_entradaoperacao as date) as data_entrada_operacao,
        try_cast(dat_desativacao as date) as data_desativacao,
        try_cast(val_potenciaefetiva as double) as potencia_mw,
        dat_entradaoperacao as entrada_bruta,
        nullif(trim(dat_desativacao), '') as desativacao_bruta,
        val_potenciaefetiva as potencia_bruta
    from origem
)

select
    t.arquivo_origem,
    t.cod_equipamento,
    t.subsistema_id,
    f.fonte_id,
    t.uf,
    t.nome_usina,
    t.ceg,
    t.combustivel,
    t.data_entrada_operacao,
    t.data_desativacao,
    t.potencia_mw,
    case
        when coalesce(t.cod_equipamento, '') = '' then 'unidade sem código de equipamento'
        when s.subsistema_id is null then 'subsistema desconhecido: ' || coalesce(t.subsistema_id, 'nulo')
        when f.fonte_id is null then 'tipo de usina desconhecido: ' || coalesce(t.tipo_usina, 'nulo')
        when t.data_entrada_operacao is null
            then 'data de entrada em operação inválida: ' || coalesce(t.entrada_bruta, 'nula')
        when t.desativacao_bruta is not null and t.data_desativacao is null
            then 'data de desativação inválida: ' || t.desativacao_bruta
        when t.data_desativacao < t.data_entrada_operacao then 'desativação anterior à entrada em operação'
        when coalesce(t.potencia_mw, 0) <= 0
            then 'potência ausente ou não positiva: ' || coalesce(t.potencia_bruta, 'nula')
    end as motivo_rejeicao,
    case when motivo_rejeicao is not null then to_json({
        cod_equipamento: t.cod_equipamento, usina: t.nome_usina, entrada: t.entrada_bruta,
        desativacao: t.desativacao_bruta, potencia: t.potencia_bruta
    }) end as registro_bruto
from tipado t
left join {{ ref('subsistemas') }} s
    on s.subsistema_id = t.subsistema_id
left join {{ ref('fontes') }} f
    on f.nom_tipousina = t.tipo_usina
