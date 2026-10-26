// =====================================================================
// app.js — login, dados (com fila offline) e tela Hoje
// =====================================================================
const C = window.Calc;
// "Permanecer conectado": marcado guarda a sessão no aparelho (localStorage);
// desmarcado guarda só até fechar o navegador (sessionStorage).
function lembrarLogin() { try { return localStorage.getItem('lembrar') !== 'nao'; } catch { return true; } }
const armazenamentoSessao = {
  getItem: k => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { (lembrarLogin() ? localStorage : sessionStorage).setItem(k, v); } catch { /* sem armazenamento */ } },
  removeItem: k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* idem */ } }
};
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { storage: armazenamentoSessao, persistSession: true, autoRefreshToken: true }
});
const $ = s => document.querySelector(s);

// Estado em memória. mapa: 'goalId|AAAA-MM-DD' → linha de entries
const estado = { user: null, metas: [], mapa: {}, notas: {}, listas: {}, dia: C.hoje(), aba: 'hoje' };
let fila = {};            // alterações ainda não enviadas: 'tabela|chave' → linha
let sincronizando = false;
let timerSync = null;

// ---------------------------------------------------------------------
// Tema claro/escuro (guardado só neste aparelho)
// ---------------------------------------------------------------------
function lerLocal(k, padrao) { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } }
function gravarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } }

const temaSalvo = lerLocal('tema', null);
if (temaSalvo) document.documentElement.dataset.theme = temaSalvo;
$('#btn-tema').onclick = () => {
  const escuroAgora = getComputedStyle(document.documentElement).colorScheme === 'dark';
  const novo = escuroAgora ? 'light' : 'dark';
  document.documentElement.dataset.theme = novo;
  gravarLocal('tema', novo);
};

// ---------------------------------------------------------------------
// Login com e-mail e senha
// ---------------------------------------------------------------------
$('#form-login').onsubmit = async ev => {
  ev.preventDefault();
  $('#msg-login').textContent = 'Entrando…';
  try { localStorage.setItem('lembrar', $('#lembrar').checked ? 'sim' : 'nao'); } catch { /* sem armazenamento */ }
  const { error } = await sb.auth.signInWithPassword({
    email: $('#email').value.trim(), password: $('#senha').value
  });
  $('#msg-login').textContent = error ? 'E-mail ou senha incorretos.' : '';
};

// Envia o e-mail para definir/recuperar a senha (só funciona para conta existente)
$('#btn-esqueci').onclick = async () => {
  const email = $('#email').value.trim();
  if (!email) { $('#msg-login').textContent = 'Digite seu e-mail acima primeiro.'; return; }
  $('#msg-login').textContent = 'Enviando…';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $('#msg-login').textContent = error
    ? 'Erro: ' + error.message
    : 'Se o e-mail tiver conta, chegou um link para definir a senha. Abra-o neste aparelho.';
};

// Salva a senha nova (usuário chegou pelo link de recuperação)
$('#form-senha').onsubmit = async ev => {
  ev.preventDefault();
  const nova = $('#senha-nova').value;
  if (nova !== $('#senha-conf').value) { $('#msg-senha').textContent = 'As senhas não conferem.'; return; }
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) { $('#msg-senha').textContent = 'Erro: ' + error.message; return; }
  $('#form-senha').reset();
  modoSenha = false;
  mostrarTela('hoje');
};

$('#btn-sair').onclick = async () => { await sb.auth.signOut(); location.reload(); };

let modoSenha = false;   // true enquanto o usuário define a senha pelo link do e-mail
sb.auth.onAuthStateChange((ev, sessao) => {
  const u = sessao && sessao.user;
  if (ev === 'PASSWORD_RECOVERY') modoSenha = true;
  if (u && (!estado.user || estado.user.id !== u.id)) entrar(u);
  else if (!u) mostrarTela('login');
  if (modoSenha && u) mostrarTela('senha');
});

async function entrar(user) {
  estado.user = user;
  fila = lerLocal('fila_' + user.id, {});
  $('#btn-sair').hidden = false;
  $('#abas').hidden = false;
  status('carregando…');
  await carregar();
  if (navigator.onLine && !estado.metas.length) { await semear(); await carregar(); }
  mostrarTela(modoSenha ? 'senha' : 'hoje');
  sincronizar();
}

