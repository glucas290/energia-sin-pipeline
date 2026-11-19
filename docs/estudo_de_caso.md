# Estudo de caso: pipeline de dados do setor elétrico

## Problema

O ONS publica diariamente os dados do Sistema Interligado Nacional em um bucket aberto:
quanto o país consome, quanto cada usina gera hora a hora, quanta energia passa entre
as regiões e quanto de capacidade está instalada. Os dados são ricos, mas não estão
prontos para análise. Na exploração encontrei:

- arquivos já publicados que são regravados meses depois;
- tipos que mudam de um ano para outro no mesmo conjunto;
- uma mudança silenciosa de convenção no intercâmbio em 2026 (sentido e sinal);
- 117 agregados de usinas que trocaram de identificador e de nome em mai/2026;
- nomes de região escritos de quatro formas diferentes.

Quem consome esses arquivos direto num BI precisa tratar tudo isso à mão, a cada
atualização, e não tem como saber quando um dado chegou errado.

## Solução

Construí um pipeline diário, de ponta a ponta, com ferramentas gratuitas e sem
servidor: ingestão incremental em Python, armazenamento em DuckDB, transformação e
testes em dbt, orquestração no GitHub Actions e um dashboard estático publicado no
GitHub Pages.

## Como funciona

1. **Bronze.** Um script lista o bucket do ONS, compara o ETag de cada arquivo com um
   manifesto e baixa só o que é novo ou foi regravado. O download é atômico e a
   execução é idempotente: rodar duas vezes não baixa nada de novo.
2. **Silver.** O dbt lê os CSVs como texto, aplica os tipos e as regras de qualidade.
   Cada linha inválida vai para uma tabela de quarentena com o motivo. A geração
   horária, com 17,5 milhões de linhas, é incremental por arquivo.
3. **Gold.** Modelo estrela com quatro fatos e quatro dimensões, testado para chave
   única e integridade referencial, e medidas de energia em MWh, que podem ser somadas.
4. **Orquestração.** O GitHub Actions roda tudo todo dia, mantém o estado entre execuções
   no cache e só republica o dashboard se todos os testes passarem.
5. **Observabilidade.** Tabelas de log registram, a cada execução, duração, status,
   arquivos baixados e linhas lidas, gravadas e rejeitadas. O próprio dashboard mostra
   essas métricas.

## Resultado

- 18,4 milhões de linhas processadas na carga inicial: carga diária desde 2000,
  intercâmbio horário desde 2000, geração horária por usina desde 2024 e capacidade por
  unidade geradora.
- A carga inicial leva cerca de 10 minutos; uma execução sem arquivo novo, cerca de
  10 segundos na minha máquina (ingestão mais `dbt build`).
- 61 testes de qualidade no dbt a cada execução e 17 testes unitários na ingestão.
- 54 linhas em quarentena, cada uma com motivo legível, em vez de erro ou perda
  silenciosa.
- Um achado de análise que só apareceu com a modelagem: 64% da geração solar vem de
  geração distribuída, que não está no cadastro de capacidade. Sem esse recorte, o fator
  de capacidade da solar daria 63%; com ele, 22%.

## Tecnologias

Python, DuckDB, dbt (dbt-duckdb), SQL, pytest, GitHub Actions, GitHub Pages, ECharts.
