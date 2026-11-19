'use strict';

// ---------- datas: o dados.json traz dias desde 2000-01-01 e meses desde jan/2000 ----------
const BASE = Date.UTC(2000, 0, 1);
const MS_DIA = 86400000;
const isoDoDia = d => new Date(BASE + d * MS_DIA).toISOString().slice(0, 10);
const diaDoIso = s => Math.round((Date.parse(s + 'T00:00:00Z') - BASE) / MS_DIA);
const mesDoDia = d => { const t = new Date(BASE + d * MS_DIA); return (t.getUTCFullYear() - 2000) * 12 + t.getUTCMonth(); };
const anoDoDia = d => new Date(BASE + d * MS_DIA).getUTCFullYear();
const rotuloMes = m => `${2000 + Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}`;
const fimDoMes = m => (Date.UTC(2000 + Math.floor(m / 12), m % 12 + 1, 0) - BASE) / MS_DIA;
const fimDoAno = a => (Date.UTC(a, 11, 31) - BASE) / MS_DIA;
const dataBR = d => isoDoDia(d).split('-').reverse().join('/');

// ---------- aparência ----------
const CORES_FONTE = ['#2f6fb0', '#2a9d8f', '#e9a92b', '#8d6e63', '#7e57c2'];
const CORES_SUBS = ['#2a9d8f', '#e9a92b', '#7e57c2', '#2f6fb0'];
const CORES_PARES = ['#2a9d8f', '#2f6fb0', '#e9a92b', '#c0504d'];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? '–'
  : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = v => Math.round(v).toLocaleString('pt-BR');

// ---------- estado dos filtros ----------
let D;                 // dados.json
let NOMES_FONTE, NOMES_SUBS, PARES, RENOVAVEL;
let DIA_MIN_GERACAO, DIA_MAX;
let DIAS_POR_MES;      // mês -> dias com geração
const estado = {
  preset: '12m', ini: 0, fim: 0, subs: new Set(), fontes: new Set(),
  gran: 'mes', modoGeracao: 'abs', busca: '', qtd: 20, usina: null,
};
const okSub = s => estado.subs.size === 0 || estado.subs.has(s);
const okFonte = f => estado.fontes.size === 0 || estado.fontes.has(f);
const alternar = (conjunto, v) => { conjunto.has(v) ? conjunto.delete(v) : conjunto.add(v); };

function presets() {
  const anos = [];
  for (let a = anoDoDia(DIA_MIN_GERACAO); a <= anoDoDia(DIA_MAX); a++) anos.push(String(a));
  return [['30d', '30 dias'], ['12m', '12 meses'], ...anos.map(a => [a, a]), ['tudo', 'Tudo']];
}

function aplicarPreset(id) {
  estado.preset = id;
  estado.fim = DIA_MAX;
  if (id === '30d') { estado.ini = DIA_MAX - 29; estado.gran = 'dia'; }
  else if (id === '12m') { estado.ini = DIA_MAX - 364; estado.gran = 'mes'; }
  else if (id === 'tudo') { estado.ini = 0; estado.gran = 'ano'; }
  else {
    const a = Number(id);
    estado.ini = diaDoIso(`${a}-01-01`);
    estado.fim = Math.min(fimDoAno(a), DIA_MAX);
    estado.gran = 'mes';
  }
}

// filtros na URL: o link copiado abre a página com os mesmos filtros
function salvarNaUrl() {
  const p = new URLSearchParams();
  p.set('de', isoDoDia(estado.ini));
  p.set('ate', isoDoDia(estado.fim));
  if (estado.subs.size) p.set('s', [...estado.subs].map(i => D.categorias.s[i]).join(','));
  if (estado.fontes.size) p.set('f', [...estado.fontes].map(i => D.categorias.f[i]).join(','));
  p.set('g', estado.gran);
  if (estado.modoGeracao !== 'abs') p.set('modo', estado.modoGeracao);
  history.replaceState(null, '', '#' + p.toString());
}

function lerDaUrl() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has('de') || !p.has('ate')) return false;
  const ini = diaDoIso(p.get('de')), fim = diaDoIso(p.get('ate'));
  if (Number.isNaN(ini) || Number.isNaN(fim)) return false;
  estado.preset = null;
  estado.ini = Math.max(0, Math.min(ini, fim));
  estado.fim = Math.min(DIA_MAX, Math.max(ini, fim));
  for (const [chave, lista, alvo] of [['s', D.categorias.s, estado.subs], ['f', D.categorias.f, estado.fontes]]) {
    (p.get(chave) || '').split(',').filter(Boolean).forEach(v => { const i = lista.indexOf(v); if (i >= 0) alvo.add(i); });
  }
  if (['dia', 'mes', 'ano'].includes(p.get('g'))) estado.gran = p.get('g');
  if (p.get('modo') === 'pct') estado.modoGeracao = 'pct';
  return true;
}