// ---------------------------------------------------------------------
// Leitura dos dados (com cópia local para abrir sem internet)
// ---------------------------------------------------------------------
async function buscarTudo(tabela) {
  // O Supabase devolve no máximo 1000 linhas por consulta: pagina
  const N = 1000; let out = [];
  for (let de = 0; ; de += N) {
    const { data, error } = await sb.from(tabela).select('*').range(de, de + N - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < N) return out;
  }
}

async function carregar() {
  const chave = 'cache_' + estado.user.id;
  let dados;
  try {
    const [metas, entries, notas, listas] = await Promise.all(
      ['goals', 'entries', 'day_notes', 'lists'].map(buscarTudo));
    dados = { metas, entries, notas, listas };
    gravarLocal(chave, dados);
  } catch (e) {
    console.warn('Sem conexão com o banco, usando cópia local', e);
    dados = lerLocal(chave, { metas: [], entries: [], notas: [], listas: [] });
  }
  estado.todas = dados.metas.slice().sort((a, b) => a.sort_order - b.sort_order);   // inclui arquivadas (Ajustes)
  estado.metas = estado.todas.filter(m => m.active);
  estado.mapa = {}; for (const e of dados.entries) estado.mapa[e.goal_id + '|' + e.day] = e;
  estado.notas = {}; for (const n of dados.notas) estado.notas[n.day] = n.obs;
  estado.listas = {}; for (const l of dados.listas) estado.listas[l.key] = l.items;
  // O que está na fila é mais novo que o banco: aplica por cima
  for (const [k, linha] of Object.entries(fila)) {
    if (k.startsWith('entries|')) estado.mapa[linha.goal_id + '|' + linha.day] = linha;
    if (k.startsWith('day_notes|')) estado.notas[linha.day] = linha.obs;
  }
}

// Primeiro login: cria metas padrão, lista de sentimentos e importa os dados iniciais
async function semear() {
  status('preparando suas metas…');
  const linhas = SEED.metas.map(({ csv, ...m }, i) => ({ ...m, user_id: estado.user.id, sort_order: i, start_date: '2026-10-18' }));
  // ignoreDuplicates + índice único: se duas abas semearem ao mesmo tempo, não duplica
  const { error } = await sb.from('goals').upsert(linhas, { onConflict: 'user_id,name', ignoreDuplicates: true });
  if (error) { status('erro ao criar metas', true); console.error(error); return; }
  const { data: metas } = await sb.from('goals').select('*');
  await sb.from('lists').upsert({ user_id: estado.user.id, key: 'sentimentos', items: SEED.sentimentos });
  const porCsv = {};
  SEED.metas.forEach(s => { porCsv[s.csv] = metas.find(m => m.name === s.name); });
  const { entries, notas } = csvParaLinhas(SEED.csv, porCsv);
  const uid = estado.user.id;
  await sb.from('entries').upsert(entries.map(e => ({ ...e, user_id: uid })), { onConflict: 'user_id,goal_id,day' });
  await sb.from('day_notes').upsert(notas.map(n => ({ ...n, user_id: uid })), { onConflict: 'user_id,day' });
}

// ---------------------------------------------------------------------
// Gravação: tudo passa pela fila local, que sincroniza com o banco.
// Assim nada se perde se a internet cair no meio.
// ---------------------------------------------------------------------
const CONFLITO = { entries: 'user_id,goal_id,day', day_notes: 'user_id,day' };

function enfileirar(tabela, chave, linha) {
  fila[tabela + '|' + chave] = { ...linha, user_id: estado.user.id, updated_at: new Date().toISOString() };
  gravarLocal('fila_' + estado.user.id, fila);
  status(navigator.onLine ? 'salvando…' : 'guardado no aparelho');
  clearTimeout(timerSync);
  timerSync = setTimeout(sincronizar, 700);
}

