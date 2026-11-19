"""Gera docs/dicionario_dados.md a partir das descrições e tipos do dbt.

Requer `dbt docs generate` antes (lê target/manifest.json e target/catalog.json).
Uso: python scripts/gerar_dicionario.py
"""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
TARGET = RAIZ / "dbt" / "target"
SAIDA = RAIZ / "docs" / "dicionario_dados.md"

ORDEM = [
    "fato_carga", "fato_geracao", "fato_intercambio", "fato_capacidade",
    "dim_data", "dim_subsistema", "dim_fonte", "dim_usina",
]


def main() -> None:
    manifest = json.loads((TARGET / "manifest.json").read_text(encoding="utf-8"))
    catalog = json.loads((TARGET / "catalog.json").read_text(encoding="utf-8"))

    modelos = {
        n["name"]: n for n in manifest["nodes"].values()
        if n["resource_type"] == "model" and n["schema"] == "gold"
    }
    tipos = {
        n["metadata"]["name"]: {c.lower(): v["type"].lower() for c, v in n["columns"].items()}
        for n in catalog["nodes"].values() if n["metadata"]["schema"] == "gold"
    }

    linhas = [
        "# Dicionário de dados",
        "",
        "Tabelas da camada gold (schema `gold` em `data/energia.duckdb`). Gerado por",
        "`scripts/gerar_dicionario.py` a partir das descrições em `dbt/models/gold/_gold.yml`;",
        "não editar à mão.",
        "",
    ]
    for nome in ORDEM:
        m = modelos[nome]
        linhas += [f"## {nome}", "", " ".join(m["description"].split()), "",
                   "| Coluna | Tipo | Descrição |", "| --- | --- | --- |"]
        for col, tipo in tipos[nome].items():
            desc = m["columns"].get(col, {}).get("description", "")
            linhas.append(f"| `{col}` | {tipo} | {' '.join(desc.split())} |")
        linhas.append("")

    SAIDA.write_text("\n".join(linhas), encoding="utf-8")
    print(f"{SAIDA.relative_to(RAIZ)} gerado com {len(ORDEM)} tabelas")


if __name__ == "__main__":
    main()
