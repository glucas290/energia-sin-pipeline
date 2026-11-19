select subsistema_id, nome_subsistema, pertence_sin
from {{ ref('subsistemas') }}