async function sincronizar() {
  atualizarAvisoOffline();
  if (sincronizando || !estado.user) return;
  if (!Object.keys(fila).length) { status('salvo'); return; }
  if (!navigator.onLine) { status('guardado no aparelho'); return; }
  sincronizando = true;
  try {
    for (const k of Object.keys(fila)) {
      const linha = fila[k];
      const tabela = k.split('|')[0];
      const { error } = await sb.from(tabela).upsert(linha, { onConflict: CONFLITO[tabela] });
      if (error) throw error;
      if (fila[k] === linha) delete fila[k];   // só apaga se não mudou enquanto enviava
      gravarLocal('fila_' + estado.user.id, fila);
    }
    status('salvo');
  } catch (e) {
    console.warn('Falha ao sincronizar; tento de novo depois', e);
    status(navigator.onLine ? 'erro ao salvar — tentando de novo' : 'guardado no aparelho', navigator.onLine);
    setTimeout(sincronizar, 15000);
  } finally {
    sincronizando = false;
  }
  if (Object.keys(fila).length && navigator.onLine) setTimeout(sincronizar, 300);
}

function status(txt, erro) { const s = $('#status'); s.textContent = txt; s.classList.toggle('erro', !!erro); }
function atualizarAvisoOffline() { $('#aviso-offline').hidden = navigator.onLine; }
window.addEventListener('online', sincronizar);
window.addEventListener('offline', () => { atualizarAvisoOffline(); status('guardado no aparelho'); });
document.addEventListener('visibilitychange', () => {
  // Ao voltar para o app, busca o que foi lançado no outro aparelho
  if (document.visibilityState === 'visible' && estado.user && navigator.onLine) {
    estado.dia = estado.dia || C.hoje();
    carregar().then(() => estado.aba === 'hoje' && renderHoje(true));
  }
});

// ---------------------------------------------------------------------
// Navegação entre abas
// ---------------------------------------------------------------------
function mostrarTela(aba) {
  estado.aba = aba;
  for (const t of ['login', 'senha', 'hoje', 'periodo', 'graficos', 'unhas', 'config', 'breve']) $('#tela-' + t).hidden = true;
  if (aba === 'login' || aba === 'senha') { $('#tela-' + aba).hidden = false; $('#abas').hidden = true; return; }
  $('#abas').hidden = false;
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
  document.querySelector('main').classList.toggle('largo', aba === 'semana' || aba === 'mes');
  if (aba === 'hoje') { $('#tela-hoje').hidden = false; renderHoje(true); }
  else if (aba === 'semana' || aba === 'mes') { $('#tela-periodo').hidden = false; renderPeriodo(aba); }
  else if (aba === 'graficos') { $('#tela-graficos').hidden = false; renderGraficos(); }
  else if (aba === 'unhas') { $('#tela-unhas').hidden = false; renderUnhas(); }
  else if (aba === 'config') { $('#tela-config').hidden = false; renderAjustes(); }
  else $('#tela-breve').hidden = false;
}
document.querySelectorAll('#abas button').forEach(b => b.onclick = () => mostrarTela(b.dataset.aba));

// ---------------------------------------------------------------------
// Tela Hoje
// ---------------------------------------------------------------------
const fmtDia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const NOMES_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function textoDias(ws) {
  if (ws.length === 7) return 'todo dia';
  if (ws.join() === '1,2,3,4,5') return 'seg–sex';
  return ws.map(d => NOMES_DIAS[d].toLowerCase()).join(', ');
}
function num(v) { return String(Math.round(v * 100) / 100).replace('.', ','); }

// Ícone e cor de cada meta (metas novas recebem um ícone/cor genéricos)
const VISUAL = {
  'Leitura': ['📖', '#6366f1'], 'Frutas': ['🍎', '#f97316'], 'Água': ['💧', '#0ea5e9'],
  'Reflexão': ['🧘', '#a855f7'], 'Organizar a semana': ['🗓️', '#14b8a6'], 'Não roer unhas': ['✋', '#ec4899']
};
const CORES_EXTRA = ['#22c55e', '#eab308', '#ef4444', '#06b6d4', '#8b5cf6'];
function visual(m, i) { return VISUAL[m.name] || ['⭐', CORES_EXTRA[i % CORES_EXTRA.length]]; }

