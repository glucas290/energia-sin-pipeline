select
    data,
    hora,
    subsistema_origem_id,
    subsistema_destino_id,
    intercambio_verificado_mwmed,
    intercambio_programado_mwmed,
    intercambio_verificado_mwmed as energia_verificada_mwh  -- intervalo de 1 h
from {{ ref('silver_intercambio') }}
