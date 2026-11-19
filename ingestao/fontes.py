import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Fonte:
    nome: str
    prefixo: str
    padrao: re.Pattern
    # (ano, mes) mínimo a ingerir; None = histórico completo
    inicio: tuple[int, int] | None = None

    def no_escopo(self, nome_arquivo: str) -> bool:
        m = self.padrao.fullmatch(nome_arquivo)
        if not m:
            return False
        if self.inicio is None:
            return True
        ano = int(m["ano"])
        # arquivo anual (geração até 2021) conta como dezembro daquele ano
        mes = int(m["mes"]) if m.groupdict().get("mes") else 12
        return (ano, mes) >= self.inicio


FONTES = {
    f.nome: f
    for f in [
        Fonte(
            nome="carga",
            prefixo="dataset/carga_energia_di/",
            padrao=re.compile(r"CARGA_ENERGIA_(?P<ano>\d{4})\.csv"),
        ),
        Fonte(
            nome="geracao",
            prefixo="dataset/geracao_usina_2_ho/",
            padrao=re.compile(r"GERACAO_USINA-2_(?P<ano>\d{4})(?:_(?P<mes>\d{2}))?\.csv"),
            # a geração horária completa passa de 11 GB; no MVP fico com os anos recentes
            inicio=(2024, 1),
        ),
        Fonte(
            nome="intercambio",
            prefixo="dataset/intercambio_nacional_ho/",
            padrao=re.compile(r"INTERCAMBIO_NACIONAL_(?P<ano>\d{4})\.csv"),
        ),
        Fonte(
            nome="capacidade",
            prefixo="dataset/capacidade-geracao/",
            padrao=re.compile(r"CAPACIDADE_GERACAO\.csv"),
        ),
    ]
}
