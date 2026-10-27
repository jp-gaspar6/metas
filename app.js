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
// Ao sair, minimizar ou trocar de app: envia na hora o que estiver pendente
// (se não der tempo, a fila continua no aparelho e vai na próxima abertura)
function enviarPendentes() {
  if (!estado.user || !Object.keys(fila).length) return;
  clearTimeout(timerSync);
  sincronizar();
}
window.addEventListener('pagehide', enviarPendentes);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') enviarPendentes();
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
    const iniS = C.inicioSemana(d);
    $('#dia-texto').textContent = `Semana ${ddmm(iniS)}–${ddmm(C.somaDias(iniS, 6))}`;
    $('#dia-sub').textContent = fmtDia.format(C.paraData(d)) + (d === hoje ? ' · hoje' : '');
    $('#dia-hoje').hidden = d === hoje;
    $('#dia-prox').disabled = C.somaDias(iniS, 7) > hoje;
    $('#dia-ant').disabled = iniS <= primeiroDia();
    $('#obs').value = estado.notas[d] || '';
    okAntes = new Set();
  }

  // Faixa com os 7 dias da semana do dia selecionado; o ponto mostra o % do dia
  const iniSel = C.inicioSemana(d);
  $('#faixa-dias').innerHTML = C.listaDias(iniSel, C.somaDias(iniSel, 6)).map(dia => {
    const dow = C.diaSemana(dia), cor = corDia(dia, hoje);
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
// redesenhar = false enquanto o usuário digita (para não perder o foco do campo)
function gravarEntrada(meta, mudancas, redesenhar = true) {
  const k = meta.id + '|' + estado.dia;
  const atual = estado.mapa[k] || { goal_id: meta.id, day: estado.dia, num_value: null, bool_value: null, feeling: null };
  const linha = { goal_id: meta.id, day: estado.dia, num_value: atual.num_value, bool_value: atual.bool_value, feeling: atual.feeling, ...mudancas };
  estado.mapa[k] = linha;
  enfileirar('entries', k, linha);
  if (redesenhar) renderHoje(false);
}

// Número digitado no campo: lê o texto (aceita vírgula) e devolve número ou null
function lerNumero(el) {
  const t = el.value.replace(',', '.').trim();
  return t === '' || isNaN(Number(t)) ? null : Math.max(0, Number(t));
}

// Salva a cada tecla (grava na fila local na hora); o redesenho fica para quando sair do campo
$('#cards').addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.acao !== 'digitar') return;
  const meta = estado.metas.find(m => m.id === el.closest('.card').dataset.id);
  gravarEntrada(meta, { num_value: lerNumero(el) }, false);
});

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
  if (el.dataset.acao === 'digitar') gravarEntrada(meta, { num_value: lerNumero(el) });
  if (el.dataset.acao === 'sentimento') gravarEntrada(meta, { feeling: el.value || null });
});

// OBS: cada tecla já vai para a fila local; o envio ao banco espera uma pausa na digitação
$('#obs').addEventListener('input', () => {
  const dia = estado.dia, texto = $('#obs').value;
  estado.notas[dia] = texto;
  enfileirar('day_notes', dia, { day: dia, obs: texto });
});

// Cor do ponto de um dia: % das metas que contam naquele dia
function corDia(dia, hoje) {
  const dow = C.diaSemana(dia);
  const contam = estado.metas.filter(m => m.weekdays.includes(dow) && dia >= m.start_date);
  if (dia > hoje || !contam.length) return '';
  return C.cor(contam.filter(m => C.cumpriu(m, C.valor(m, estado.mapa, dia))).length / contam.length);
}
// Início do histórico: a meta mais antiga
function primeiroDia() {
  return estado.metas.reduce((min, m) => m.start_date < min ? m.start_date : min, C.hoje());
}

