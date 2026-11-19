from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pytest

from ingestao.fontes import FONTES
from ingestao.ingerir import contar_linhas, executar, precisa_baixar
from ingestao.s3 import ArquivoRemoto, parse_listagem

AGORA = datetime(2026, 11, 18, tzinfo=timezone.utc)


def remoto(chave: str, etag: str = "e1", conteudo: bytes = b"") -> ArquivoRemoto:
    return ArquivoRemoto(chave=chave, etag=etag, tamanho=len(conteudo), modificado_em=AGORA)


@pytest.mark.parametrize(
    "nome, esperado",
    [
        ("GERACAO_USINA-2_2021.csv", False),  # anual, antes do recorte
        ("GERACAO_USINA-2_2023_12.csv", False),
        ("GERACAO_USINA-2_2024_01.csv", True),
        ("GERACAO_USINA-2_2026_11.csv", True),
        ("GERACAO_USINA-2_2026_11.parquet", False),
        ("DicionarioDados_GeracaoPorUsina.json", False),
    ],
)
def test_escopo_geracao(nome, esperado):
    assert FONTES["geracao"].no_escopo(nome) is esperado


def test_escopo_sem_recorte():
    assert FONTES["carga"].no_escopo("CARGA_ENERGIA_2000.csv")
    assert not FONTES["carga"].no_escopo("CARGA_ENERGIA_2000.xlsx")


def test_precisa_baixar(tmp_path):
    arq = remoto("dataset/x/A.csv", etag="e1")
    local = tmp_path / "A.csv"

    assert precisa_baixar(arq, {}, local)  # nunca baixado
    local.write_text("x")
    assert not precisa_baixar(arq, {arq.chave: "e1"}, local)  # inalterado
    assert precisa_baixar(arq, {arq.chave: "e0"}, local)  # ONS regravou
    local.unlink()
    assert precisa_baixar(arq, {arq.chave: "e1"}, local)  # arquivo local sumiu


@pytest.mark.parametrize(
    "conteudo, linhas",
    [(b"a;b\n1;2\n3;4\n", 2), (b"a;b\n1;2\n3;4", 2), (b"a;b\n", 0), (b"", 0)],
)
def test_contar_linhas(tmp_path, conteudo, linhas):
    f = tmp_path / "f.csv"
    f.write_bytes(conteudo)
    assert contar_linhas(f) == linhas


def test_parse_listagem():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>true</IsTruncated>
  <Contents><Key>dataset/carga_energia_di/CARGA_ENERGIA_2026.csv</Key>
    <LastModified>2026-11-16T22:00:39.000Z</LastModified>
    <ETag>&quot;abc123&quot;</ETag><Size>52093</Size></Contents>
  <NextContinuationToken>tok</NextContinuationToken>
</ListBucketResult>"""
    arquivos, token = parse_listagem(xml)
    assert token == "tok"
    assert arquivos[0].nome == "CARGA_ENERGIA_2026.csv"
    assert arquivos[0].etag == "abc123"
    assert arquivos[0].tamanho == 52093


class ClienteFalso:
    def __init__(self, arquivos: dict[str, tuple[str, bytes]]):
        self.arquivos = arquivos  # chave -> (etag, conteudo)
        self.downloads = []

    def listar(self, prefixo):
        return [remoto(k, e, c) for k, (e, c) in self.arquivos.items() if k.startswith(prefixo)]

    def baixar(self, chave, destino: Path):
        self.downloads.append(chave)
        destino.parent.mkdir(parents=True, exist_ok=True)
        etag, conteudo = self.arquivos[chave]
        destino.write_bytes(conteudo)
        return etag


def test_execucao_incremental_e_idempotente(tmp_path):
    fonte = FONTES["carga"]
    chave_25 = fonte.prefixo + "CARGA_ENERGIA_2025.csv"
    chave_26 = fonte.prefixo + "CARGA_ENERGIA_2026.csv"
    cliente = ClienteFalso({chave_25: ("a", b"h\n1\n"), chave_26: ("b", b"h\n1\n2\n")})

    primeira = executar([fonte], cliente, tmp_path)
    assert primeira["baixados"] == 2 and primeira["linhas"] == 3

    segunda = executar([fonte], cliente, tmp_path)
    assert segunda["baixados"] == 0 and segunda["ignorados"] == 2

    cliente.arquivos[chave_26] = ("c", b"h\n1\n2\n3\n")  # ONS regravou 2026
    terceira = executar([fonte], cliente, tmp_path)
    assert terceira["baixados"] == 1
    assert cliente.downloads[-1] == chave_26

    con = duckdb.connect(str(tmp_path / "energia.duckdb"))
    assert con.execute("select count(*) from controle.manifesto").fetchone()[0] == 2
    assert con.execute("select etag, linhas from controle.manifesto where chave = ?", [chave_26]).fetchone() == ("c", 3)
    assert con.execute("select list(status) from controle.execucoes").fetchone()[0] == ["sucesso"] * 3


def test_execucao_com_erro_fica_registrada(tmp_path):
    class ClienteQuebrado(ClienteFalso):
        def baixar(self, chave, destino):
            raise ConnectionError("rede caiu")

    fonte = FONTES["carga"]
    cliente = ClienteQuebrado({fonte.prefixo + "CARGA_ENERGIA_2026.csv": ("a", b"h\n")})
    with pytest.raises(ConnectionError):
        executar([fonte], cliente, tmp_path)

    con = duckdb.connect(str(tmp_path / "energia.duckdb"))
    status, erro = con.execute("select status, erro from controle.execucoes").fetchone()
    assert status == "erro" and "rede caiu" in erro
    assert con.execute("select count(*) from controle.manifesto").fetchone()[0] == 0


class RespostaFalsa:
    def __init__(self, conteudo: bytes, content_length: int):
        self.conteudo = conteudo
        self.headers = {"ETag": '"x1"', "Content-Length": str(content_length)}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        yield self.conteudo


@pytest.mark.parametrize("content_length, completo", [(6, True), (100, False)])
def test_download_so_substitui_se_chegou_inteiro(tmp_path, content_length, completo):
    from ingestao.s3 import ClienteS3

    destino = tmp_path / "A.csv"
    destino.write_bytes(b"versao anterior")
    cliente = ClienteS3()
    cliente.sessao.get = lambda *a, **k: RespostaFalsa(b"h\n1\n2\n", content_length)

    if completo:
        assert cliente.baixar("dataset/x/A.csv", destino) == "x1"
        assert destino.read_bytes() == b"h\n1\n2\n"
    else:
        with pytest.raises(IOError):
            cliente.baixar("dataset/x/A.csv", destino)
        assert destino.read_bytes() == b"versao anterior"
    assert not (tmp_path / "A.csv.part").exists()
