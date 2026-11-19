# energia-sin-pipeline

Pipeline de dados do setor elétrico brasileiro, construído com ferramentas abertas e gratuitas.

Coleta os dados abertos do ONS (Operador Nacional do Sistema Elétrico), organiza em camadas
(bronze, silver, gold) e entrega um modelo dimensional pronto para análise.

> **Status:** em construção. Fases 0 a 3 concluídas (ambiente, exploração das fontes, modelo de dados e ingestão).

## Stack

| Etapa | Ferramenta |
| --- | --- |
| Ingestão | Python (requests, pandas) |
| Armazenamento e processamento | DuckDB + Parquet |
| Transformação e testes de qualidade | dbt (dbt-duckdb) |
| Orquestração | GitHub Actions |

## Estrutura

```text
energia-sin-pipeline/
├── ingestao/     # scripts Python que baixam os dados do ONS (camada bronze)
├── tests/        # testes da ingestão (pytest)
├── dbt/          # projeto dbt: camadas silver e gold, testes de qualidade
├── docs/         # arquitetura, dicionário de dados, decisões técnicas
└── requirements.txt
```

## Como rodar localmente

Requer Python 3.11 ou superior.

```bash
git clone https://github.com/glucas290/energia-sin-pipeline.git
cd energia-sin-pipeline
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt

# baixa para data/bronze/ o que é novo ou mudou no bucket do ONS
python -m ingestao.ingerir
python -m ingestao.ingerir --fontes carga intercambio   # só algumas fontes

python -m pytest
```

A primeira execução baixa cerca de 2,4 GB (a geração horária desde jan/2024). As
seguintes baixam só os arquivos que o ONS regravou. O controle fica em
`data/energia.duckdb`, nas tabelas `controle.manifesto` e `controle.execucoes`.

## Roteiro

- [x] Fase 0: ambiente e repositório
- [x] Fase 1: explorar as fontes do ONS ([achados](docs/decisoes.md))
- [x] Fase 2: modelo de dados ([modelo](docs/modelo_dados.md))
- [x] Fase 3: ingestão (bronze)
- [ ] Fase 4: silver com testes de qualidade
- [ ] Fase 5: gold e dashboard público
- [ ] Fase 6: orquestração com GitHub Actions
- [ ] Fase 7: documentação final

## Fonte dos dados

[Portal de Dados Abertos do ONS](https://dados.ons.org.br/), licença CC-BY 4.0.

## Licença

Código sob licença MIT. Veja [LICENSE](LICENSE).
