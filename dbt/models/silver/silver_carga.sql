{{ config(materialized='view') }}

select * exclude (motivo_rejeicao, registro_bruto)
from {{ ref('stg_carga') }}
where motivo_rejeicao is null
