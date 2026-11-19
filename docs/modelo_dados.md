# Modelo de dados

Camada gold em modelo estrela. As decisões e as alternativas descartadas estão em
[decisoes.md](decisoes.md); os tipos finais de cada coluna, gerados a partir do dbt, em
[dicionario_dados.md](dicionario_dados.md).

```text
                              dim_data
                                 │
     dim_subsistema ────── fato_carga
     dim_subsistema ─┬──── fato_intercambio        (origem e destino)
                     │
     dim_usina ──────┼──── fato_geracao
     dim_fonte ──────┤
                     └──── fato_capacidade
```

Todas as fatos se ligam a `dim_data`. `fato_geracao` e `fato_capacidade` também se
ligam a `dim_fonte` e `dim_subsistema` diretamente, sem passar por `dim_usina`, para
que geração e capacidade possam ser cruzadas por fonte e subsistema.

## Grão das fatos

| Tabela | Uma linha representa | Chave |
| --- | --- | --- |
| `fato_carga` | a carga média de um subsistema em um dia | `data`, `subsistema_id` |
| `fato_geracao` | a geração média de uma usina em uma hora | `data`, `hora`, `usina_sk` |
| `fato_intercambio` | o fluxo entre um par de subsistemas em uma hora | `data`, `hora`, `subsistema_origem_id`, `subsistema_destino_id` |
| `fato_capacidade` | uma unidade geradora, com seu período de operação | `cod_equipamento` |

## Medidas: MWmed e MWh

O ONS publica tudo em MWmed (potência média no intervalo). MWmed não é aditivo no
tempo: somar a carga média de 30 dias não dá a energia do mês. Por isso cada fato
guarda também a energia em MWh, que é aditiva em qualquer dimensão.

- Fatos horárias: `energia_mwh = mwmed × 1`.
- `fato_carga` (diária): `energia_mwh = mwmed × 24`.

## Dimensões

### dim_data

Uma linha por dia, de 2000-01-01 até o fim do ano corrente.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | Chave |
| `ano` | integer | |
| `trimestre` | integer | 1 a 4 |
| `mes` | integer | 1 a 12 |
| `nome_mes` | varchar | janeiro, fevereiro, ... |
| `ano_mes` | varchar | `2026-11`, para eixos de gráfico |
| `dia` | integer | |
| `dia_semana` | integer | 1 (segunda) a 7 (domingo), ISO |
| `nome_dia_semana` | varchar | |
| `fim_de_semana` | boolean | |

### dim_subsistema

Chave natural (`N`, `NE`, `S`, `SE`, `PY`): é curta, estável e igual em todos os
conjuntos, então não precisa de chave substituta.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `subsistema_id` | varchar | Chave |
| `nome_subsistema` | varchar | Nome padronizado (`Sudeste/Centro-Oeste`, ...) |
| `pertence_sin` | boolean | Falso para `PY`, a parte paraguaia de Itaipu, que só aparece na capacidade |

### dim_fonte

Cinco linhas, uma por tipo de usina. O combustível fica em `dim_usina` porque os
valores divergem entre geração e capacidade.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `fonte_id` | varchar | `hidraulica`, `termica`, `eolica`, `solar`, `nuclear` |
| `nome_fonte` | varchar | Nome de exibição |
| `renovavel` | boolean | |

### dim_usina

SCD tipo 1: guarda só a versão mais recente dos atributos. O ONS muda a grafia dos
nomes ao longo do tempo (`Jaguara` → `JAGUARA`), e o histórico de grafias não tem
valor analítico.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `usina_sk` | varchar | Chave substituta: hash da chave natural |
| `chave_natural` | varchar | `id_ons`; nos agregados de pequenas usinas publicados sem `id_ons` (a partir de mai/2026), o id reconstruído a partir do nome |
| `id_ons` | varchar | Nulo nos agregados publicados a partir de mai/2026 |
| `nome_usina` | varchar | Nome mais recente |
| `ceg` | varchar | Código ANEEL; nulo quando a origem traz `-` |
| `uf` | varchar | |
| `subsistema_id` | varchar | |
| `fonte_id` | varchar | |
| `combustivel` | varchar | |
| `modalidade_operacao` | varchar | `TIPO I`, `TIPO II-A`, ..., `Conjunto de Usinas` |
| `agregado_pequenas_usinas` | boolean | Verdadeiro para os agregados de pequenas usinas (Tipo III e MMGD) |
| `primeira_data` | date | Primeiro dia com geração na janela carregada |
| `ultima_data` | date | Último dia com geração na janela carregada |

## Fatos

### fato_carga

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | FK `dim_data` |
| `subsistema_id` | varchar | FK `dim_subsistema` |
| `carga_mwmed` | double | |
| `energia_mwh` | double | `carga_mwmed × 24` |

### fato_geracao

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | FK `dim_data` |
| `hora` | integer | 0 a 23 |
| `usina_sk` | varchar | FK `dim_usina` |
| `subsistema_id` | varchar | FK `dim_subsistema` |
| `fonte_id` | varchar | FK `dim_fonte` |
| `geracao_mwmed` | double | Nulo quando a usina não tem medição na hora |
| `energia_mwh` | double | |

### fato_intercambio

Cada par é gravado numa orientação fixa (`N→NE`, `N→SE`, `NE→SE`, `S→SE`). Na origem
o sentido inverte conforme o fluxo; aqui o sinal indica o sentido: positivo é de
origem para destino.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | FK `dim_data` |
| `hora` | integer | 0 a 23 |
| `subsistema_origem_id` | varchar | FK `dim_subsistema` |
| `subsistema_destino_id` | varchar | FK `dim_subsistema` |
| `intercambio_verificado_mwmed` | double | Com sinal |
| `intercambio_programado_mwmed` | double | Com sinal; nulo antes de 2026 |
| `energia_verificada_mwh` | double | |

### fato_capacidade

Uma linha por unidade geradora, com o intervalo em que esteve em operação. A
capacidade instalada numa data D é a soma de `potencia_mw` das unidades com
`data_entrada_operacao <= D` e `data_desativacao` nula ou maior que D.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `cod_equipamento` | varchar | Chave |
| `subsistema_id` | varchar | FK `dim_subsistema` |
| `fonte_id` | varchar | FK `dim_fonte` |
| `uf` | varchar | |
| `ceg` | varchar | Permite ligar à usina quando há correspondência |
| `nome_usina` | varchar | |
| `data_entrada_operacao` | date | FK `dim_data` |
| `data_desativacao` | date | FK `dim_data`; nula se a unidade está ativa |
| `potencia_mw` | double | |
