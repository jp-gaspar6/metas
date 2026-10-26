// =====================================================================
// graficos.js — telas Gráficos e Unhas (Chart.js)
// Usa o estado, o cálculo (C) e os auxiliares definidos em app.js.
// =====================================================================
const graf = { meta: 'media', dias: 30, agrupUnhas: 'semana' };
const instancias = {};   // gráficos já desenhados (destruídos antes de redesenhar)

// Cores atuais do tema (lidas do CSS, para funcionar no claro e no escuro)
function corCss(nome) { return getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); }
function corPct(p) { const c = C.cor(p); return c ? corCss('--' + c) : corCss('--borda'); }

function desenhar(id, config) {
  if (instancias[id]) instancias[id].destroy();
  const texto = corCss('--suave'), grade = corCss('--borda');
  Chart.defaults.color = texto;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const eixos = config.options && config.options.scales;
  if (eixos) for (const e of Object.values(eixos)) { e.grid = { color: grade, ...(e.grid || {}) }; e.border = { display: false }; }
  instancias[id] = new Chart(document.getElementById(id), {
    ...config,
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, ...config.options,
               plugins: { legend: { display: false }, ...(config.options.plugins || {}) } }
  });
}

// Primeiro dia exibido conforme o seletor de período (0 = desde o início)
function inicioJanela() {
  const hoje = C.hoje();
  const inicio = estado.metas.reduce((m, g) => g.start_date < m ? g.start_date : m, hoje);
  if (!graf.dias) return inicio;
  const d = C.somaDias(hoje, -(graf.dias - 1));
  return d > inicio ? d : inicio;
}

// ---------------------------------------------------------------------
// Tela Gráficos
// ---------------------------------------------------------------------
function renderGraficos() {
  const metas = estado.metas;
  if (graf.meta !== 'media' && !metas.some(m => m.id === graf.meta)) graf.meta = 'media';

  // Chips: Média geral + uma por meta (com a cor da meta)
  $('#graf-metas').innerHTML = `<button data-meta="media" class="${graf.meta === 'media' ? 'sel' : ''}">✨ Média geral</button>` +
    metas.map((m, i) => {
      const [icone, cor] = visual(m, i);
      return `<button data-meta="${m.id}" style="--cor:${cor}" class="${graf.meta === m.id ? 'sel' : ''}">${icone} ${m.name}</button>`;
    }).join('');
  document.querySelectorAll('#graf-periodo button').forEach(b => b.classList.toggle('sel', Number(b.dataset.dias) === graf.dias));

  const hoje = C.hoje();
  const meta = metas.find(m => m.id === graf.meta);
  const corMeta = meta ? visual(meta, metas.indexOf(meta))[1] : corCss('--primaria');
  const janela = inicioJanela();

  // (a) % por semana: semanas que tocam a janela
  const semanas = listaPeriodos('semana').reverse().filter(([, ate]) => ate >= janela);
  const pcts = semanas.map(([de, ate]) => {
    if (!meta) return C.resumo(metas, estado.mapa, de, ate, hoje).media;
    const r = C.pctMeta(meta, estado.mapa, de, ate, hoje);
    return r ? r.pct : null;
  });
  desenhar('graf-semanal', {
    type: 'bar',
    data: {
      labels: semanas.map(([de, ate]) => ddmm(de) + (ate >= hoje ? '*' : '')),
      datasets: [{ data: pcts.map(p => p == null ? null : Math.round(p * 100)),
                   backgroundColor: pcts.map(corPct), borderRadius: 8, maxBarThickness: 42 }]
    },
    options: {
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%', stepSize: 25 } }, x: { grid: { display: false } } },
      plugins: { tooltip: { callbacks: { label: c => `${c.raw}%`, title: c => 'Semana de ' + c[0].label.replace('*', ' (parcial)') } } }
    }
  });

  // (b) valores diários da janela
  const dias = C.listaDias(janela, hoje);
  const rotulos = dias.map(d => ddmm(d));
  if (!meta) {
    // Média: % das metas cumpridas em cada dia
    $('#graf-diario-tit').textContent = '% das metas cumpridas por dia';
    const vals = dias.map(d => {
      const dow = C.diaSemana(d);
      const contam = metas.filter(m => m.weekdays.includes(dow) && d >= m.start_date);
      if (!contam.length) return null;
      return Math.round(contam.filter(m => C.cumpriu(m, C.valor(m, estado.mapa, d))).length / contam.length * 100);
    });
    desenhar('graf-diario', {
      type: 'line',
      data: { labels: rotulos, datasets: [{ data: vals, borderColor: corMeta, backgroundColor: corMeta + '33', fill: true, tension: .35, pointRadius: 2 }] },
      options: { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } } }
    });
  } else if (meta.kind === 'numeric') {
    $('#graf-diario-tit').textContent = `${meta.name} por dia (${meta.unit || ''})`;
    const vals = dias.map(d => { const e = estado.mapa[meta.id + '|' + d]; return e && e.num_value != null ? Number(e.num_value) : 0; });
    desenhar('graf-diario', {
      data: {
        labels: rotulos,
        datasets: [
          { type: 'bar', label: meta.name, data: vals, borderRadius: 6, maxBarThickness: 26,
            // Dias em que a meta não conta ficam mais claros
            backgroundColor: dias.map(d => meta.weekdays.includes(C.diaSemana(d)) ? corMeta : corMeta + '55') },
          { type: 'line', label: 'Meta', data: dias.map(() => Number(meta.target)), borderColor: corCss('--texto'),
            borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0 }
        ]
      },
      options: { scales: { y: { beginAtZero: true }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } } }
    });
  } else {
    // Sim/não: barra verde = sucesso, vermelha = não cumpriu; dias que não contam ficam de fora
    $('#graf-diario-tit').textContent = `${meta.name} por dia`;
    const vals = dias.map(d => {
      if (!meta.weekdays.includes(C.diaSemana(d))) return null;
      const v = C.valor(meta, estado.mapa, d);
      return v == null ? null : (C.cumpriu(meta, v) ? 1 : -1);
    });
    desenhar('graf-diario', {
      type: 'bar',
      data: { labels: rotulos, datasets: [{ data: vals, borderRadius: 6, maxBarThickness: 26,
              backgroundColor: vals.map(v => v === 1 ? corCss('--verde') : corCss('--vermelho')) }] },
      options: {
        scales: { y: { min: -1, max: 1, ticks: { stepSize: 1, callback: v => v === 1 ? 'cumpriu' : v === -1 ? 'não' : '' } },
                  x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } },
        plugins: { tooltip: { callbacks: { label: c => c.raw === 1 ? 'cumpriu' : 'não cumpriu' } } }
      }
    });
  }
}

