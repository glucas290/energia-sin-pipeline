with dias as (
    select unnest(generate_series(
        date '2000-01-01',
        (date_trunc('year', current_date) + interval 1 year - interval 1 day)::date,
        interval 1 day
    ))::date as data
)

select
    data,
    year(data) as ano,
    quarter(data) as trimestre,
    month(data) as mes,
    ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
     'setembro', 'outubro', 'novembro', 'dezembro'][month(data)] as nome_mes,
    strftime(data, '%Y-%m') as ano_mes,
    day(data) as dia,
    isodow(data) as dia_semana,
    ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][isodow(data)] as nome_dia_semana,
    isodow(data) >= 6 as fim_de_semana
from dias