// ---------- intervalos de tempo conforme a granularidade ----------
function intervalos() {
  const { ini, fim, gran } = estado;
  const lista = [];
  if (gran === 'dia') {
    for (let d = ini; d <= fim; d++) lista.push({ chave: d, rotulo: isoDoDia(d), fim: d });
  } else if (gran === 'mes') {
    for (let m = mesDoDia(ini); m <= mesDoDia(fim); m++) lista.push({ chave: m, rotulo: rotuloMes(m), fim: Math.min(fimDoMes(m), fim) });
  } else {
    for (let a = anoDoDia(ini); a <= anoDoDia(fim); a++) lista.push({ chave: a, rotulo: String(a), fim: Math.min(fimDoAno(a), fim) });
  }
  return lista;
}
const chaveDoDia = d => estado.gran === 'dia' ? d : estado.gran === 'mes' ? mesDoDia(d) : anoDoDia(d);

// ---------- capacidade instalada em datas, por varredura de eventos de entrada e saída ----------
function capacidadeNasDatas(datas) {
  const C = D.capacidade;
  const eventos = [];
  for (let i = 0; i < C.mw.length; i++) {
    if (!okSub(C.s[i]) || !okFonte(C.f[i])) continue;
    eventos.push([C.ini[i], C.f[i], C.mw[i]]);
    if (C.fim[i] != null) eventos.push([C.fim[i], C.f[i], -C.mw[i]]);
  }
  eventos.sort((a, b) => a[0] - b[0]);
  const atual = [0, 0, 0, 0, 0];
  const resultado = [];
  let j = 0;
  // ativa em D: entrada <= D e desativação nula ou > D, ou seja, todo evento com data <= D já vale
  for (const data of datas) {
    while (j < eventos.length && eventos[j][0] <= data) { atual[eventos[j][1]] += eventos[j][2]; j++; }
    resultado.push(atual.slice());
  }
  return resultado;
}

