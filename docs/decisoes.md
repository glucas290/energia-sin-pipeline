# Decisões técnicas

## Fase 1: exploração das fontes do ONS

Explorado em 16/11/2026, direto no bucket público `s3://ons-aws-prod-opendata`
(listagem via `https://ons-aws-prod-opendata.s3.amazonaws.com/?list-type=2&prefix=dataset/`,
sem credenciais).

### Conjuntos do MVP

| Conjunto | Prefixo | Granularidade | Partição | Histórico |
| --- | --- | --- | --- | --- |
| Carga de energia diária | `dataset/carga_energia_di/` | dia × subsistema | 1 arquivo por ano | 2000 em diante |
| Geração por usina | `dataset/geracao_usina_2_ho/` | hora × usina | por ano até 2021, por mês a partir de 2022 | 2000 em diante |
| Intercâmbio entre subsistemas | `dataset/intercambio_nacional_ho/` | hora × par de subsistemas | 1 arquivo por ano | 2000 em diante |
| Capacidade instalada | `dataset/capacidade-geracao/` | unidade geradora | arquivo único (foto atual) | não se aplica |

Cada partição é publicada em três formatos (`.csv`, `.parquet`, `.xlsx`), mais um
dicionário de dados em `.json` e `.pdf`. A exceção é o intercâmbio: tem CSV de 2000 a
2026, mas Parquet só de 2023 em diante.

### Formato dos arquivos

- CSV com separador `;`, decimal com ponto, encoding UTF-8 sem BOM, cabeçalho na
  primeira linha.
- Datas em ISO: `2026-01-01` na carga, `2026-01-01 00:00:00` nos horários.
- Os nomes de coluna já seguem um padrão (`id_`, `nom_`, `din_`, `dat_`, `val_`), que
  pretendo manter na silver.

### Volume

| Conjunto | CSV (total) | Parquet (total) | Linhas de referência |
| --- | --- | --- | --- |
| Carga diária | 1,5 MB | 0,6 MB | ~1.460 por ano (4 subsistemas × 365) |
| Geração por usina | 11,4 GB | 738 MB | ~500 mil por mês |
| Intercâmbio | 48,6 MB | 1,8 MB (só 2023+) | ~35 mil por ano (4 pares × 8.760 h) |
| Capacidade instalada | 1,3 MB | 0,2 MB | 5.837 unidades geradoras |

Recorte do MVP para geração (jan/2024 a nov/2026): 35 arquivos mensais, 2,3 GB em CSV
ou 158 MB em Parquet.

### Atualização e defasagem

- Os arquivos do período corrente são regravados todo dia (`LastModified` de hoje no
  arquivo de 2026 da carga e do intercâmbio e no de novembro da geração).
- Na geração, o mês anterior também é regravado no início do mês seguinte
  (`2026_10` foi atualizado em 16/11). Períodos fechados voltam a mudar de vez em
  quando: os meses de 2024 foram todos regravados em 13/02/2025.
- Defasagem observada: a carga vai até D-2 (14/11) e os horários até D-1 (15/11).

Consequência para a carga incremental: não basta pegar "o que é novo". O ONS revisa
dados já publicados, então a ingestão precisa reprocessar a partição corrente e a
anterior, e detectar mudança nas demais pelo `ETag`/`LastModified` do S3.

### Pegadinhas encontradas

**Schema muda entre anos no mesmo conjunto (intercâmbio).** O Parquet de 2025 tem
`val_intercambiomwmed` como `DOUBLE` e não tem `val_intercambioprogmwmed`; o de 2026
tem as duas colunas, ambas como `VARCHAR`. O CSV de 2026 é lido com os tipos certos.
O mesmo acontece na geração: no Parquet de jan/2024, `val_geracao` é `VARCHAR`.