// Frase motivacional conforme o % da semana
function mensagem(p) {
  if (p == null) return 'Semana começando — bora!';
  if (p >= 0.9999) return 'Semana perfeita até aqui! 🔥';
  if (p >= 0.8) return 'Quase lá, continue assim!';
  if (p >= 0.6) return 'Bom ritmo, dá pra subir mais.';
  return 'Cada registro conta. Vamos virar o jogo!';
}

let okAntes = new Set();   // metas cumpridas no último desenho (para animar as novas)

// trocouDia = true redesenha também a data e a OBS
function renderHoje(trocouDia) {
  const hoje = C.hoje();
  const d = estado.dia;
  const metas = estado.metas;

  // Hero: % parcial da semana atual (Dom–Sáb que contém hoje)
  const ini = C.inicioSemana(hoje);
  const r = C.resumo(metas, estado.mapa, ini, C.somaDias(ini, 6), hoje);
  $('#hero-sub').textContent = `Semana ${ddmm(ini)}–${ddmm(C.somaDias(ini, 6))} · parcial`;
  $('#hero-msg').textContent = mensagem(r.media);
  $('#hero-pct').textContent = C.pctTexto(r.media);
  $('#hero-anel').style.setProperty('--p', r.media == null ? 0 : Math.round(r.media * 100));

  if (trocouDia) {
    $('#dia-texto').textContent = fmtDia.format(C.paraData(d)) + (d === hoje ? ' · hoje' : '');
    $('#dia-hoje').hidden = d === hoje;
    $('#dia-prox').disabled = d >= hoje;
    $('#obs').value = estado.notas[d] || '';
    okAntes = new Set();
  }

  // Faixa com os 7 dias da semana do dia selecionado; o ponto mostra o % do dia
  const iniSel = C.inicioSemana(d);
  $('#faixa-dias').innerHTML = C.listaDias(iniSel, C.somaDias(iniSel, 6)).map(dia => {
    const dow = C.diaSemana(dia);
    const contam = metas.filter(m => m.weekdays.includes(dow) && dia >= m.start_date);
    const ok = contam.filter(m => C.cumpriu(m, C.valor(m, estado.mapa, dia))).length;
    const cor = dia > hoje || !contam.length ? '' : C.cor(ok / contam.length);
    return `<button data-dia="${dia}" class="${dia === d ? 'sel' : ''}" ${dia > hoje ? 'disabled' : ''}>
        <span class="sem">${NOMES_DIAS[dow]}</span><span class="num">${dia.slice(8, 10)}</span><span class="ponto ${cor}"></span>
      </button>`;
  }).join('');

  const dow = C.diaSemana(d);
  const okAgora = new Set();
  $('#cards').innerHTML = metas.map((m, i) => {
    const [icone, corMeta] = visual(m, i);
    const e = estado.mapa[m.id + '|' + d] || {};
    const conta = m.weekdays.includes(dow) && d >= m.start_date;
    const ok = conta && C.cumpriu(m, C.valor(m, estado.mapa, d)) && (m.kind === 'numeric' ? e.num_value != null : true);
    if (ok) okAgora.add(m.id);
    let corpo, alvo;
    if (m.kind === 'numeric') {
      alvo = `meta ${num(m.target)} ${m.unit || ''} · ${textoDias(m.weekdays)}`;
      const fracao = Math.min(1, (Number(e.num_value) || 0) / Number(m.target)) * 100;
      corpo = `<div class="stepper">
          <button data-acao="menos" aria-label="Menos">−</button>
          <div class="valor">
            <input type="number" inputmode="decimal" min="0" step="${m.step || 1}" value="${e.num_value ?? ''}" placeholder="0" data-acao="digitar" aria-label="${m.name}">
            <span class="unid">${m.unit || ''}</span>
          </div>
          <button data-acao="mais" aria-label="Mais">+</button>
        </div>
        <div class="barra"><i style="width:${fracao}%"></i></div>`;
    } else {
      alvo = `${textoDias(m.weekdays)}`;
      const v = e.bool_value;
      const padrao = v == null ? m.default_value : null;   // botão tracejado = valor assumido
      // Verde quando a resposta é a de sucesso, vermelho quando não
      const cls = b => (v === b ? 'ativo ' + (b === m.success_value ? 'bom' : 'ruim') : '') + (padrao === b ? ' padrao' : '');
      corpo = `<div class="simnao">
          <button data-acao="sim" class="${cls(true)}">Sim</button>
          <button data-acao="nao" class="${cls(false)}">Não</button>
        </div>`;
      if (m.feeling_on != null && v === m.feeling_on) {
        const opcoes = (estado.listas.sentimentos || []).map(s =>
          `<option ${s === e.feeling ? 'selected' : ''}>${s}</option>`).join('');
        corpo += `<select class="sentimento" data-acao="sentimento">
            <option value="">Como você estava se sentindo?</option>${opcoes}</select>`;
      }
    }
    const pop = ok && !okAntes.has(m.id) && !trocouDia ? 'pop' : '';
    return `<div class="card ${conta ? '' : 'esmaecido'} ${ok ? 'ok' : ''} ${pop}" data-id="${m.id}" style="--cor:${corMeta}">
        <div class="card-topo">
          <div class="icone-meta">${icone}</div>
          <div class="card-tit"><span class="card-nome">${m.question || m.name}</span><span class="card-alvo">${alvo}</span></div>
          ${conta ? '<span class="selo">✓</span>' : '<span class="chip">não conta hoje</span>'}
        </div>
        ${corpo}
      </div>`;
  }).join('') || '<p class="dica">Nenhuma meta cadastrada.</p>';
  okAntes = okAgora;
}