// ---------- cálculo de tudo que depende dos filtros ----------
function calcular() {
  const { ini, fim } = estado;
  const r = {};
  const ints = intervalos();
  const idx = new Map(ints.map((x, i) => [x.chave, i]));
  r.intervalos = ints;

  // geração
  const G = D.geracao;
  r.serieGeracao = ints.map(() => [0, 0, 0, 0, 0]);
  r.porFonte = [0, 0, 0, 0, 0];
  r.geracaoPorSub = [0, 0, 0, 0];
  r.totalSub = 0; r.renovSub = 0; r.solar = 0; r.mmgd = 0;
  const despMes = new Map(), diasMes = new Map();
  let ultimoDia = -1, temGeracao = false;
  for (let i = 0; i < G.d.length; i++) {
    const d = G.d[i];
    if (d < ini || d > fim) continue;
    temGeracao = true;
    const s = G.s[i], f = G.f[i], mwh = G.mwh[i];
    const m = mesDoDia(d);
    if (d !== ultimoDia) { diasMes.set(m, (diasMes.get(m) || 0) + 1); ultimoDia = d; }
    if (okFonte(f)) r.geracaoPorSub[s] += mwh;
    if (!okSub(s)) continue;
    r.totalSub += mwh;
    if (RENOVAVEL[f]) r.renovSub += mwh;
    if (f === 2) { r.solar += mwh; r.mmgd += G.mmgd[i]; }
    if (!okFonte(f)) continue;
    r.serieGeracao[idx.get(chaveDoDia(d))][f] += mwh;
    r.porFonte[f] += mwh;
    if (!despMes.has(m)) despMes.set(m, [0, 0, 0, 0, 0]);
    despMes.get(m)[f] += G.desp[i];
  }
  r.temGeracao = temGeracao;
  r.diasGeracao = [...diasMes.values()].reduce((a, b) => a + b, 0);
  // a geração só existe a partir de 2024: os gráficos dela começam no primeiro intervalo com dado
  r.inicioGeracao = Math.max(0, ints.findIndex(x => x.fim >= DIA_MIN_GERACAO));

  // carga
  const C = D.carga;
  const somaInt = ints.map(() => [0, 0, 0, 0]), diasInt = ints.map(() => [0, 0, 0, 0]);
  const totalDia = new Map();
  r.cargaPorSub = [0, 0, 0, 0];
  for (let i = 0; i < C.d.length; i++) {
    const d = C.d[i];
    if (d < ini || d > fim) continue;
    const s = C.s[i], mw = C.mwmed[i];
    r.cargaPorSub[s] += mw * 24;
    if (!okSub(s)) continue;
    const k = idx.get(chaveDoDia(d));
    somaInt[k][s] += mw; diasInt[k][s] += 1;
    totalDia.set(d, (totalDia.get(d) || 0) + mw);
  }
  r.serieCarga = somaInt.map((v, k) => v.map((x, s) => diasInt[k][s] ? x / diasInt[k][s] / 1000 : null));
  let soma = 0, pico = -1, diaPico = null;
  for (const [d, v] of totalDia) { soma += v; if (v > pico) { pico = v; diaPico = d; } }
  r.cargaMedia = totalDia.size ? soma / totalDia.size / 1000 : null;
  r.pico = pico > 0 ? pico / 1000 : null;
  r.diaPico = diaPico;

  // perfil horário nos meses do período
  const mi = mesDoDia(ini), mf = mesDoDia(fim);
  const P = D.perfil;
  r.perfil = Array.from({ length: 5 }, () => Array(24).fill(0));
  let diasPerfil = 0;
  for (let m = mi; m <= mf; m++) diasPerfil += DIAS_POR_MES.get(m) || 0;
  for (let i = 0; i < P.m.length; i++) {
    if (P.m[i] < mi || P.m[i] > mf || !okSub(P.s[i]) || !okFonte(P.f[i])) continue;
    r.perfil[P.f[i]][P.h[i]] += P.mwh[i];
  }
  r.perfil = r.perfil.map(h => h.map(v => diasPerfil ? v / diasPerfil / 1000 : 0));
  r.diasPerfil = diasPerfil;

  // capacidade no fim de cada intervalo, e no fim de cada mês para o fator
  r.serieCapacidade = capacidadeNasDatas(ints.map(x => x.fim)).map(v => v.map(x => x / 1000));
  r.capacidadeFinal = r.serieCapacidade.length ? r.serieCapacidade[r.serieCapacidade.length - 1].reduce((a, b) => a + b, 0) : null;
  const meses = [...despMes.keys()].sort((a, b) => a - b);
  const capMeses = capacidadeNasDatas(meses.map(m => Math.min(fimDoMes(m), fim)));
  r.fator = { meses: meses.map(rotuloMes), valores: [0, 1, 2, 3, 4].map(f => meses.map((m, k) => {
    const cap = capMeses[k][f], horas = (diasMes.get(m) || 0) * 24;
    return cap > 0 && horas ? 100 * despMes.get(m)[f] / (cap * horas) : null;
  })) };

  // intercâmbio
  const I = D.intercambio;
  r.serieIntercambio = ints.map(() => [0, 0, 0, 0]);
  r.saldo = [0, 0, 0, 0];
  for (let i = 0; i < I.d.length; i++) {
    const d = I.d[i];
    if (d < ini || d > fim) continue;
    const p = I.p[i], mwh = I.mwh[i];
    const [a, b] = PARES[p];
    r.saldo[a] += mwh; r.saldo[b] -= mwh;
    if (estado.subs.size && !estado.subs.has(a) && !estado.subs.has(b)) continue;
    r.serieIntercambio[idx.get(chaveDoDia(d))][p] += mwh;
  }

  // ranking de usinas por mês
  const U = D.usina_mes, busca = estado.busca.trim().toLowerCase();
  const porUsina = new Map();
  for (let i = 0; i < U.u.length; i++) {
    if (U.m[i] < mi || U.m[i] > mf) continue;
    const u = D.usinas[U.u[i]];
    if (!okSub(u.si) || !okFonte(u.fi)) continue;
    if (busca && !u.busca.includes(busca)) continue;
    porUsina.set(U.u[i], (porUsina.get(U.u[i]) || 0) + U.mwh[i]);
  }
  r.ranking = [...porUsina].sort((a, b) => b[1] - a[1]);
  r.totalRanking = r.ranking.reduce((a, x) => a + x[1], 0);
  return r;
}

// ---------- gráficos ----------
const graficos = {};
function grafico(id) {
  if (!graficos[id]) graficos[id] = echarts.init(document.getElementById(id));
  return graficos[id];
}
window.addEventListener('resize', () => Object.values(graficos).forEach(g => g.resize()));

function base(extra = {}) {
  const texto = css('--suave'), borda = css('--borda');
  return echarts.util.merge({
    animationDuration: 300,
    textStyle: { color: texto, fontFamily: 'system-ui, sans-serif' },
    grid: { left: 52, right: 16, top: 60, bottom: 36, containLabel: false },
    legend: { top: 0, textStyle: { color: texto }, type: 'scroll' },
    tooltip: { trigger: 'axis', confine: true },
    xAxis: { type: 'category', axisLine: { lineStyle: { color: borda } }, axisLabel: { color: texto } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: borda } }, axisLabel: { color: texto }, nameTextStyle: { color: texto } },
  }, extra, true);
}

