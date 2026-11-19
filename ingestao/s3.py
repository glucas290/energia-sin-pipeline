import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BUCKET_URL = "https://ons-aws-prod-opendata.s3.amazonaws.com"
_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}


@dataclass(frozen=True)
class ArquivoRemoto:
    chave: str
    etag: str
    tamanho: int
    modificado_em: datetime

    @property
    def nome(self) -> str:
        return self.chave.rsplit("/", 1)[-1]


def parse_listagem(xml: str) -> tuple[list[ArquivoRemoto], str | None]:
    raiz = ET.fromstring(xml)
    arquivos = [
        ArquivoRemoto(
            chave=c.findtext("s3:Key", namespaces=_NS),
            etag=c.findtext("s3:ETag", namespaces=_NS).strip('"'),
            tamanho=int(c.findtext("s3:Size", namespaces=_NS)),
            modificado_em=datetime.fromisoformat(
                c.findtext("s3:LastModified", namespaces=_NS).replace("Z", "+00:00")
            ),
        )
        for c in raiz.findall("s3:Contents", _NS)
    ]
    token = raiz.findtext("s3:NextContinuationToken", namespaces=_NS)
    return arquivos, token


class ClienteS3:
    """Acesso anônimo ao bucket público do ONS, via API REST do S3."""

    def __init__(self, timeout: int = 60):
        self.timeout = timeout
        self.sessao = requests.Session()
        retry = Retry(total=5, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504])
        self.sessao.mount("https://", HTTPAdapter(max_retries=retry))

    def listar(self, prefixo: str) -> list[ArquivoRemoto]:
        arquivos, token = [], None
        while True:
            params = {"list-type": "2", "prefix": prefixo}
            if token:
                params["continuation-token"] = token
            r = self.sessao.get(BUCKET_URL, params=params, timeout=self.timeout)
            r.raise_for_status()
            pagina, token = parse_listagem(r.text)
            arquivos.extend(pagina)
            if not token:
                return arquivos

    def baixar(self, chave: str, destino: Path) -> str:
        """Baixa para um .part e só renomeia se o arquivo chegou inteiro. Devolve o ETag servido."""
        destino.parent.mkdir(parents=True, exist_ok=True)
        temporario = destino.with_name(destino.name + ".part")
        try:
            with self.sessao.get(f"{BUCKET_URL}/{chave}", stream=True, timeout=self.timeout) as r:
                r.raise_for_status()
                # o arquivo pode ter sido regravado entre a listagem e o download;
                # o ETag da resposta é o que corresponde ao conteúdo baixado
                etag = r.headers.get("ETag", "").strip('"')
                esperado = int(r.headers["Content-Length"])
                with open(temporario, "wb") as f:
                    for bloco in r.iter_content(chunk_size=1024 * 1024):
                        f.write(bloco)
            recebido = temporario.stat().st_size
            if recebido != esperado:
                raise IOError(f"{chave}: recebidos {recebido} bytes, esperados {esperado}")
            temporario.replace(destino)
            return etag
        finally:
            temporario.unlink(missing_ok=True)