**A convenção de sentido do intercâmbio mudou em 2026.** São 4 pares de subsistemas
por hora (N–NE, N–SE, NE–SE, S–SE). Até 2025 cada par tem orientação fixa e o valor
verificado tem sinal (negativo = fluxo contrário). Em 2026 `origem`/`destino` trocam
de lugar de hora em hora para que o valor verificado seja sempre positivo, e surge
a coluna `val_intercambioprogmwmed`, que pode ser negativa (2.270 linhas). A silver
normaliza cada par numa orientação fixa e inverte o sinal quando a linha vem no
sentido contrário; a mesma regra serve para as duas convenções.

**Nomes de subsistema inconsistentes.** A carga usa `Norte`, `Sudeste/Centro-Oeste`;
a geração usa `NORTE`, `SUDESTE`; o intercâmbio usa `' NORTE'` (espaço à esquerda); a
capacidade usa `'NORTE          '` (completado com espaços à direita). O
`id_subsistema` (N, NE, S, SE) é consistente em todos e vai ser a chave de
`dim_subsistema`. A capacidade tem ainda o subsistema `PARAGUAI` (metade de Itaipu).

**Chave da usina.** `nom_usina` não é único (há duas `UTE SUZANO`, uma no MA e outra
no MS). `id_ons` é nulo para pequenas usinas (Tipo III e MMGD, 117 usinas em nov/2026),
e nesses casos `ceg` vem como `-`. A combinação `din_instante + id_ons + nom_usina`
não se repete na amostra, mas `dim_usina` vai precisar de uma chave substituta.

**Capacidade não tem `id_ons`.** O dicionário lista a coluna, mas ela não existe no
arquivo. A ligação com a geração terá de ser por `ceg`: dos 322 CEGs da geração em
nov/2026, 302 aparecem na capacidade.

**Outros tipos e nulos.**
- Na capacidade, as datas vêm como texto e `cod_equipamento`/`num_unidadegeradora`
  com espaços à direita. `dat_desativacao` nula significa unidade ativa.
- Na geração, `val_geracao` é nulo em 14.040 linhas do mês (usinas Tipo II-B e
  Tipo III sem medição), sem valores negativos.
- A carga vem como `DATE` no CSV e `TIMESTAMP` no Parquet.

### Decisão: ingerir CSV com schema declarado

Optei por baixar sempre o CSV e declarar os tipos de cada coluna na leitura, em vez
de usar o Parquet publicado pelo ONS.

Alternativas consideradas:

- Só Parquet: download cerca de 15 vezes menor na geração, mas o intercâmbio não tem
  Parquet antes de 2023 e os tipos mudam de um ano para outro no mesmo conjunto.
- Misto (Parquet onde existe, CSV no resto): duas lógicas de leitura para manter.

Motivo: o CSV existe para todos os anos dos quatro conjuntos, e com o schema declarado
por mim uma mudança de tipo na origem vira erro explícito (ou quarentena), em vez de
passar silenciosamente. O custo é a carga inicial da geração (2,3 GB, uma vez só);
depois são cerca de 65 MB por mês.

Os dados baixados ficam em `data/`, dentro do projeto, fora do Git.

## Fase 2: modelo de dados

O desenho completo está em [modelo_dados.md](modelo_dados.md).

### Grão de `fato_geracao`: hora × usina

Mantive o grão mais fino que a fonte oferece. Agregar por dia depois é trivial; o
contrário é impossível. São cerca de 17 milhões de linhas para 2024–2026, volume que
o DuckDB processa sem esforço. A alternativa era gravar só a soma diária por usina.

### Tempo: `dim_data` diária e hora como coluna

A carga é diária e a geração e o intercâmbio são horários. Com a dimensão no grão do
dia, as três fatos se ligam a ela do mesmo jeito, e a hora fica como coluna nas fatos
horárias. Uma dimensão horária (8.760 linhas por ano) deixaria a carga sem ter onde
se ligar. Renomeei `dim_tempo` para `dim_data`, que descreve melhor o conteúdo.

### Chave de `dim_usina` e SCD tipo 1