function vazio(id, texto) {
  grafico(id).setOption({
    title: { text: texto, left: 'center', top: 'middle', textStyle: { color: css('--suave'), fontSize: 13, fontWeight: 'normal' } },
    xAxis: { show: false }, yAxis: { show: false }, series: [],
  }, true);
}

const zoomSe = n => n > 60 ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4 }] : [];
const SEM_GERACAO = 'Sem dados de geração neste período (a série começa em jan/2024)';

function desenharGeracao(r) {
  if (!r.temGeracao) return vazio('g-geracao', SEM_GERACAO);
  const pct = estado.modoGeracao === 'pct';
  const unidade = estado.gran === 'dia' ? 'GWh' : 'TWh', div = estado.gran === 'dia' ? 1e3 : 1e6;
  const serie = r.serieGeracao.slice(r.inicioGeracao);
  const rotulos = r.intervalos.slice(r.inicioGeracao).map(x => x.rotulo);
  const totais = serie.map(v => v.reduce((a, b) => a + b, 0));
  const n = serie.length;
  grafico('g-geracao').setOption(base({
    grid: { bottom: n > 60 ? 56 : 36 },
    tooltip: { valueFormatter: v => v == null ? '–' : fmt(v) + (pct ? '%' : ' ' + unidade) },
    xAxis: { data: rotulos },
    yAxis: { name: pct ? '%' : unidade, max: pct ? 100 : null },
    dataZoom: zoomSe(n),
    series: [0, 1, 2, 3, 4].filter(f => okFonte(f)).map(f => ({
      name: NOMES_FONTE[f], type: 'bar', stack: 't', barMaxWidth: 28,
      itemStyle: { color: CORES_FONTE[f] },
      data: serie.map((v, k) => pct ? (totais[k] ? 100 * v[f] / totais[k] : null) : v[f] / div),
    })),
  }), true);
}

function desenharMatriz(r) {
  if (!r.temGeracao) return vazio('g-matriz', SEM_GERACAO);
  const total = r.porFonte.reduce((a, b) => a + b, 0);
  grafico('g-matriz').setOption({
    textStyle: { color: css('--suave') },
    tooltip: { trigger: 'item', confine: true, formatter: p => `${p.name}<br>${fmt(p.value / 1e6)} TWh · ${fmt(p.percent)}%` },
    legend: { bottom: 0, textStyle: { color: css('--suave') }, type: 'scroll' },
    title: { text: fmt(total / 1e6) + ' TWh', subtext: 'no período', left: 'center', top: '38%',
             textStyle: { color: css('--texto'), fontSize: 18 }, subtextStyle: { color: css('--suave') } },
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '45%'], avoidLabelOverlap: true,
      label: { position: 'inside', color: '#fff', fontWeight: 600, formatter: p => p.percent >= 4 ? `${fmt(p.percent, 0)}%` : '' },
      data: [0, 1, 2, 3, 4].filter(f => r.porFonte[f] > 0).map(f => ({
        name: NOMES_FONTE[f], value: r.porFonte[f], itemStyle: { color: CORES_FONTE[f] },
      })),
    }],
  }, true);
}

function desenharSubsistemas(r) {
  const sel = s => estado.subs.size === 0 || estado.subs.has(s);
  const estilo = (cor, s) => ({ color: cor, opacity: sel(s) ? 1 : .3 });
  grafico('g-subsistemas').setOption(base({
    tooltip: { valueFormatter: v => fmt(v) + ' TWh' },
    xAxis: { data: D.categorias.s.map((s, i) => `${s}\n${NOMES_SUBS[i].split('/')[0]}`), axisLabel: { interval: 0 } },
    yAxis: { name: 'TWh' },
    series: [
      { name: 'Geração', type: 'bar', barMaxWidth: 34, itemStyle: { color: '#2f6fb0' },
        data: r.geracaoPorSub.map((v, s) => ({ value: r.temGeracao ? v / 1e6 : null, itemStyle: estilo('#2f6fb0', s) })) },
      { name: 'Carga', type: 'bar', barMaxWidth: 34, itemStyle: { color: '#c0504d' },
        data: r.cargaPorSub.map((v, s) => ({ value: v / 1e6, itemStyle: estilo('#c0504d', s) })) },
    ],
  }), true);
}

function desenharPerfil(r) {
  if (!r.temGeracao) return vazio('g-perfil', SEM_GERACAO);
  grafico('g-perfil').setOption(base({
    tooltip: { valueFormatter: v => fmt(v) + ' GW' },
    xAxis: { data: [...Array(24).keys()], boundaryGap: false, name: 'hora', nameLocation: 'middle', nameGap: 26 },
    yAxis: { name: 'GW' },
    series: [0, 1, 2, 3, 4].filter(f => okFonte(f)).map(f => ({
      name: NOMES_FONTE[f], type: 'line', stack: 't', showSymbol: false,
      areaStyle: { opacity: .85 }, lineStyle: { width: 1, color: CORES_FONTE[f] }, itemStyle: { color: CORES_FONTE[f] },
      data: r.perfil[f],
    })),
  }), true);
}

