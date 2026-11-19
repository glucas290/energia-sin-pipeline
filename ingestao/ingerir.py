"""Ingestão da camada bronze: copia os CSVs do ONS que são novos ou mudaram.

Uso: python -m ingestao.ingerir [--fontes carga geracao ...]
"""

import argparse
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from ingestao.fontes import FONTES, Fonte
from ingestao.s3 import ArquivoRemoto, ClienteS3

RAIZ_DADOS = Path(__file__).resolve().parents[1] / "data"

log = logging.getLogger("ingestao")

DDL = """
create schema if not exists controle;

create table if not exists controle.manifesto (
    chave          varchar primary key,
    fonte          varchar not null,
    etag           varchar not null,
    tamanho_bytes  bigint not null,
    linhas         bigint not null,
    modificado_em  timestamptz not null,
    caminho_local  varchar not null,
    baixado_em     timestamptz not null
);

create table if not exists controle.execucoes (
    execucao_id          varchar primary key,
    inicio               timestamptz not null,
    fim                  timestamptz,
    duracao_s            double,
    status               varchar not null,
    fontes               varchar[] not null,
    arquivos_verificados integer,
    arquivos_baixados    integer,
    arquivos_ignorados   integer,
    bytes_baixados       bigint,
    linhas_baixadas      bigint,
    erro                 varchar
);
"""


def precisa_baixar(remoto: ArquivoRemoto, manifesto: dict[str, str], caminho: Path) -> bool:
    return manifesto.get(remoto.chave) != remoto.etag or not caminho.exists()


def contar_linhas(caminho: Path) -> int:
    """Linhas de dados, sem o cabeçalho."""
    n, ultimo = 0, b"\n"
    with open(caminho, "rb") as f:
        while bloco := f.read(1024 * 1024):
            n += bloco.count(b"\n")
            ultimo = bloco[-1:]
    if ultimo != b"\n":
        n += 1  # última linha sem quebra no final
    return max(n - 1, 0)


def caminho_bronze(raiz: Path, fonte: Fonte, remoto: ArquivoRemoto) -> Path:
    return raiz / "bronze" / fonte.nome / remoto.nome


def executar(fontes: list[Fonte], cliente, raiz: Path = RAIZ_DADOS) -> dict:
    raiz.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(raiz / "energia.duckdb"))
    con.execute(DDL)

    execucao_id = str(uuid.uuid4())
    inicio = datetime.now(timezone.utc)
    t0 = time.monotonic()
    con.execute(
        "insert into controle.execucoes (execucao_id, inicio, status, fontes) values (?, ?, 'executando', ?)",
        [execucao_id, inicio, [f.nome for f in fontes]],
    )
    stats = dict(verificados=0, baixados=0, ignorados=0, bytes=0, linhas=0)
    status, erro = "sucesso", None

    try:
        manifesto = dict(con.execute("select chave, etag from controle.manifesto").fetchall())
        for fonte in fontes:
            remotos = [r for r in cliente.listar(fonte.prefixo) if fonte.no_escopo(r.nome)]
            log.info("%s: %d arquivos no escopo", fonte.nome, len(remotos))
            for remoto in remotos:
                stats["verificados"] += 1
                destino = caminho_bronze(raiz, fonte, remoto)
                if not precisa_baixar(remoto, manifesto, destino):
                    stats["ignorados"] += 1
                    continue

                etag = cliente.baixar(remoto.chave, destino) or remoto.etag
                tamanho = destino.stat().st_size
                linhas = contar_linhas(destino)
                # grava o manifesto arquivo a arquivo: se a execução cair no meio,
                # o que já foi baixado não é baixado de novo
                con.execute(
                    "insert or replace into controle.manifesto values (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        remoto.chave, fonte.nome, etag, tamanho, linhas, remoto.modificado_em,
                        str(destino.relative_to(raiz).as_posix()), datetime.now(timezone.utc),
                    ],
                )
                stats["baixados"] += 1
                stats["bytes"] += tamanho
                stats["linhas"] += linhas
                log.info("  baixado %s (%.1f MB, %d linhas)", remoto.nome, tamanho / 1e6, linhas)
    except Exception as e:
        status, erro = "erro", f"{type(e).__name__}: {e}"
        raise
    finally:
        con.execute(
            """
            update controle.execucoes set
                fim = ?, duracao_s = ?, status = ?, arquivos_verificados = ?,
                arquivos_baixados = ?, arquivos_ignorados = ?, bytes_baixados = ?,
                linhas_baixadas = ?, erro = ?
            where execucao_id = ?
            """,
            [
                datetime.now(timezone.utc), round(time.monotonic() - t0, 1), status,
                stats["verificados"], stats["baixados"], stats["ignorados"],
                stats["bytes"], stats["linhas"], erro, execucao_id,
            ],
        )
        con.close()
        log.info("execução %s: %s %s", execucao_id[:8], status, stats)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fontes", nargs="+", choices=list(FONTES), default=list(FONTES))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    executar([FONTES[n] for n in args.fontes], ClienteS3())


if __name__ == "__main__":
    main()
