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

**Sentido do intercâmbio vira conforme o fluxo.** São 4 pares de subsistemas por hora
(N–NE, N–SE, NE–SE, S–SE), mas `origem`/`destino` trocam de lugar de hora em hora
para que o valor verificado seja sempre positivo. Já o valor programado pode ser
negativo (2.270 linhas em 2026). Para somar ou comparar, a silver precisa normalizar
cada par numa orientação fixa e aplicar o sinal.

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