function desenharFator(r) {
  if (!r.fator.meses.length) return vazio('g-fator', SEM_GERACAO);
  grafico('g-fator').setOption(base({
    tooltip: { valueFormatter: v => v == null ? '–' : fmt(v) + '%' },
    xAxis: { data: r.fator.meses, boundaryGap: false },
    yAxis: { name: '%', max: 100 },
    series: [0, 1, 2, 3, 4].filter(f => okFonte(f)).map(f => ({
      name: NOMES_FONTE[f], type: 'line', showSymbol: r.fator.meses.length < 3, data: r.fator.valores[f],
      lineStyle: { color: CORES_FONTE[f] }, itemStyle: { color: CORES_FONTE[f] },
    })),
  }), true);
}

function desenharCarga(r) {
  const n = r.intervalos.length;
  grafico('g-carga').setOption(base({
    grid: { bottom: n > 60 ? 56 : 36 },
    tooltip: { valueFormatter: v => v == null ? '–' : fmt(v) + ' GW' },
    xAxis: { data: r.intervalos.map(x => x.rotulo), boundaryGap: false },
    yAxis: { name: 'GW' },
    dataZoom: zoomSe(n),
    series: [0, 1, 2, 3].filter(s => okSub(s)).map(s => ({
      name: NOMES_SUBS[s], type: 'line', stack: 't', showSymbol: false, sampling: 'lttb',
      areaStyle: { opacity: .8 }, lineStyle: { width: 1, color: CORES_SUBS[s] }, itemStyle: { color: CORES_SUBS[s] },
      data: r.serieCarga.map(v => v[s]),
    })),
  }), true);
}

function desenharCapacidade(r) {
  grafico('g-capacidade').setOption(base({
    tooltip: { valueFormatter: v => fmt(v) + ' GW' },
    xAxis: { data: r.intervalos.map(x => x.rotulo), boundaryGap: false },
    yAxis: { name: 'GW' },
    series: [0, 1, 2, 3, 4].filter(f => okFonte(f)).map(f => ({
      name: NOMES_FONTE[f], type: 'line', stack: 't', showSymbol: r.intervalos.length < 3,
      areaStyle: { opacity: .85 }, lineStyle: { width: 1, color: CORES_FONTE[f] }, itemStyle: { color: CORES_FONTE[f] },
      data: r.serieCapacidade.map(v => v[f]),
    })),
  }), true);
}

function desenharIntercambio(r) {
  const unidade = estado.gran === 'dia' ? 'GWh' : 'TWh', div = estado.gran === 'dia' ? 1e3 : 1e6;
  const n = r.intervalos.length;
  const visiveis = [0, 1, 2, 3].filter(p => !estado.subs.size || estado.subs.has(PARES[p][0]) || estado.subs.has(PARES[p][1]));
  grafico('g-intercambio').setOption(base({
    grid: { bottom: n > 60 ? 56 : 36 },
    tooltip: { valueFormatter: v => fmt(v) + ' ' + unidade },
    xAxis: { data: r.intervalos.map(x => x.rotulo) },
    yAxis: { name: unidade },
    dataZoom: zoomSe(n),
    series: visiveis.map(p => ({
      name: D.categorias.p[p].replace('-', '→'), type: 'bar', barMaxWidth: 12,
      itemStyle: { color: CORES_PARES[p] }, data: r.serieIntercambio.map(v => v[p] / div),
    })),
  }), true);
}

