// =====================================================================
// app.js — login, dados (com fila offline) e tela Hoje
// =====================================================================
const C = window.Calc;
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
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
// Login por link mágico
// ---------------------------------------------------------------------
$('#form-login').onsubmit = async ev => {
  ev.preventDefault();
  const email = $('#email').value.trim();
  $('#msg-login').textContent = 'Enviando…';
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: location.origin + location.pathname }
  });
  $('#msg-login').textContent = error
    ? 'Erro: ' + error.message
    : 'Pronto! Abra o link que chegou no seu e-mail (neste mesmo aparelho).';
};
$('#btn-sair').onclick = async () => { await sb.auth.signOut(); location.reload(); };

sb.auth.onAuthStateChange((_ev, sessao) => {
  const u = sessao && sessao.user;
  if (u && (!estado.user || estado.user.id !== u.id)) entrar(u);
  else if (!u) mostrarTela('login');
});

async function entrar(user) {
  estado.user = user;
  fila = lerLocal('fila_' + user.id, {});
  $('#btn-sair').hidden = false;
  $('#abas').hidden = false;
  status('carregando…');
  await carregar();
  if (navigator.onLine && !estado.metas.length) { await semear(); await carregar(); }
  mostrarTela('hoje');
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
  estado.metas = dados.metas.filter(m => m.active).sort((a, b) => a.sort_order - b.sort_order);
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
  const linhas = SEED.metas.map(({ csv, ...m }, i) => ({ ...m, sort_order: i, start_date: '2026-10-18' }));
  const { data: metas, error } = await sb.from('goals').insert(linhas).select();
  if (error) { status('erro ao criar metas', true); console.error(error); return; }
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
  for (const t of ['login', 'hoje', 'breve']) $('#tela-' + t).hidden = true;
  if (aba === 'login') { $('#tela-login').hidden = false; $('#abas').hidden = true; return; }
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
  if (aba === 'hoje') { $('#tela-hoje').hidden = false; renderHoje(true); }
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

// trocouDia = true redesenha também a data e a OBS
function renderHoje(trocouDia) {
  const hoje = C.hoje();
  const d = estado.dia;
  const metas = estado.metas;

  // % parcial da semana atual (Dom–Sáb que contém hoje)
  const ini = C.inicioSemana(hoje);
  const r = C.resumo(metas, estado.mapa, ini, C.somaDias(ini, 6), hoje);
  const cor = C.cor(r.media);
  $('#semana-pct').className = 'semana-pct bg-' + (cor || 'x');
  $('#semana-pct').innerHTML = `<span>Semana atual (parcial)</span><strong class="${cor}">${C.pctTexto(r.media)}</strong>`;

  if (trocouDia) {
    $('#dia-texto').textContent = fmtDia.format(C.paraData(d)) + (d === hoje ? ' · hoje' : '');
    $('#dia-hoje').hidden = d === hoje;
    $('#dia-prox').disabled = d >= hoje;
    $('#obs').value = estado.notas[d] || '';
  }

  const dow = C.diaSemana(d);
  $('#cards').innerHTML = metas.map(m => {
    const e = estado.mapa[m.id + '|' + d] || {};
    const conta = m.weekdays.includes(dow) && d >= m.start_date;
    const ok = conta && C.cumpriu(m, C.valor(m, estado.mapa, d)) && (m.kind === 'numeric' ? e.num_value != null : true);
    let corpo, alvo;
    if (m.kind === 'numeric') {
      alvo = `alvo ${num(m.target)} ${m.unit || ''} · ${textoDias(m.weekdays)}`;
      corpo = `<div class="stepper">
          <button data-acao="menos" aria-label="Menos">−</button>
          <input type="number" inputmode="decimal" min="0" step="${m.step || 1}" value="${e.num_value ?? ''}" placeholder="—" data-acao="digitar">
          <button data-acao="mais" aria-label="Mais">+</button>
        </div>`;
    } else {
      alvo = `sucesso: ${m.success_value ? 'Sim' : 'Não'} · ${textoDias(m.weekdays)}`;
      const v = e.bool_value;
      const padrao = v == null ? m.default_value : null;   // botão tracejado = valor assumido
      const cls = b => (v === b ? 'ativo' : '') + (padrao === b ? ' padrao' : '');
      corpo = `<div class="simnao">
          <button data-acao="sim" class="${cls(true)}">Sim</button>
          <button data-acao="nao" class="${cls(false)}">Não</button>
        </div>`;
      if (m.feeling_on != null && v === m.feeling_on) {
        const opcoes = (estado.listas.sentimentos || []).map(s =>
          `<option ${s === e.feeling ? 'selected' : ''}>${s}</option>`).join('');
        corpo += `<select class="sentimento" data-acao="sentimento">
            <option value="">Sentimento…</option>${opcoes}</select>`;
      }
    }
    return `<div class="card ${conta ? '' : 'esmaecido'} ${ok ? 'ok' : ''}" data-id="${m.id}">
        <div class="card-topo"><span class="card-nome">${m.question || m.name}${ok ? ' ✓' : ''}</span><span class="card-alvo">${alvo}</span></div>
        ${corpo}
      </div>`;
  }).join('') || '<p class="dica">Nenhuma meta cadastrada.</p>';
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

atualizarAvisoOffline();