Comparando jan/2024 com nov/2026, todas as 491 usinas presentes nos dois meses mudaram
a grafia do nome (`Jaguara` → `JAGUARA`, `Salto do Rio Verdinho` → `S.R.VERDINHO`), e
há nomes repetidos entre usinas diferentes (`UTE SUZANO` no MA e no MS). O nome não
serve como chave.

A chave natural é o `id_ons`. Os 117 agregados de pequenas usinas (Tipo III e MMGD)
não têm `id_ons` e não existiam em jan/2024; neles a chave é o nome, que é
sintético e estável (`PQU ACRAC MMGD`). Sobre essa chave natural gero um hash como
chave substituta.

Para mudanças de atributo, uso SCD tipo 1 (sobrescreve, fica a versão mais recente).
O histórico de grafias não responde nenhuma pergunta de negócio, e o tipo 2 traria
intervalos de validade e joins por data sem retorno.

### `dim_fonte` no nível do tipo de usina

Geração e capacidade concordam nos 5 tipos de usina, mas não nos combustíveis (`Gás`
contra `GÁS`, `RESÍDUO CICLO COMBINADO` só na capacidade, unidades fotovoltaicas com
combustível `EÓLICA`). Com a fonte no nível do tipo, os dois conjuntos se cruzam sem
mapeamento manual; o combustível fica como atributo de `dim_usina`.

### Capacidade como fato por unidade geradora

A capacidade não tem `id_ons`, e o `ceg` casa só 302 dos 322 CEGs da geração. Em vez
de pendurar a potência em `dim_usina` por esse join frágil, criei `fato_capacidade`
com uma linha por unidade geradora e suas datas de entrada e desativação, ligada a
fonte e subsistema. Isso permite calcular a capacidade instalada em qualquer data e o
fator de capacidade (geração / capacidade) por fonte e subsistema. A alternativa era
somar a potência como atributo da usina, que perde a evolução no tempo.

A capacidade inclui o subsistema `PY` (10 unidades, 7.000 MW: a parte paraguaia de
Itaipu). Ele entra em `dim_subsistema` marcado como fora do SIN.

### Medidas em MWmed e MWh

MWmed é média e não pode ser somado ao longo do tempo. Cada fato guarda também
`energia_mwh`, aditiva em qualquer dimensão (MWmed × 1 nas fatos horárias, × 24 na
carga).

### Pontos para os testes de qualidade (Fase 4)

- 8 unidades geradoras têm `dat_desativacao` anterior a `dat_entradaoperacao`.
- 8 unidades não têm `dat_entradateste`.
- `val_geracao` nulo em usinas sem medição: manter como nulo, não como zero.

## Fase 3: ingestão (bronze)

### Bronze como cópia fiel dos arquivos

A bronze guarda os CSVs exatamente como o ONS publica, em `data/bronze/<fonte>/`.
Considerei carregar tudo em tabelas DuckDB com colunas `VARCHAR`, mas manter o arquivo
original é a cópia mais fiel possível e deixa a declaração de tipos num lugar só, na
leitura pela silver. Se uma regra de limpeza estiver errada, reprocesso a partir da
bronze sem baixar nada de novo.

### Carga incremental pelo ETag

A listagem do S3 (`ListObjectsV2`) devolve o ETag de cada arquivo numa única chamada
por prefixo. Comparo com `controle.manifesto` e baixo só o que é novo, mudou ou sumiu
do disco. Isso cobre as revisões que o ONS faz em períodos já publicados, que um
filtro por data perderia.

O ETag gravado no manifesto é o da resposta do download, não o da listagem: se o ONS
regravar o arquivo entre as duas chamadas, o manifesto descreve o conteúdo que de fato
está no disco.

### Idempotência e download atômico

Cada arquivo substitui a versão anterior; nada é acrescentado. Rodar de novo sem
mudança na origem resulta em zero downloads.

O download vai para um `.part` e só é renomeado para o nome final se o número de bytes
bater com o `Content-Length`. Uma queda de rede no meio não deixa CSV truncado na
bronze nem registro no manifesto. O manifesto é gravado arquivo a arquivo, então uma
execução interrompida retoma de onde parou.

