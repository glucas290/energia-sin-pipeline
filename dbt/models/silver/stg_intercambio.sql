{% set colunas = [
    'din_instante', 'id_subsistema_origem', 'id_subsistema_destino',
    'val_intercambiomwmed', 'val_intercambioprogmwmed'
] %}

with origem as (
    {{ ler_bronze(arquivos_bronze('intercambio'), colunas) }}
),

tipado as (
    select
        parse_filename(filename) as arquivo_origem,
        try_cast(din_instante as timestamp) as instante,
        trim(id_subsistema_origem) as origem_publicada,
        trim(id_subsistema_destino) as destino_publicado,
        try_cast(val_intercambiomwmed as double) as verificado_publicado,
        try_cast(val_intercambioprogmwmed as double) as programado_publicado,
        din_instante as din_instante_bruto,
        val_intercambiomwmed as verificado_bruto,
        val_intercambioprogmwmed as programado_bruto
    from origem
),

-- Até 2025 cada par tem orientação fixa e o valor tem sinal; a partir de 2026 o ONS
-- inverte origem/destino conforme o fluxo e publica o verificado sempre positivo.
-- A orientação fixa (ordem alfabética: N→NE, N→SE, NE→SE, S→SE) é a mesma nas duas
-- convenções, então basta inverter o sinal quando a linha vem no sentido contrário.
orientado as (
    select
        *,
        least(origem_publicada, destino_publicado) as subsistema_origem_id,
        greatest(origem_publicada, destino_publicado) as subsistema_destino_id,
        case when origem_publicada <= destino_publicado then 1 else -1 end as sinal
    from tipado
)

select
    arquivo_origem,
    instante::date as data,
    hour(instante) as hora,
    subsistema_origem_id,
    subsistema_destino_id,
    verificado_publicado * sinal as intercambio_verificado_mwmed,
    programado_publicado * sinal as intercambio_programado_mwmed,
    case
        when instante is null then 'data inválida: ' || coalesce(din_instante_bruto, 'nula')
        when coalesce(subsistema_origem_id || '-' || subsistema_destino_id, '') not in ('N-NE', 'N-SE', 'NE-SE', 'S-SE')
            then 'par de subsistemas desconhecido: ' || coalesce(origem_publicada || '-' || destino_publicado, 'nulo')
        when verificado_publicado is null
            then 'intercâmbio verificado ausente ou não numérico: ' || coalesce(verificado_bruto, 'nulo')
        when nullif(trim(programado_bruto), '') is not null and programado_publicado is null
            then 'intercâmbio programado não numérico: ' || programado_bruto
    end as motivo_rejeicao,
    case when motivo_rejeicao is not null then to_json({
        din_instante: din_instante_bruto, origem: origem_publicada, destino: destino_publicado,
        verificado: verificado_bruto, programado: programado_bruto
    }) end as registro_bruto
from orientado