// Grava um valor de meta no dia selecionado
function gravarEntrada(meta, mudancas) {
  const k = meta.id + '|' + estado.dia;
  const atual = estado.mapa[k] || { goal_id: meta.id, day: estado.dia, num_value: null, bool_value: null, feeling: null };
  const linha = { goal_id: meta.id, day: estado.dia, num_value: atual.num_value, bool_value: atual.bool_value, feeling: atual.feeling, ...mudancas };
  estado.mapa[k] = linha;
  enfileirar('entries', k, linha);
  renderHoje(false);
}

// Cliques nos cards (delegação de eventos)
$('#cards').addEventListener('click', ev => {
  const btn = ev.target.closest('button[data-acao]');
  if (!btn) return;
  const meta = estado.metas.find(m => m.id === btn.closest('.card').dataset.id);
  const e = estado.mapa[meta.id + '|' + estado.dia] || {};
  const passo = Number(meta.step) || 1;
  const v = e.num_value == null ? null : Number(e.num_value);
  switch (btn.dataset.acao) {
    case 'mais':  gravarEntrada(meta, { num_value: Math.round(((v ?? 0) + passo) * 100) / 100 }); break;
    case 'menos': gravarEntrada(meta, { num_value: Math.max(0, Math.round(((v ?? 0) - passo) * 100) / 100) }); break;
    // Tocar de novo no botão já marcado limpa a resposta
    case 'sim': gravarEntrada(meta, { bool_value: e.bool_value === true ? null : true, feeling: meta.feeling_on === true ? e.feeling : null }); break;
    case 'nao': gravarEntrada(meta, { bool_value: e.bool_value === false ? null : false, feeling: meta.feeling_on === false ? e.feeling : null }); break;
  }
});
$('#cards').addEventListener('change', ev => {
  const el = ev.target;
  const meta = estado.metas.find(m => m.id === el.closest('.card').dataset.id);
  if (el.dataset.acao === 'digitar') {
    const t = el.value.replace(',', '.').trim();
    gravarEntrada(meta, { num_value: t === '' ? null : Math.max(0, Number(t)) });
  }
  if (el.dataset.acao === 'sentimento') gravarEntrada(meta, { feeling: el.value || null });
});

// OBS: salva enquanto digita (com pequena espera)
let timerObs = null;
$('#obs').addEventListener('input', () => {
  const dia = estado.dia, texto = $('#obs').value;
  estado.notas[dia] = texto;
  status('digitando…');
  clearTimeout(timerObs);
  timerObs = setTimeout(() => enfileirar('day_notes', dia, { day: dia, obs: texto }), 800);
});

