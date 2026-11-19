select
    cod_equipamento,
    subsistema_id,
    fonte_id,
    uf,
    ceg,
    nome_usina,
    data_entrada_operacao,
    data_desativacao,
    potencia_mw
from {{ ref('silver_capacidade') }}
