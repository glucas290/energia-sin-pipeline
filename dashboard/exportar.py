"""Gera o dashboard estático em site/ a partir da camada gold.

Uso: python -m dashboard.exportar
"""

import json
import shutil
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb

RAIZ = Path(__file__).resolve().parents[1]
BANCO = RAIZ / "data" / "energia.duckdb"
SAIDA = RAIZ / "site"

# meses incompletos distorcem séries mensais; ficam só os meses fechados
MES_FECHADO = "ano_mes < (select strftime(max(data), '%Y-%m') from gold.fato_geracao)"

CONSULTAS = {
    "kpis": """
        with ultimo as (select max(data) as d from gold.fato_geracao)
        select
            (select max(data) from gold.fato_carga) as carga_ate,
            (select d from ultimo) as geracao_ate,
            (select avg(gw) from (
                select data, sum(carga_mwmed) / 1000 as gw from gold.fato_carga
                where data > (select max(data) from gold.fato_carga) - 30 group by data)
            ) as carga_30d_gw,
            (select sum(g.energia_mwh) filter (where f.renovavel) / sum(g.energia_mwh)
             from gold.fato_geracao g join gold.dim_fonte f using (fonte_id)
             where g.data > (select d from ultimo) - 365) as renovavel_12m,
            (select sum(g.energia_mwh) filter (where u.modalidade_operacao like '%MMGD%') / sum(g.energia_mwh)
             from gold.fato_geracao g join gold.dim_usina u using (usina_sk)
             where g.fonte_id = 'solar' and g.data > (select d from ultimo) - 365) as mmgd_na_solar_12m,
            (select sum(c.potencia_mw) / 1000 from gold.fato_capacidade c
             join gold.dim_subsistema s using (subsistema_id)
             where s.pertence_sin and c.data_desativacao is null) as capacidade_gw
    """,
    "geracao_mensal": f"""
        select d.ano_mes, g.fonte_id, sum(g.energia_mwh) / 1e6 as twh
        from gold.fato_geracao g join gold.dim_data d using (data)
        where {MES_FECHADO}
        group by all order by 1, 2
    """,
    "carga_diaria": """
        select data, sum(carga_mwmed) / 1000 as gw
        from gold.fato_carga group by data order by data
    """,
    "carga_anual": """
        select d.ano, c.subsistema_id, sum(c.energia_mwh) / 1e6 as twh
        from gold.fato_carga c join gold.dim_data d using (data)
        where d.ano < year((select max(data) from gold.fato_carga))
        group by all order by 1, 2
    """,
    "perfil_horario": """
        with por_hora as (
            select data, hora, fonte_id, sum(geracao_mwmed) / 1000 as gw
            from gold.fato_geracao
            where data > (select max(data) from gold.fato_geracao) - 30
            group by all
        )
        select hora, fonte_id, avg(gw) as gw from por_hora group by all order by 1, 2
    """,
    "capacidade_mensal": """
        with meses as (
            select last_day(data) as fim_mes, any_value(ano_mes) as ano_mes
            from gold.dim_data where data <= current_date group by 1
        )
        select m.ano_mes, c.fonte_id, sum(c.potencia_mw) / 1000 as gw
        from meses m
        join gold.fato_capacidade c
            on c.data_entrada_operacao <= m.fim_mes
           and (c.data_desativacao is null or c.data_desativacao > m.fim_mes)
        join gold.dim_subsistema s on s.subsistema_id = c.subsistema_id and s.pertence_sin
        group by all order by 1, 2
    """,
    # A capacidade publicada não inclui a geração distribuída (MMGD) nem os demais
    # agregados de pequenas usinas; eles ficam fora do numerador para o fator fazer sentido.
    "fator_capacidade": f"""
        with ger as (
            select d.ano_mes, last_day(min(g.data)) as fim_mes, g.fonte_id,
                   sum(g.energia_mwh) / (count(distinct (g.data, g.hora))) as mwmed
            from gold.fato_geracao g
            join gold.dim_data d using (data)
            join gold.dim_usina u using (usina_sk)
            where not u.agregado_pequenas_usinas and {MES_FECHADO}
            group by d.ano_mes, g.fonte_id
        ),
        cap as (
            select ger.ano_mes, ger.fonte_id, sum(c.potencia_mw) as mw
            from ger
            join gold.fato_capacidade c
                on c.fonte_id = ger.fonte_id
               and c.data_entrada_operacao <= ger.fim_mes
               and (c.data_desativacao is null or c.data_desativacao > ger.fim_mes)
            join gold.dim_subsistema s on s.subsistema_id = c.subsistema_id and s.pertence_sin
            group by all
        )
        select ger.ano_mes, ger.fonte_id, ger.mwmed / cap.mw as fator
        from ger join cap using (ano_mes, fonte_id)
        order by 1, 2
    """,
    "intercambio_mensal": f"""
        select d.ano_mes, i.subsistema_origem_id || '→' || i.subsistema_destino_id as par,
               sum(i.energia_verificada_mwh) / 1e6 as twh
        from gold.fato_intercambio i join gold.dim_data d using (data)
        where d.ano >= 2024 and {MES_FECHADO}
        group by all order by 1, 2
    """,
    "quarentena": """
        select fonte, regexp_replace(motivo_rejeicao, ':.*', '') as motivo, count(*) as linhas
        from silver.quarentena group by all order by 1, 3 desc
    """,
    "qualidade": """
        select fonte, linhas_lidas, linhas_gravadas, linhas_rejeitadas
        from controle.qualidade
        where invocation_id = (
            select invocation_id from controle.qualidade order by registrado_em desc limit 1)
        order by fonte
    """,
    "execucoes": """
        select 'ingestão' as etapa, inicio, duracao_s, status,
               arquivos_baixados || ' de ' || arquivos_verificados || ' arquivos baixados' as detalhe
        from controle.execucoes order by inicio desc limit 5
    """,
    "fontes": "select fonte_id, nome_fonte, renovavel from gold.dim_fonte",
}


def _serializar(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, float):
        return round(v, 4)
    return v


def consultar(con, sql: str) -> list[dict]:
    cur = con.execute(sql)
    colunas = [c[0] for c in cur.description]
    return [dict(zip(colunas, map(_serializar, linha))) for linha in cur.fetchall()]


def main() -> None:
    con = duckdb.connect(str(BANCO), read_only=True)
    dados = {nome: consultar(con, sql) for nome, sql in CONSULTAS.items()}
    dados["kpis"] = dados["kpis"][0]
    dados["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    con.close()

    SAIDA.mkdir(exist_ok=True)
    (SAIDA / "dados.json").write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    shutil.copy(Path(__file__).with_name("index.html"), SAIDA / "index.html")
    tamanho = (SAIDA / "dados.json").stat().st_size / 1024
    print(f"site/ gerado: dados.json com {tamanho:.0f} KB")


if __name__ == "__main__":
    main()