// Setas de dia
function irPara(d) {
  // Garante que a OBS pendente do dia anterior seja enfileirada antes de trocar
  if (timerObs) { clearTimeout(timerObs); timerObs = null; enfileirar('day_notes', estado.dia, { day: estado.dia, obs: $('#obs').value }); }
  estado.dia = d; renderHoje(true);
}
$('#dia-ant').onclick = () => irPara(C.somaDias(estado.dia, -1));
$('#dia-prox').onclick = () => { if (estado.dia < C.hoje()) irPara(C.somaDias(estado.dia, 1)); };
$('#dia-hoje').onclick = () => irPara(C.hoje());
$('#faixa-dias').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-dia]');
  if (b && !b.disabled) irPara(b.dataset.dia);
});

// ---------------------------------------------------------------------
// Telas Semana e Mês: uma linha por período (mais recente em cima)
// ---------------------------------------------------------------------
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function ddmm(d) { return d.slice(8, 10) + '/' + d.slice(5, 7); }

// Lista de períodos [de, ate] desde o início da primeira meta até hoje
function listaPeriodos(tipo) {
  const hoje = C.hoje();
  const inicio = estado.metas.reduce((m, g) => g.start_date < m ? g.start_date : m, hoje);
  const out = [];
  let de = tipo === 'semana' ? C.inicioSemana(inicio) : C.inicioMes(inicio);
  while (de <= hoje) {
    const ate = tipo === 'semana' ? C.somaDias(de, 6) : C.fimMes(de);
    out.push([de, ate]);
    de = C.somaDias(ate, 1);
  }
  return out.reverse();
}

// Total registrado da meta no período (até hoje), para mostrar junto do %
function totalMeta(meta, de, ate, hoje) {
  const fim = ate < hoje ? ate : hoje;
  const ini = de > meta.start_date ? de : meta.start_date;
  if (fim < ini) return 0;
  return C.listaDias(ini, fim).reduce((s, d) => s + C.valor(meta, estado.mapa, d), 0);
}

function renderPeriodo(tipo) {
  const hoje = C.hoje();
  const metas = estado.metas;
  $('#periodo-titulo').textContent = tipo === 'semana' ? 'Semanas (Dom–Sáb)' : 'Meses';

  const cab = `<tr><th>${tipo === 'semana' ? 'Semana' : 'Mês'}</th>${metas.map(m => `<th>${m.name}</th>`).join('')}<th>Média</th></tr>`;
  const linhas = listaPeriodos(tipo).map(([de, ate]) => {
    const r = C.resumo(metas, estado.mapa, de, ate, hoje);
    const rotulo = tipo === 'semana' ? `${ddmm(de)}–${ddmm(ate)}` : `${MESES[Number(de.slice(5, 7)) - 1]}/${de.slice(0, 4)}`;
    const parcial = ate >= hoje ? '<span class="parcial">parcial</span>' : '';
    const celulas = metas.map(m => {
      const x = r.porMeta[m.id];
      if (!x) return '<td>—</td>';
      // Detalhe: numéricas mostram o total e os dias ≥ alvo; sim/não mostram dias ok
      const det = m.kind === 'numeric'
        ? `${num(totalMeta(m, de, ate, hoje))} ${m.unit || ''} · ${x.diasOk}/${x.diasConta} d`
        : `${x.diasOk}/${x.diasConta} dias`;
      return `<td><span class="pct bg-${C.cor(x.pct)} ${C.cor(x.pct)}">${C.pctTexto(x.pct)}</span><span class="det">${det}</span></td>`;
    }).join('');
    const media = r.media == null ? '—' : `<span class="pct bg-${C.cor(r.media)} ${C.cor(r.media)}">${C.pctTexto(r.media)}</span>`;
    return `<tr><td><strong>${rotulo}</strong>${parcial}</td>${celulas}<td>${media}</td></tr>`;
  }).join('');
  $('#tabela-periodo').innerHTML = `<thead>${cab}</thead><tbody>${linhas}</tbody>`;
}

atualizarAvisoOffline();

// Service worker: permite instalar o app e abri-lo sem internet
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW não registrado', e)));
}