### Log de execuções

`controle.execucoes` tem uma linha por rodada: início, fim, duração, status, arquivos
verificados, baixados e ignorados, bytes e linhas. Em caso de falha a linha fica com
status `erro` e a mensagem, e o processo termina com código diferente de zero, o que
vai falhar o job no GitHub Actions. Linhas rejeitadas entram na Fase 4, com a
quarentena.

### Sem boto3

O bucket é público e só preciso de duas operações (listar e baixar), então uso a API
REST do S3 com `requests`, com retry exponencial para 429 e 5xx. O `boto3` traria uma
dependência pesada e exigiria configurar acesso anônimo explicitamente.

## Fase 4: silver com testes de qualidade

### Três modelos por fonte: stg, silver e quarentena

Cada `stg_<fonte>` lê a bronze com todas as colunas como texto, aplica os tipos com
`try_cast` e calcula `motivo_rejeicao` (nulo quando a linha passa em todas as regras).
`silver_<fonte>` é uma view com as linhas válidas e `quarentena` reúne as rejeitadas das
quatro fontes, com o arquivo de origem, o motivo e os valores brutos em JSON. Valor
inválido não quebra o pipeline nem some: vira linha de quarentena com motivo legível.

Se o ONS remover uma coluna que eu uso, o `select` explícito falha no build, o que é o
comportamento que quero (mudança de schema precisa de decisão humana). Coluna nova é
ignorada até eu decidir usá-la.

Primeira carga (18,4 milhões de linhas lidas):

| Fonte | Rejeitadas | Motivo |
| --- | --- | --- |
| carga | 13 | valor ausente (dias de 2013) |
| geração | 33 | geração negativa |
| capacidade | 8 | desativação anterior à entrada em operação |
| intercâmbio | 0 | |

O teste `quarentena_abaixo_de` falha o build se mais de 1% das linhas de uma fonte for
rejeitado: um volume desses indica mudança na origem, não sujeira pontual.

### Incremental por arquivo na geração

`stg_geracao` é um modelo incremental com estratégia `delete+insert` e `arquivo_origem`
como chave: a cada build, lê só os CSVs que o manifesto marca como baixados depois do
último processamento e substitui todas as linhas desses arquivos. A carga completa
leva cerca de 14 s; sem arquivo novo, 0,2 s; com um mês regravado, 1 s. Simulei a
regravação de nov/2026 e a contagem de linhas ficou idêntica, sem duplicar.

As outras fontes somam menos de 1 milhão de linhas e são reconstruídas inteiras a cada
build; incremental ali só acrescentaria complexidade.

### Chave dos agregados de pequenas usinas

A partir de mai/2026 os 117 agregados de pequenas usinas (MMGD e Tipo III) passaram a
vir sem `id_ons` e com outro nome (`PQU ACRAC FOTOV MMGD` → `PQU ACRAC MMGD`). Usar o
nome como chave criaria duas usinas para o mesmo agregado. O id antigo segue um padrão
(`PQU_<código>_<GD ou inicial do tipo>`) que é reconstruível a partir do nome novo;
validei a regra nos 35 meses: as 117 chaves reconstruídas coincidem com os ids
antigos e não há duplicidade de (instante, chave).

### Log da transformação

Um hook `on-run-end` grava em `controle.execucoes_dbt` o status de cada comando dbt
(nós executados, erros, avisos e quais falharam) e em `controle.qualidade` as linhas
lidas, gravadas na silver e rejeitadas por fonte. Junto com `controle.execucoes` da
ingestão, cobre o log pedido: linhas lidas, gravadas e rejeitadas, duração e status.

### Testes sem pacotes externos

Escrevi dois testes genéricos (`chave_unica` e `quarentena_abaixo_de`) em vez de
instalar o `dbt_utils`. São poucas linhas e o projeto não depende de baixar pacotes.
