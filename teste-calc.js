// Teste dos cálculos com os dados iniciais.
// No navegador: abra teste.html. No Node (se tiver): node teste-calc.js
const _node = typeof module !== 'undefined';
const C = _node ? require('./calc.js') : window.Calc;
const S = _node ? require('./seed.js') : window;
const saida = [];
const log = s => saida.push(s);

const metas = S.SEED.metas.map((m, i) => ({ id: 'g' + i, start_date: '2026-10-18', ...m }));
const porCsv = Object.fromEntries(metas.map(m => [m.csv, m]));
const { entries } = S.csvParaLinhas(S.SEED.csv, porCsv);
const mapa = Object.fromEntries(entries.map(e => [e.goal_id + '|' + e.day, e]));

function mostra(titulo, de, ate, hoje) {
  const r = C.resumo(metas, mapa, de, ate, hoje);
  log(`\n${titulo} (${de} a ${ate}, hoje=${hoje})`);
  for (const m of metas) {
    const x = r.porMeta[m.id];
    const det = x ? (x.soma != null ? `${x.soma}/${x.alvo} págs, ${x.diasOk}/${x.diasConta} dias ≥ alvo` : `${x.diasOk}/${x.diasConta} dias`) : '';
    log(`  ${m.name.padEnd(20)} ${C.pctTexto(x && x.pct).padStart(5)}  ${C.cor(x && x.pct).padEnd(9)} ${det}`);
  }
  log(`  ${'Média geral'.padEnd(20)} ${(r.media * 100).toFixed(1)}%  ${C.cor(r.media)}`);
}

mostra('Semana 1', '2026-10-18', '2026-10-24', '2026-10-26');
mostra('Semana 2 (parcial)', '2026-10-25', '2026-10-31', '2026-10-26');
if (_node) console.log(saida.join('\n')); else document.getElementById('saida').textContent = saida.join('\n');