function desenharSaldo(r) {
  grafico('g-saldo').setOption(base({
    grid: { left: 150, top: 8, bottom: 28 },
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br>${p.value >= 0 ? 'enviou' : 'recebeu'} ${fmt(Math.abs(p.value))} TWh` },
    xAxis: { type: 'value', name: 'TWh', splitLine: { lineStyle: { color: css('--borda') } } },
    yAxis: { type: 'category', data: NOMES_SUBS, inverse: true, splitLine: { show: false } },
    series: [{
      type: 'bar', barMaxWidth: 22,
      label: { show: true, position: 'right', color: css('--suave'), formatter: p => fmt(p.value) },
      data: r.saldo.map((v, s) => ({
        value: v / 1e6,
        itemStyle: { color: v >= 0 ? '#2a9d8f' : '#c0504d', opacity: !estado.subs.size || estado.subs.has(s) ? 1 : .3 },
      })),
    }],
  }), true);
}

// ---------- tabelas ----------
function tabela(id, colunas, linhas, aoClicar) {
  const t = document.getElementById(id);
  t.innerHTML = '<thead><tr>' + colunas.map(c => `<th class="${c.num ? 'num' : ''}">${c.titulo}</th>`).join('') + '</tr></thead>'
    + '<tbody>' + linhas.map((l, i) => `<tr data-i="${i}" class="${l.classe || ''}">`
      + colunas.map(c => `<td class="${c.num ? 'num' : ''}">${c.valor(l)}</td>`).join('') + '</tr>').join('') + '</tbody>';
  if (aoClicar) t.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => aoClicar(linhas[tr.dataset.i])));
}

const escapar = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function desenharRanking(r) {
  const topo = r.ranking.slice(0, estado.qtd);
  const maior = topo.length ? topo[0][1] : 1;
  const linhas = topo.map(([u, mwh], i) => ({
    u, mwh, pos: i + 1, ...D.usinas[u], classe: u === estado.usina ? 'selecionada' : '',
  }));
  tabela('ranking', [
    { titulo: '#', num: true, valor: l => l.pos },
    { titulo: 'Usina', valor: l => escapar(l.nome) },
    { titulo: 'Fonte', valor: l => NOMES_FONTE[l.fi] },
    { titulo: 'UF', valor: l => l.uf },
    { titulo: 'Subsistema', valor: l => D.categorias.s[l.si] },
    { titulo: 'GWh', num: true, valor: l => fmtInt(l.mwh / 1e3) },
    { titulo: '% do filtro', num: true, valor: l => fmt(100 * l.mwh / r.totalRanking) + '%' },
    { titulo: '', valor: l => `<div class="barra" style="width:${Math.max(2, 100 * l.mwh / maior)}px;background:${CORES_FONTE[l.fi]}"></div>` },
  ], linhas, l => { estado.usina = l.u; atualizar(); document.getElementById('detalhe').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  if (!linhas.length) document.querySelector('#ranking tbody').innerHTML = '<tr><td colspan="8">Nenhuma usina com geração para os filtros escolhidos.</td></tr>';
}

function desenharDetalheUsina() {
  const painel = document.getElementById('detalhe');
  if (estado.usina == null) { painel.hidden = true; return; }
  painel.hidden = false;
  const u = D.usinas[estado.usina], U = D.usina_mes;
  const serie = new Map();
  for (let i = 0; i < U.u.length; i++) if (U.u[i] === estado.usina) serie.set(U.m[i], U.mwh[i]);
  const meses = [...serie.keys()].sort((a, b) => a - b);
  document.getElementById('detalhe-titulo').textContent = u.nome;
  document.getElementById('detalhe-nota').textContent =
    `${NOMES_FONTE[u.fi]} · ${u.uf} · subsistema ${D.categorias.s[u.si]} · ${u.modalidade}` +
    (u.agregado ? ' · agregado de pequenas usinas' : '') + '. Faixa destacada: período filtrado.';
  const mi = mesDoDia(estado.ini), mf = mesDoDia(estado.fim);
  const rotulos = meses.map(rotuloMes);
  const dentro = rotulos.filter((_, k) => meses[k] >= mi && meses[k] <= mf);
  setTimeout(() => {
    grafico('g-usina').resize();
    grafico('g-usina').setOption(base({
      legend: { show: false },
      tooltip: { valueFormatter: v => fmt(v) + ' GWh' },
      xAxis: { data: rotulos },
      yAxis: { name: 'GWh' },
      series: [{
        type: 'bar', barMaxWidth: 18, itemStyle: { color: CORES_FONTE[u.fi] },
        data: meses.map(m => serie.get(m) / 1e3),
        markArea: dentro.length ? { itemStyle: { color: 'rgba(120,140,170,.15)' }, data: [[{ xAxis: dentro[0] }, { xAxis: dentro[dentro.length - 1] }]] } : undefined,
      }],
    }), true);
  });
}

function baixarCsv(r) {
  const linhas = [['posicao', 'usina', 'fonte', 'uf', 'subsistema', 'modalidade', 'energia_mwh']];
  r.ranking.forEach(([u, mwh], i) => {
    const x = D.usinas[u];
    linhas.push([i + 1, x.nome, D.categorias.f[x.fi], x.uf, D.categorias.s[x.si], x.modalidade, Math.round(mwh)]);
  });
  const csv = linhas.map(l => l.map(v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `ranking_usinas_${isoDoDia(estado.ini)}_${isoDoDia(estado.fim)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- indicadores e controles ----------
function desenharKpis(r) {
  const set = (id, v) => { document.getElementById(id).textContent = v; };
  const total = r.porFonte.reduce((a, b) => a + b, 0);
  set('k-energia', r.temGeracao ? fmt(total / 1e6) + ' TWh' : '–');
  const parcial = estado.ini < DIA_MIN_GERACAO ? ' (geração desde ' + dataBR(DIA_MIN_GERACAO) + ')' : '';
  set('k-energia-x', r.temGeracao ? `média de ${fmt(total / (r.diasGeracao * 24) / 1e3)} GW${parcial}` : 'geração disponível a partir de 2024');
  set('k-renovavel', r.totalSub ? fmt(100 * r.renovSub / r.totalSub, 0) + '%' : '–');
  set('k-carga', r.cargaMedia != null ? fmt(r.cargaMedia) + ' GW' : '–');
  set('k-carga-x', `${estado.subs.size ? 'subsistemas filtrados' : 'SIN'}, média diária`);
  set('k-pico', r.pico != null ? fmt(r.pico) + ' GW' : '–');
  set('k-pico-x', r.diaPico != null ? 'em ' + dataBR(r.diaPico) : '');
  set('k-capacidade', r.capacidadeFinal != null ? fmt(r.capacidadeFinal, 0) + ' GW' : '–');
  set('k-capacidade-x', 'em ' + dataBR(estado.fim));
  set('k-mmgd', r.solar ? fmt(100 * r.mmgd / r.solar, 0) + '%' : '–');
}

function botoes(id, itens, ativo, aoClicar, classe = 'botao') {
  const el = document.getElementById(id);
  el.innerHTML = itens.map(([v, rotulo, cor]) =>
    `<button type="button" class="${classe}${ativo(v) ? ' ativo' : ''}" data-v="${v}" aria-pressed="${ativo(v)}">`
    + (cor ? `<span class="ponto" style="background:${cor}"></span>` : '') + `${rotulo}</button>`).join(' ');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => aoClicar(b.dataset.v)));
}

function desenharControles() {
  botoes('f-periodo', presets(), v => estado.preset === v, v => { aplicarPreset(v); atualizar(); });
  botoes('f-subs', D.categorias.s.map((s, i) => [i, `${s} · ${NOMES_SUBS[i]}`]), v => estado.subs.has(Number(v)),
    v => { alternar(estado.subs, Number(v)); atualizar(); }, 'chip');
  botoes('f-fontes', D.categorias.f.map((f, i) => [i, NOMES_FONTE[i], CORES_FONTE[i]]), v => estado.fontes.has(Number(v)),
    v => { alternar(estado.fontes, Number(v)); atualizar(); }, 'chip');
  botoes('f-gran', [['dia', 'Dia'], ['mes', 'Mês'], ['ano', 'Ano']], v => estado.gran === v, v => {
    if (v === 'dia' && estado.fim - estado.ini > 800) { estado.gran = 'mes'; } else { estado.gran = v; }
    atualizar();
  });
  botoes('modo-geracao', [['abs', 'Energia'], ['pct', '% do total']], v => estado.modoGeracao === v,
    v => { estado.modoGeracao = v; atualizar(); });
  botoes('qtd-ranking', [[10, 'Top 10'], [20, 'Top 20'], [50, 'Top 50']], v => estado.qtd === Number(v),
    v => { estado.qtd = Number(v); atualizar(); });
  const iniEl = document.getElementById('f-ini'), fimEl = document.getElementById('f-fim');
  iniEl.value = isoDoDia(estado.ini); fimEl.value = isoDoDia(estado.fim);

  const partes = [`${dataBR(estado.ini)} a ${dataBR(estado.fim)}`];
  partes.push(estado.subs.size ? 'subsistemas ' + [...estado.subs].map(i => D.categorias.s[i]).join(', ') : 'todos os subsistemas');
  partes.push(estado.fontes.size ? [...estado.fontes].map(i => NOMES_FONTE[i].toLowerCase()).join(', ') : 'todas as fontes');
  partes.push({ dia: 'por dia', mes: 'por mês', ano: 'por ano' }[estado.gran]);
  document.getElementById('resumo').textContent = 'Mostrando: ' + partes.join(' · ');
}

let ultimo;
function atualizar() {
  // agrupamento diário com anos de histórico geraria milhares de barras
  if (estado.gran === 'dia' && estado.fim - estado.ini > 800) estado.gran = 'mes';
  const r = calcular();
  ultimo = r;
  desenharControles();
  desenharKpis(r);
  desenharGeracao(r);
  desenharMatriz(r);
  desenharSubsistemas(r);
  desenharPerfil(r);
  desenharFator(r);
  desenharCarga(r);
  desenharCapacidade(r);
  desenharIntercambio(r);
  desenharSaldo(r);
  desenharRanking(r);
  desenharDetalheUsina();
  salvarNaUrl();
}

// filtro cruzado: clicar num visual filtra a página
function ligarCliques() {
  const fontePorNome = nome => NOMES_FONTE.indexOf(nome);
  grafico('g-geracao').on('click', p => { const f = fontePorNome(p.seriesName); if (f >= 0) { alternar(estado.fontes, f); atualizar(); } });
  grafico('g-matriz').on('click', p => { const f = fontePorNome(p.name); if (f >= 0) { alternar(estado.fontes, f); atualizar(); } });
  grafico('g-subsistemas').on('click', p => { alternar(estado.subs, p.dataIndex); atualizar(); });
  grafico('g-saldo').on('click', p => { alternar(estado.subs, p.dataIndex); atualizar(); });

  document.getElementById('f-ini').addEventListener('change', e => {
    const d = diaDoIso(e.target.value); if (Number.isNaN(d)) return;
    estado.preset = null; estado.ini = Math.max(0, Math.min(d, estado.fim)); atualizar();
  });
  document.getElementById('f-fim').addEventListener('change', e => {
    const d = diaDoIso(e.target.value); if (Number.isNaN(d)) return;
    estado.preset = null; estado.fim = Math.min(DIA_MAX, Math.max(d, estado.ini)); atualizar();
  });
  document.getElementById('limpar').addEventListener('click', () => {
    estado.subs.clear(); estado.fontes.clear(); estado.busca = ''; estado.usina = null; estado.modoGeracao = 'abs';
    document.getElementById('busca').value = '';
    aplicarPreset('12m'); atualizar();
  });
  let espera;
  document.getElementById('busca').addEventListener('input', e => {
    clearTimeout(espera);
    espera = setTimeout(() => { estado.busca = e.target.value; atualizar(); }, 200);
  });
  document.getElementById('baixar').addEventListener('click', () => baixarCsv(ultimo));
  document.getElementById('fechar-detalhe').addEventListener('click', () => { estado.usina = null; atualizar(); });
}

function tabelasQualidade() {
  const n = v => v.toLocaleString('pt-BR');
  tabela('t-qualidade', [
    { titulo: 'Fonte', valor: l => l.fonte },
    { titulo: 'Lidas', num: true, valor: l => n(l.linhas_lidas) },
    { titulo: 'Gravadas', num: true, valor: l => n(l.linhas_gravadas) },
    { titulo: 'Quarentena', num: true, valor: l => n(l.linhas_rejeitadas) },
  ], D.qualidade);
  tabela('t-quarentena', [
    { titulo: 'Fonte', valor: l => l.fonte },
    { titulo: 'Motivo da rejeição', valor: l => escapar(l.motivo) },
    { titulo: 'Linhas', num: true, valor: l => n(l.linhas) },
  ], D.quarentena);
  tabela('t-execucoes', [
    { titulo: 'Ingestão', valor: l => new Date(l.inicio).toLocaleString('pt-BR') },
    { titulo: 'Status', valor: l => l.status },
    { titulo: 'Resultado', valor: l => l.detalhe },
    { titulo: 'Duração', num: true, valor: l => fmt(l.duracao_s) + ' s' },
  ], D.execucoes);
}

function preparar(dados) {
  D = dados;
  const nomeFonte = Object.fromEntries(D.fontes.map(f => [f.fonte_id, f.nome_fonte]));
  const renov = Object.fromEntries(D.fontes.map(f => [f.fonte_id, f.renovavel]));
  const nomeSub = Object.fromEntries(D.subsistemas.map(s => [s.subsistema_id, s.nome_subsistema]));
  NOMES_FONTE = D.categorias.f.map(f => nomeFonte[f]);
  RENOVAVEL = D.categorias.f.map(f => renov[f]);
  NOMES_SUBS = D.categorias.s.map(s => nomeSub[s]);
  PARES = D.categorias.p.map(p => p.split('-').map(s => D.categorias.s.indexOf(s)));
  D.usinas.forEach(u => {
    u.fi = D.categorias.f.indexOf(u.f);
    u.si = D.categorias.s.indexOf(u.s);
    u.busca = `${u.nome} ${u.uf}`.toLowerCase();
  });
  DIA_MIN_GERACAO = Math.min(...D.geracao.d.slice(0, 1));
  DIA_MAX = Math.max(D.geracao.d[D.geracao.d.length - 1], D.carga.d[D.carga.d.length - 1]);
  DIAS_POR_MES = new Map();
  let anterior = -1;
  for (const d of D.geracao.d) {
    if (d === anterior) continue;
    anterior = d;
    const m = mesDoDia(d);
    DIAS_POR_MES.set(m, (DIAS_POR_MES.get(m) || 0) + 1);
  }
}

fetch('dados.json').then(r => r.json()).then(dados => {
  preparar(dados);
  document.getElementById('dados-ate').textContent = dataBR(DIA_MAX);
  document.getElementById('gerado-em').textContent = new Date(D.gerado_em).toLocaleString('pt-BR');
  if (!lerDaUrl()) aplicarPreset('12m');
  tabelasQualidade();
  ligarCliques();
  atualizar();
}).catch(e => {
  document.getElementById('erro').style.display = 'block';
  console.error(e);
});