// Setas trocam de semana, mantendo o dia da semana (sem passar de hoje nem do início)
function irPara(d) {
  estado.dia = d; renderHoje(true);
}
function irSemana(n) {
  let d = C.somaDias(estado.dia, 7 * n);
  if (d > C.hoje()) d = C.hoje();
  if (d < primeiroDia()) d = primeiroDia();
  irPara(d);
}
$('#dia-ant').onclick = () => irSemana(-1);
$('#dia-prox').onclick = () => irSemana(1);
$('#dia-hoje').onclick = () => irPara(C.hoje());
$('#faixa-dias').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-dia]');
  if (b && !b.disabled) irPara(b.dataset.dia);
});

// Calendário do mês (sobreposto): tocar num dia leva até a semana dele
let mesCal;
document.body.appendChild($('#calendario')); // fora da tela, para cobrir também a barra de abas
function abrirCalendario() {
  mesCal = estado.dia.slice(0, 7);
  renderCalendario();
  $('#calendario').hidden = false;
}
function renderCalendario() {
  const hoje = C.hoje(), ini = mesCal + '-01', fim = C.fimMes(ini), min = primeiroDia();
  $('#cal-titulo').textContent = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(C.paraData(ini));
  $('#cal-ant').disabled = ini <= min;
  $('#cal-prox').disabled = C.somaDias(fim, 1) > hoje;
  const semSel = C.inicioSemana(estado.dia);
  $('#cal-grade').innerHTML = NOMES_DIAS.map(n => `<span class="cal-sem">${n[0]}</span>`).join('') +
    '<span></span>'.repeat(C.diaSemana(ini)) +
    C.listaDias(ini, fim).map(dia => {
      const fora = dia > hoje || dia < min;
      const cls = [dia === estado.dia ? 'sel' : '', dia === hoje ? 'hoje' : '', C.inicioSemana(dia) === semSel ? 'semana' : ''].join(' ');
      return `<button data-dia="${dia}" class="${cls}" ${fora ? 'disabled' : ''}>${+dia.slice(8)}<span class="ponto ${fora ? '' : corDia(dia, hoje)}"></span></button>`;
    }).join('');
}
function mudarMes(n) {
  let [a, m] = mesCal.split('-').map(Number);
  m += n;
  if (m < 1) { m = 12; a--; }
  if (m > 12) { m = 1; a++; }
  mesCal = `${a}-${String(m).padStart(2, '0')}`;
  renderCalendario();
}
$('#btn-calendario').onclick = abrirCalendario;
$('#cal-ant').onclick = () => mudarMes(-1);
$('#cal-prox').onclick = () => mudarMes(1);
$('#calendario').addEventListener('click', ev => {
  if (ev.target.id === 'calendario' || ev.target.closest('#cal-fechar')) { $('#calendario').hidden = true; return; }
  const b = ev.target.closest('button[data-dia]');
  if (b && !b.disabled) { $('#calendario').hidden = true; irPara(b.dataset.dia); }
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

// Visão e filtros da aba Semana (guardados só em memória)
const tabela = { visao: 'semanas', dias: 90, dows: [0, 1, 2, 3, 4, 5, 6] };

function renderPeriodo(tipo) {
  const naSemana = tipo === 'semana';
  $('#periodo-visoes').hidden = !naSemana;
  document.querySelectorAll('#periodo-visoes button').forEach(b => b.classList.toggle('sel', b.dataset.visao === tabela.visao));
  const visao = naSemana ? tabela.visao : 'semanas';
  $('#periodo-titulo').textContent = !naSemana ? 'Meses' : visao === 'semanas' ? 'Semanas (Dom–Sáb)'
    : visao === 'diario' ? 'Dia a dia' : 'Por dia da semana';
  renderFiltros(visao);
  if (visao === 'diario') renderDiario();
  else if (visao === 'dow') renderPorDiaSemana();
  else renderResumoPeriodos(tipo);
}

// Filtros: período (Dia a dia e Por dia da semana) e dias da semana (só Dia a dia)
function renderFiltros(visao) {
  if (visao === 'semanas') { $('#periodo-filtros').innerHTML = ''; return; }
  const per = [[30, '30 dias'], [90, '90 dias'], [365, '1 ano'], [0, 'Tudo']]
    .map(([d, t]) => `<button data-fdias="${d}" class="${tabela.dias === d ? 'sel' : ''}">${t}</button>`).join('');
  const dows = visao !== 'diario' ? '' : `<div class="dias-sel filtro-dows">${NOMES_DIAS.map((n, d) =>
    `<button data-fdow="${d}" class="${tabela.dows.includes(d) ? 'sel' : ''}">${n}</button>`).join('')}</div>`;
  $('#periodo-filtros').innerHTML = `<div class="chips segment">${per}</div>${dows}`;
}

$('#periodo-visoes').addEventListener('click', ev => {
  const b = ev.target.closest('[data-visao]');
  if (b) { tabela.visao = b.dataset.visao; renderPeriodo('semana'); }
});
$('#periodo-filtros').addEventListener('click', ev => {
  const p = ev.target.closest('[data-fdias]');
  if (p) tabela.dias = Number(p.dataset.fdias);
  const d = ev.target.closest('[data-fdow]');
  if (d) {
    const n = Number(d.dataset.fdow);
    tabela.dows = tabela.dows.includes(n) ? tabela.dows.filter(x => x !== n) : tabela.dows.concat(n);
  }
  if (p || d) renderPeriodo('semana');
});

// Dias do período escolhido (até hoje, a partir do início da primeira meta)
function diasDoFiltro() {
  const hoje = C.hoje();
  const inicio = estado.metas.reduce((m, g) => g.start_date < m ? g.start_date : m, hoje);
  let de = tabela.dias ? C.somaDias(hoje, -(tabela.dias - 1)) : inicio;
  if (de < inicio) de = inicio;
  return C.listaDias(de, hoje);
}

// Situação de uma meta num dia: 'ok', 'falha', 'nao-conta' ou 'vazio' (sim/não sem resposta)
function situacao(m, d) {
  if (d < m.start_date || !m.weekdays.includes(C.diaSemana(d))) return 'nao-conta';
  const v = C.valor(m, estado.mapa, d);
  if (v == null) return 'vazio';
  return C.cumpriu(m, v) ? 'ok' : 'falha';
}

// Texto do valor registrado (vazio = "—"; sim/não em branco mostra o padrão entre parênteses)
function textoValor(m, d) {
  const e = estado.mapa[m.id + '|' + d];
  if (m.kind === 'numeric') return e && e.num_value != null ? num(Number(e.num_value)) : '—';
  if (e && e.bool_value != null) return e.bool_value ? 'Sim' : 'Não';
  return m.default_value == null ? '—' : `(${m.default_value ? 'Sim' : 'Não'})`;
}

// Tabela dia a dia: uma linha por dia, célula verde/vermelha conforme cumpriu
function renderDiario() {
  const metas = estado.metas;
  const metaSent = metas.find(m => m.feeling_on != null);
  const dias = diasDoFiltro().filter(d => tabela.dows.includes(C.diaSemana(d))).reverse();
  $('#periodo-dica').textContent = `${dias.length} dias. Verde = cumpriu, vermelho = não cumpriu, cinza = a meta não conta nesse dia. Valor entre parênteses = padrão (dia em branco).`;

  const cab = `<tr><th>Dia</th>${metas.map(m => `<th>${esc(m.name)}</th>`).join('')}<th>Metas</th><th class="col-obs">OBS</th></tr>`;
  const linhas = dias.map(d => {
    const celulas = metas.map(m => {
      const s = situacao(m, d);
      let txt = textoValor(m, d);
      if (m === metaSent) { const f = (estado.mapa[m.id + '|' + d] || {}).feeling; if (f) txt += `<span class="det">${esc(f)}</span>`; }
      return `<td class="cel-${s}">${txt}</td>`;
    }).join('');
    const contam = metas.filter(m => ['ok', 'falha'].includes(situacao(m, d)));
    const ok = contam.filter(m => situacao(m, d) === 'ok').length;
    const pct = contam.length ? ok / contam.length : null;
    const obs = estado.notas[d] || '';
    return `<tr><td><strong>${ddmm(d)}</strong><span class="det">${NOMES_DIAS[C.diaSemana(d)]}</span></td>${celulas}
      <td><span class="pct bg-${C.cor(pct)} ${C.cor(pct)}">${contam.length ? `${ok}/${contam.length}` : '—'}</span></td>
      <td class="col-obs" title="${esc(obs)}">${esc(obs)}</td></tr>`;
  }).join('');

  // Rodapé: média dos valores numéricos e % de dias cumpridos entre os dias mostrados
  const rodape = metas.map(m => {
    const contam = dias.filter(d => ['ok', 'falha'].includes(situacao(m, d)));
    if (!contam.length) return '<td>—</td>';
    const pct = contam.filter(d => situacao(m, d) === 'ok').length / contam.length;
    const media = m.kind === 'numeric'
      ? `<span class="det">média ${num(contam.reduce((s, d) => s + C.valor(m, estado.mapa, d), 0) / contam.length)}</span>` : '';
    return `<td><span class="pct bg-${C.cor(pct)} ${C.cor(pct)}">${C.pctTexto(pct)}</span>${media}</td>`;
  }).join('');
  $('#tabela-periodo').innerHTML = `<thead>${cab}</thead><tbody>${linhas || `<tr><td colspan="${metas.length + 3}">Nenhum dia no filtro.</td></tr>`}</tbody>
    <tfoot><tr><td><strong>Resumo</strong></td>${rodape}<td></td><td class="col-obs"></td></tr></tfoot>`;
}

// Comparação por dia da semana: % de dias cumpridos e média do valor em cada Dom..Sáb
function renderPorDiaSemana() {
  const metas = estado.metas;
  const dias = diasDoFiltro();
  $('#periodo-dica').textContent = 'Para cada dia da semana: % de dias em que cumpriu a meta e, nas numéricas, a média registrada. "—" = a meta não conta nesse dia.';
  const cab = `<tr><th>Dia</th>${metas.map(m => `<th>${esc(m.name)}</th>`).join('')}<th>Média</th></tr>`;
  const linhas = NOMES_DIAS.map((nome, dow) => {
    const doDia = dias.filter(d => C.diaSemana(d) === dow);
    const pcts = [];
    const celulas = metas.map(m => {
      const contam = doDia.filter(d => ['ok', 'falha'].includes(situacao(m, d)));
      if (!contam.length) return '<td class="cel-nao-conta">—</td>';
      const pct = contam.filter(d => situacao(m, d) === 'ok').length / contam.length;
      pcts.push(pct);
      const media = m.kind === 'numeric'
        ? `${num(contam.reduce((s, d) => s + C.valor(m, estado.mapa, d), 0) / contam.length)} ${esc(m.unit || '')} · ` : '';
      return `<td><span class="pct bg-${C.cor(pct)} ${C.cor(pct)}">${C.pctTexto(pct)}</span><span class="det">${media}${contam.length} dias</span></td>`;
    }).join('');
    const media = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    return `<tr><td><strong>${nome}</strong><span class="det">${doDia.length} dias</span></td>${celulas}
      <td>${media == null ? '—' : `<span class="pct bg-${C.cor(media)} ${C.cor(media)}">${C.pctTexto(media)}</span>`}</td></tr>`;
  }).join('');
  $('#tabela-periodo').innerHTML = `<thead>${cab}</thead><tbody>${linhas}</tbody>`;
}

function renderResumoPeriodos(tipo) {
  const hoje = C.hoje();
  const metas = estado.metas;
  $('#periodo-dica').textContent = 'Períodos em andamento mostram o parcial (só dias até hoje).';

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
