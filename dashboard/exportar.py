"""Gera o dashboard estático em site/ a partir da camada gold.

Os filtros do dashboard rodam no navegador, então o dados.json leva os dados no menor
grão que ainda cabe numa página (dia × subsistema × fonte, mês × usina). Tabelas vão
em formato colunar, com datas como dias desde 2000-01-01 e categorias como índices,
para reduzir o tamanho.

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
ARQUIVOS_ESTATICOS = ["index.html", "app.js", "estilo.css"]

SUBSISTEMAS = ["N", "NE", "S", "SE"]
FONTES = ["hidraulica", "eolica", "solar", "termica", "nuclear"]
PARES = ["N-NE", "N-SE", "NE-SE", "S-SE"]
CATEGORIAS = {"s": SUBSISTEMAS, "f": FONTES, "p": PARES}

DIA = "(data - date '2000-01-01')"
MES = "((year(data) - 2000) * 12 + month(data) - 1)"

TABELAS = {
    "carga": f"""
        select {DIA} as d, subsistema_id as s, round(carga_mwmed, 1) as mwmed
        from gold.fato_carga order by d, s
    """,
    # desp = usinas despachadas (fora os agregados de pequenas usinas), que são as
    # que têm capacidade cadastrada; mmgd = geração distribuída
    "geracao": f"""
        select {DIA} as d, g.subsistema_id as s, g.fonte_id as f,
               round(sum(g.energia_mwh)) as mwh,
               round(coalesce(sum(g.energia_mwh) filter (where not u.agregado_pequenas_usinas), 0)) as desp,
               round(coalesce(sum(g.energia_mwh) filter (where u.modalidade_operacao like '%MMGD%'), 0)) as mmgd
        from gold.fato_geracao g join gold.dim_usina u using (usina_sk)
        group by all order by d, s, f
    """,
    "perfil": f"""
        select {MES} as m, subsistema_id as s, fonte_id as f, hora as h,
               round(sum(energia_mwh)) as mwh
        from gold.fato_geracao group by all order by m, s, f, h
    """,
    "intercambio": f"""
        select {DIA} as d, subsistema_origem_id || '-' || subsistema_destino_id as p,
               round(sum(energia_verificada_mwh)) as mwh
        from gold.fato_intercambio group by all order by d, p
    """,
    "capacidade": """
        select c.subsistema_id as s, c.fonte_id as f,
               c.data_entrada_operacao - date '2000-01-01' as ini,
               c.data_desativacao - date '2000-01-01' as fim,
               round(c.potencia_mw, 2) as mw
        from gold.fato_capacidade c
        join gold.dim_subsistema s on s.subsistema_id = c.subsistema_id and s.pertence_sin
    """,
    "usina_mes": f"""
        select u.idx as u, {MES} as m, round(sum(g.energia_mwh)) as mwh
        from gold.fato_geracao g
        join (select usina_sk, row_number() over (order by chave_natural) - 1 as idx
              from gold.dim_usina) u using (usina_sk)
        group by all order by u, m
    """,
}

LISTAS = {
    "usinas": """
        select nome_usina as nome, fonte_id as f, subsistema_id as s, uf,
               modalidade_operacao as modalidade, agregado_pequenas_usinas as agregado
        from gold.dim_usina order by chave_natural
    """,
    "fontes": "select fonte_id, nome_fonte, renovavel from gold.dim_fonte",
    "subsistemas": "select subsistema_id, nome_subsistema from gold.dim_subsistema where pertence_sin",
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
        select inicio, duracao_s, status,
               arquivos_baixados || ' de ' || arquivos_verificados || ' arquivos baixados' as detalhe
        from controle.execucoes order by inicio desc limit 5
    """,
}


def _valor(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def colunar(con, sql: str) -> dict[str, list]:
    cur = con.execute(sql)
    nomes = [c[0] for c in cur.description]
    colunas = {n: [] for n in nomes}
    for linha in cur.fetchall():
        for n, v in zip(nomes, linha):
            colunas[n].append(_valor(v))
    for n, valores in CATEGORIAS.items():
        if n in colunas:
            idx = {v: i for i, v in enumerate(valores)}
            colunas[n] = [idx[v] for v in colunas[n]]
    return colunas


def linhas(con, sql: str) -> list[dict]:
    cur = con.execute(sql)
    nomes = [c[0] for c in cur.description]
    return [dict(zip(nomes, map(_valor, r))) for r in cur.fetchall()]


def main() -> None:
    con = duckdb.connect(str(BANCO), read_only=True)
    dados = {
        "categorias": CATEGORIAS,
        **{nome: colunar(con, sql) for nome, sql in TABELAS.items()},
        **{nome: linhas(con, sql) for nome, sql in LISTAS.items()},
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    con.close()

    SAIDA.mkdir(exist_ok=True)
    (SAIDA / "dados.json").write_text(
        json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    for nome in ARQUIVOS_ESTATICOS:
        shutil.copy(Path(__file__).with_name(nome), SAIDA / nome)
    tamanho = (SAIDA / "dados.json").stat().st_size / 1e6
    print(f"site/ gerado: dados.json com {tamanho:.1f} MB")


if __name__ == "__main__":
    main()