$('#graf-metas').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-meta]');
  if (b) { graf.meta = b.dataset.meta; renderGraficos(); }
});
$('#graf-periodo').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-dias]');
  if (b) { graf.dias = Number(b.dataset.dias); renderGraficos(); }
});

// ---------------------------------------------------------------------
// Tela Unhas: a meta sim/não que tem campo Sentimento
// ---------------------------------------------------------------------
function metaUnhas() { return estado.metas.find(m => m.kind === 'boolean' && m.feeling_on != null); }

// "Roeu" = resposta diferente da de sucesso (dia em branco usa o valor padrão)
function roeu(meta, d) { const v = C.valor(meta, estado.mapa, d); return v != null && v !== meta.success_value; }

function renderUnhas() {
  const meta = metaUnhas();
  if (!meta) { $('#unhas-kpis').innerHTML = '<p class="dica">Nenhuma meta com campo Sentimento.</p>'; return; }
  const hoje = C.hoje();
  const dias = C.listaDias(meta.start_date, hoje).filter(d => meta.weekdays.includes(C.diaSemana(d)));
  const roidos = dias.filter(d => roeu(meta, d));
  const rosa = '#ec4899';

  // KPIs: sequência atual sem roer, dias roídos na semana e no mês
  let seq = 0;
  for (let i = dias.length - 1; i >= 0 && !roeu(meta, dias[i]); i--) seq++;
  const iniSem = C.inicioSemana(hoje), iniMes = C.inicioMes(hoje);
  $('#unhas-kpis').innerHTML = `
    <div class="kpi destaque"><strong>${seq}</strong><span>dias seguidos sem roer</span></div>
    <div class="kpi"><strong>${roidos.filter(d => d >= iniSem).length}</strong><span>roídos nesta semana</span></div>
    <div class="kpi"><strong>${roidos.filter(d => d >= iniMes).length}</strong><span>roídos neste mês</span></div>`;

  // Dias roídos por semana ou mês
  document.querySelectorAll('#unhas-agrup button').forEach(b => b.classList.toggle('sel', b.dataset.agrup === graf.agrupUnhas));
  const periodos = listaPeriodos(graf.agrupUnhas).reverse();
  desenhar('graf-unhas-periodo', {
    type: 'bar',
    data: {
      labels: periodos.map(([de]) => graf.agrupUnhas === 'semana' ? ddmm(de) : `${MESES[Number(de.slice(5, 7)) - 1]}/${de.slice(2, 4)}`),
      datasets: [{ data: periodos.map(([de, ate]) => roidos.filter(d => d >= de && d <= ate).length),
                   backgroundColor: rosa, borderRadius: 8, maxBarThickness: 42 }]
    },
    options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } }
  });

  // Frequência por sentimento (inclui os da lista mesmo com zero)
  const contSent = {};
  for (const s of estado.listas.sentimentos || []) contSent[s] = 0;
  for (const d of roidos) {
    const s = (estado.mapa[meta.id + '|' + d] || {}).feeling || 'Sem registro';
    contSent[s] = (contSent[s] || 0) + 1;
  }
  const sent = Object.entries(contSent).sort((a, b) => b[1] - a[1]);
  desenhar('graf-unhas-sent', {
    type: 'bar',
    data: { labels: sent.map(s => s[0]), datasets: [{ data: sent.map(s => s[1]), backgroundColor: rosa + 'cc', borderRadius: 6 }] },
    options: { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } } }
  });

  // Por dia da semana
  const contDow = [0, 0, 0, 0, 0, 0, 0];
  for (const d of roidos) contDow[C.diaSemana(d)]++;
  desenhar('graf-unhas-dow', {
    type: 'bar',
    data: { labels: NOMES_DIAS, datasets: [{ data: contDow, backgroundColor: rosa + 'cc', borderRadius: 6, maxBarThickness: 32 }] },
    options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } }
  });

  // Lista dos dias roídos com sentimento e OBS (mais recente primeiro)
  $('#unhas-lista').innerHTML = roidos.slice().reverse().map(d => {
    const e = estado.mapa[meta.id + '|' + d] || {};
    const obs = estado.notas[d];
    return `<div class="item-dia">
        <div class="cab">${fmtDia.format(C.paraData(d))}${e.feeling ? `<span class="chip">${esc(e.feeling)}</span>` : ''}</div>
        ${obs ? `<p>${esc(obs)}</p>` : '<p><em>sem anotação</em></p>'}
      </div>`;
  }).join('') || '<p class="dica">Nenhum dia roído registrado. 💪</p>';
}

// Escapa texto livre antes de pôr no HTML
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('#unhas-agrup').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-agrup]');
  if (b) { graf.agrupUnhas = b.dataset.agrup; renderUnhas(); }
});
