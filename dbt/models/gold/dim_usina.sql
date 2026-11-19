-- SCD tipo 1: atributos da aparição mais recente de cada usina
select
    md5(chave_natural) as usina_sk,
    chave_natural,
    arg_max(id_ons, data + make_time(hora, 0, 0)) as id_ons,
    arg_max(nome_usina, data + make_time(hora, 0, 0)) as nome_usina,
    arg_max(ceg, data + make_time(hora, 0, 0)) as ceg,
    arg_max(uf, data + make_time(hora, 0, 0)) as uf,
    arg_max(subsistema_id, data + make_time(hora, 0, 0)) as subsistema_id,
    arg_max(fonte_id, data + make_time(hora, 0, 0)) as fonte_id,
    arg_max(combustivel, data + make_time(hora, 0, 0)) as combustivel,
    arg_max(modalidade_operacao, data + make_time(hora, 0, 0)) as modalidade_operacao,
    bool_or(agregado_pequenas_usinas) as agregado_pequenas_usinas,
    min(data) as primeira_data,
    max(data) as ultima_data
from {{ ref('silver_geracao') }}
group by chave_natural
