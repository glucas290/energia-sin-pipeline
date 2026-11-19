select
    data,
    subsistema_id,
    carga_mwmed,
    -- MWmed é média do dia; energia é aditiva
    carga_mwmed * 24 as energia_mwh
from {{ ref('silver_carga') }}
