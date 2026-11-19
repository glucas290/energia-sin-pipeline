select
    data,
    hora,
    md5(chave_natural) as usina_sk,
    subsistema_id,
    fonte_id,
    geracao_mwmed,
    geracao_mwmed as energia_mwh  -- intervalo de 1 h
from {{ ref('silver_geracao') }}
