# Dicionário de dados

Tabelas da camada gold (schema `gold` em `data/energia.duckdb`). Gerado por
`scripts/gerar_dicionario.py` a partir das descrições em `dbt/models/gold/_gold.yml`;
não editar à mão.

## fato_carga

Uma linha por subsistema e dia, com a carga média do dia.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | Dia. |
| `subsistema_id` | varchar | Subsistema. |
| `carga_mwmed` | double | Carga média do dia, em MWmed. Não somar ao longo do tempo. |
| `energia_mwh` | double | Energia consumida no dia, em MWh (carga_mwmed × 24). Aditiva. |

## fato_geracao

Uma linha por usina e hora, com a geração média da hora.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | Dia. |
| `hora` | bigint | Hora de início do intervalo (0 a 23), horário de Brasília. |
| `usina_sk` | varchar | Usina. |
| `subsistema_id` | varchar | Subsistema da usina. |
| `fonte_id` | varchar | Fonte da usina. |
| `geracao_mwmed` | double | Geração média na hora, em MWmed. Nula quando a usina não tem medição. |
| `energia_mwh` | double | Energia gerada na hora, em MWh. Aditiva. |

## fato_intercambio

Uma linha por par de subsistemas e hora. Cada par está numa orientação fixa (N→NE, N→SE, NE→SE, S→SE); valor positivo é fluxo de origem para destino.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | Dia. |
| `hora` | bigint | Hora de início do intervalo (0 a 23), horário de Brasília. |
| `subsistema_origem_id` | varchar | Subsistema de origem na orientação fixa. |
| `subsistema_destino_id` | varchar | Subsistema de destino na orientação fixa. |
| `intercambio_verificado_mwmed` | double | Fluxo verificado na hora, em MWmed, com sinal. |
| `intercambio_programado_mwmed` | double | Fluxo programado na hora, em MWmed, com sinal. Publicado pelo ONS só a partir de 2026. |
| `energia_verificada_mwh` | double | Energia transferida na hora, em MWh, com sinal. Aditiva. |

## fato_capacidade

Uma linha por unidade geradora, com o período de operação. A capacidade instalada numa data D é a soma de potencia_mw das unidades com data_entrada_operacao <= D e data_desativacao nula ou maior que D.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `cod_equipamento` | varchar | Código da unidade geradora no ONS. |
| `subsistema_id` | varchar | Subsistema da unidade, incluindo PY. |
| `fonte_id` | varchar | Fonte da unidade. |
| `uf` | varchar | Sigla do estado. |
| `ceg` | varchar | Código ANEEL do empreendimento; liga à usina quando há correspondência. |
| `nome_usina` | varchar | Nome da usina na publicação de capacidade. |
| `data_entrada_operacao` | date | Data de entrada em operação comercial. |
| `data_desativacao` | date | Data de desativação. Nula se a unidade está ativa. |
| `potencia_mw` | double | Potência nominal da unidade, em MW. |

## dim_data

Calendário diário de 2000-01-01 até o fim do ano corrente.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `data` | date | Chave da dimensão. |
| `ano` | bigint | Ano. |
| `trimestre` | bigint | Trimestre (1 a 4). |
| `mes` | bigint | Mês (1 a 12). |
| `nome_mes` | varchar | Nome do mês em português. |
| `ano_mes` | varchar | Ano e mês no formato AAAA-MM. |
| `dia` | bigint | Dia do mês. |
| `dia_semana` | bigint | Dia da semana ISO, de 1 (segunda) a 7 (domingo). |
| `nome_dia_semana` | varchar | Nome do dia da semana. |
| `fim_de_semana` | boolean | Verdadeiro para sábado e domingo. |

## dim_subsistema

Subsistemas do SIN. Chave natural, curta e igual em todos os conjuntos do ONS.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `subsistema_id` | varchar | Sigla do subsistema (N, NE, S, SE, PY). |
| `nome_subsistema` | varchar | Nome padronizado. |
| `pertence_sin` | boolean | Falso para PY, a parte paraguaia de Itaipu, que só aparece na capacidade instalada. |

## dim_fonte

Fonte de geração, no nível do tipo de usina publicado pelo ONS.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `fonte_id` | varchar | hidraulica, termica, eolica, solar ou nuclear. |
| `nome_fonte` | varchar | Nome de exibição. |
| `renovavel` | boolean | Verdadeiro para hidráulica, eólica e solar. |

## dim_usina

Usinas e agregados de pequenas usinas que aparecem na geração. SCD tipo 1: guarda os atributos da aparição mais recente.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| `usina_sk` | varchar | Chave substituta, hash MD5 da chave natural. |
| `chave_natural` | varchar | id_ons; para agregados de pequenas usinas sem id_ons, o id reconstruído a partir do nome. |
| `id_ons` | varchar | Identificador da usina no ONS. Nulo nos agregados publicados a partir de mai/2026. |
| `nome_usina` | varchar | Nome mais recente publicado pelo ONS. |
| `ceg` | varchar | Código Único do Empreendimento de Geração (ANEEL). Nulo quando a origem traz '-'. |
| `uf` | varchar | Sigla do estado. |
| `subsistema_id` | varchar | Subsistema da usina. |
| `fonte_id` | varchar | Fonte da usina. |
| `combustivel` | varchar | Tipo de combustível publicado pelo ONS. |
| `modalidade_operacao` | varchar | TIPO I, TIPO II-A, TIPO II-B, TIPO III, Conjunto de Usinas ou Pequenas Usinas. |
| `agregado_pequenas_usinas` | boolean | Verdadeiro para os agregados de pequenas usinas (MMGD e Tipo III), que somam várias usinas por estado. |
| `primeira_data` | date | Primeiro dia com geração na janela carregada. |
| `ultima_data` | date | Último dia com geração na janela carregada. |
