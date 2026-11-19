select fonte_id, nome_fonte, renovavel
from {{ ref('fontes') }}
