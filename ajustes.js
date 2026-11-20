// =====================================================================
// ajustes.js — tela Ajustes: metas, lista de sentimentos, exportar
// Excel, importar CSV e troca de senha.
// Alterações de configuração vão direto ao banco (precisam de internet).
// =====================================================================

const MODOS = {
  days: 'Dias cumpridos ÷ dias que contam',
  sum: 'Soma do período ÷ (alvo × dias que contam)',
  answered: 'Sucessos ÷ dias com resposta'
};

// Recarrega do banco e redesenha a tela atual
async function recarregarTudo() { await carregar(); mostrarTela(estado.aba); }

function renderAjustes() {
  $('#lista-metas').innerHTML = estado.todas.map((m, i) => formMeta(m, i)).join('');
  $('#txt-sentimentos').value = (estado.listas.sentimentos || []).join('\n');
}

// Opção de <select> marcada quando o valor bate
const opt = (v, txt, atual) => `<option value="${v}" ${String(atual) === String(v) ? 'selected' : ''}>${txt}</option>`;

function formMeta(m, i) {
  const [icone, cor] = visual(m, i);
  const numerica = m.kind === 'numeric';
  return `<details class="meta-linha ${m.active ? '' : 'arquivada'}" data-id="${m.id}" style="--cor:${cor}">
    <summary>
      <div class="icone-meta">${icone}</div>
      <div class="card-tit"><span class="card-nome">${esc(m.name)}${m.active ? '' : ' (arquivada)'}</span>
        <span class="card-alvo">${numerica ? `alvo ${num(m.target)} ${esc(m.unit || '')}` : (m.checklist?.length ? `checklist de ${m.checklist.length} itens` : 'sim/não')} · ${textoDias(m.weekdays)}</span></div>
      <div class="ordem"><button data-mover="-1" title="Subir">▲</button><button data-mover="1" title="Descer">▼</button></div>
    </summary>
    <form class="form-meta" data-tipo="${m.kind}">
      <label class="largura">Nome<input name="name" required value="${esc(m.name)}"></label>
      <label class="largura">Pergunta na tela Hoje<input name="question" value="${esc(m.question || '')}"></label>
      <label>Tipo<select name="kind">${opt('numeric', 'Numérica', m.kind)}${opt('boolean', 'Sim / Não', m.kind)}</select></label>
      <label>Início<input name="start_date" type="date" required value="${m.start_date}"></label>
      <label data-so="numeric">Unidade<input name="unit" value="${esc(m.unit || '')}"></label>
      <label data-so="numeric">Alvo diário (mínimo)<input name="target" type="number" step="any" min="0" value="${m.target ?? ''}"></label>
      <label data-so="numeric">Passo do + / −<input name="step" type="number" step="any" min="0.01" value="${m.step ?? 1}"></label>
      <label data-so="boolean">Resposta de sucesso<select name="success_value">${opt('true', 'Sim', m.success_value)}${opt('false', 'Não', m.success_value)}</select></label>
      <label data-so="boolean">Dia em branco vale<select name="default_value">${opt('', 'Nada (em branco)', m.default_value ?? '')}${opt('true', 'Sim', m.default_value)}${opt('false', 'Não', m.default_value)}</select></label>
      <label data-so="boolean">Pedir sentimento<select name="feeling_on">${opt('', 'Nunca', m.feeling_on ?? '')}${opt('true', 'Quando Sim', m.feeling_on)}${opt('false', 'Quando Não', m.feeling_on)}</select></label>
      <label class="largura" data-so="boolean">Checklist (um item por linha)
        <textarea name="checklist" rows="${Math.min(12, Math.max(3, (m.checklist || []).length + 1))}" placeholder="Deixe vazio para usar só Sim / Não">${esc((m.checklist || []).join('\n'))}</textarea>
        <span class="dica">Com itens, a tela inicial mostra "Abrir checklist" e a meta vira Sim ao marcar todos. Renomear um item faz as semanas antigas o mostrarem como item à parte.</span></label>
      <label class="largura">Cálculo do %<select name="pct_mode">${Object.entries(MODOS).map(([k, t]) => opt(k, t, m.pct_mode)).join('')}</select></label>
      <div class="largura"><label>Dias em que conta</label>
        <div class="dias-sel">${NOMES_DIAS.map((n, d) => `<button type="button" data-dow="${d}" class="${m.weekdays.includes(d) ? 'sel' : ''}">${n}</button>`).join('')}</div>
      </div>
      <div class="botoes">
        <span class="msg-ok"></span>
        <button type="button" class="btn-sec btn-excluir" data-excluir>Excluir</button>
        <button type="button" class="btn-sec" data-arquivar>${m.active ? 'Arquivar' : 'Reativar'}</button>
        <button class="primario">Salvar</button>
      </div>
    </form>
  </details>`;
}

// Mostra só os campos do tipo escolhido (numérica ou sim/não)
function ajustarCampos(form) {
  const tipo = form.elements.kind.value;
  form.querySelectorAll('[data-so]').forEach(el => el.hidden = el.dataset.so !== tipo);
}

$('#lista-metas').addEventListener('toggle', ev => { const f = ev.target.querySelector('form'); if (f) ajustarCampos(f); }, true);
$('#lista-metas').addEventListener('change', ev => { if (ev.target.name === 'kind') ajustarCampos(ev.target.form); });

$('#lista-metas').addEventListener('click', async ev => {
  const linha = ev.target.closest('.meta-linha');
  if (!linha) return;
  const meta = estado.todas.find(m => m.id === linha.dataset.id);

  const dia = ev.target.closest('[data-dow]');
  if (dia) { dia.classList.toggle('sel'); return; }

  const mover = ev.target.closest('[data-mover]');
  if (mover) {
    // Troca a ordem com a vizinha (sort_order)
    ev.preventDefault();
    const i = estado.todas.indexOf(meta), j = i + Number(mover.dataset.mover);
    const outra = estado.todas[j];
    if (!outra) return;
    const lista = estado.todas.slice(); lista[i] = outra; lista[j] = meta;
    const erros = (await Promise.all(lista.map((m, k) => sb.from('goals').update({ sort_order: k }).eq('id', m.id)))).filter(r => r.error);
    if (erros.length) return alert('Não consegui salvar a ordem. Está sem internet?');
    return recarregarTudo();
  }

  // Excluir pede um segundo toque para confirmar; o histórico fica guardado
  const excluir = ev.target.closest('[data-excluir]');
  if (excluir) {
    if (!excluir.classList.contains('confirmar')) {
      excluir.classList.add('confirmar');
      excluir.textContent = 'Confirmar exclusão';
      excluir.insertAdjacentHTML('beforebegin', '<button type="button" class="btn-sec" data-cancelar-excluir>Cancelar</button>');
      return;
    }
    const { error } = await sb.from('goals').update({ removed: true, active: false }).eq('id', meta.id);
    if (error) return alert('Não consegui excluir. Está sem internet?');
    return recarregarTudo();
  }
  const cancelar = ev.target.closest('[data-cancelar-excluir]');
  if (cancelar) {
    const b = cancelar.nextElementSibling;
    b.classList.remove('confirmar'); b.textContent = 'Excluir';
    cancelar.remove();
    return;
  }

  if (ev.target.closest('[data-arquivar]')) {
    const { error } = await sb.from('goals').update({ active: !meta.active }).eq('id', meta.id);
    if (error) return alert('Não consegui salvar. Está sem internet?');
    return recarregarTudo();
  }
});

$('#lista-metas').addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = ev.target;
  const id = form.closest('.meta-linha').dataset.id;
  const f = form.elements;
  const bool = v => v === '' ? null : v === 'true';
  const weekdays = [...form.querySelectorAll('[data-dow].sel')].map(b => Number(b.dataset.dow));
  if (!weekdays.length) return alert('Escolha pelo menos um dia em que a meta conta.');
  const dados = {
    name: f.name.value.trim(), question: f.question.value.trim() || null, kind: f.kind.value,
    start_date: f.start_date.value, pct_mode: f.pct_mode.value, weekdays
  };
  if (dados.kind === 'numeric') {
    if (f.target.value === '') return alert('Informe o alvo diário.');
    Object.assign(dados, { unit: f.unit.value.trim() || null, target: Number(f.target.value), step: Number(f.step.value) || 1,
                           success_value: null, default_value: null, feeling_on: null });
  } else {
    Object.assign(dados, { success_value: f.success_value.value === 'true', default_value: bool(f.default_value.value),
                           feeling_on: bool(f.feeling_on.value), target: null });
    const itens = [...new Set(f.checklist.value.split('\n').map(t => t.trim()).filter(Boolean))];
    dados.checklist = itens.length ? itens : null;
  }
  const { error } = await sb.from('goals').update(dados).eq('id', id);
  if (error) return alert('Não consegui salvar: ' + (error.code === '23505' ? 'já existe uma meta com esse nome.' : error.message));
  await carregar();
  renderAjustes();
  const nova = document.querySelector(`.meta-linha[data-id="${id}"]`);
  nova.open = true;
  nova.querySelector('.msg-ok').textContent = 'Salvo ✓';
});

$('#btn-nova-meta').onclick = async () => {
  // Cria com valores padrão; o usuário ajusta no formulário que abre em seguida
  let nome = 'Nova meta', n = 2;
  while (estado.todas.some(m => m.name === nome)) nome = 'Nova meta ' + n++;
  const { data, error } = await sb.from('goals').insert({
    user_id: estado.user.id, name: nome, kind: 'numeric', unit: 'vezes', step: 1, target: 1,
    weekdays: [0, 1, 2, 3, 4, 5, 6], pct_mode: 'days', start_date: C.hoje(), sort_order: estado.todas.length
  }).select().single();
  if (error) return alert('Não consegui criar: ' + error.message);
  await carregar();
  renderAjustes();
  const linha = document.querySelector(`.meta-linha[data-id="${data.id}"]`);
  linha.open = true;
  linha.scrollIntoView({ behavior: 'smooth', block: 'center' });
  linha.querySelector('[name="name"]').select();
};

$('#btn-salvar-sent').onclick = async () => {
  const items = $('#txt-sentimentos').value.split('\n').map(s => s.trim()).filter(Boolean);
  const { error } = await sb.from('lists').upsert({ user_id: estado.user.id, key: 'sentimentos', items });
  if (error) return alert('Não consegui salvar. Está sem internet?');
  estado.listas.sentimentos = items;
  $('#btn-salvar-sent').textContent = 'Salvo ✓';
  setTimeout(() => $('#btn-salvar-sent').textContent = 'Salvar lista', 1500);
};

$('#form-troca-senha').onsubmit = async ev => {
  ev.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $('#troca-senha').value });
  $('#msg-conta').textContent = error ? 'Erro: ' + error.message : 'Senha alterada ✓';
  if (!error) $('#form-troca-senha').reset();
};

// ---------------------------------------------------------------------
// Exportar para Excel: abas Registros, Resumo semanal, Resumo mensal, Ideias e Notas (serve de backup)
// ---------------------------------------------------------------------
$('#btn-exportar').onclick = () => {
  if (!window.XLSX) return alert('A biblioteca do Excel ainda não carregou. Tente de novo em alguns segundos.');
  XLSX.writeFile(gerarBackup(), `metas-${C.hoje()}.xlsx`);
};

// Colunas da aba Metas (configuração de cada meta, para recriá-las na importação)
const COLS_METAS = ['id', 'Nome', 'Pergunta', 'Tipo', 'Unidade', 'Passo', 'Alvo', 'Sucesso', 'Padrão', 'Sentimento quando',
  'Dias', 'Modo %', 'Início', 'Ordem', 'Ativa', 'Checklist'];
const simNao = b => b == null ? '' : b ? 'Sim' : 'Não';

function gerarBackup() {
  const hoje = C.hoje();
  const metas = estado.todas;   // inclui metas pausadas, para não perder o histórico delas
  const inicio = metas.reduce((m, g) => g.start_date < m ? g.start_date : m, hoje);
  const metaSent = metas.find(m => m.feeling_on != null);

  // Registros diários: valor exatamente como registrado (vazio = não registrado)
  const registros = C.listaDias(inicio, hoje).map(d => {
    const linha = { Data: d, Dia: NOMES_DIAS[C.diaSemana(d)] };
    for (const m of metas) {
      const e = estado.mapa[m.id + '|' + d];
      // Sim/não usa a pergunta como título ("Roí unhas?"), para o "Sim" ficar claro
      linha[m.kind === 'boolean' && m.question ? m.question : m.name] = !e ? '' : m.kind === 'numeric' ? (e.num_value == null ? '' : Number(e.num_value))
                                                    : (e.bool_value == null ? '' : e.bool_value ? 'Sim' : 'Não');
    }
    if (metaSent) linha.Sentimento = (estado.mapa[metaSent.id + '|' + d] || {}).feeling || '';
    linha.OBS = estado.notas[d] || '';
    return linha;
  });

  // Resumos: % como número (formato 0%) para dar para fazer contas no Excel
  const resumo = tipo => listaPeriodos(tipo).reverse().map(([de, ate]) => {
    const r = C.resumo(metas, estado.mapa, de, ate, hoje);
    const linha = { 'Início': de, 'Fim': ate, 'Parcial': ate >= hoje ? 'sim' : '' };
    for (const m of metas) linha[m.name] = r.porMeta[m.id] ? r.porMeta[m.id].pct : '';
    linha['Média geral'] = r.media ?? '';
    return linha;
  });
  const abaPct = linhas => {
    const ws = XLSX.utils.json_to_sheet(linhas);
    for (const [ref, cel] of Object.entries(ws)) if (!ref.startsWith('!') && typeof cel.v === 'number') cel.z = '0%';
    return ws;
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(registros), 'Registros');
  XLSX.utils.book_append_sheet(wb, abaPct(resumo('semana')), 'Resumo semanal');
  XLSX.utils.book_append_sheet(wb, abaPct(resumo('mes')), 'Resumo mensal');
  // Ideias e Notas vão com o id, para a importação do backup atualizar em vez de duplicar
  const sn = b => b ? 'Sim' : 'Não';
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(estado.ideias).map(i => ({
    id: i.id, Ideia: i.text, 'Referência': i.source || '', Tipo: i.kind || '', Feita: sn(i.done), 'Criada em': i.created_at
  })), { header: ['id', 'Ideia', 'Referência', 'Tipo', 'Feita', 'Criada em'] }), 'Ideias');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(estado.anot).map(n => ({
    id: n.id, 'Título': n.title || '', Tipo: n.kind, Texto: n.body || '', Itens: JSON.stringify(n.items || []),
    Fixada: sn(n.pinned), Arquivada: sn(n.archived), 'Criada em': n.created_at, 'Atualizada em': n.updated_at || n.created_at
  })), { header: ['id', 'Título', 'Tipo', 'Texto', 'Itens', 'Fixada', 'Arquivada', 'Criada em', 'Atualizada em'] }), 'Notas');
  // Checklist: uma linha por item de cada semana, com o comentário
  const ck = [];
  for (const e of Object.values(estado.mapa)) {
    const m = estado.todas.find(g => g.id === e.goal_id);
    if (!m || !e.checks) continue;
    const itens = [...new Set([...(m.checklist || []), ...(e.checks.ok || []), ...Object.keys(e.checks.obs || {})])];
    for (const t of itens) {
      const feito = (e.checks.ok || []).includes(t), obs = (e.checks.obs || {})[t] || '';
      if (feito || obs) ck.push({ Data: e.day, Meta: m.name, Item: t, Feito: sn(feito), 'Comentário': obs });
    }
  }
  ck.sort((a, b) => b.Data.localeCompare(a.Data));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ck, { header: ['Data', 'Meta', 'Item', 'Feito', 'Comentário'] }), 'Checklist');
  // Metas (configuração) e Sentimentos (opções da lista)
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metas.map((m, i) => ({
    id: m.id, Nome: m.name, Pergunta: m.question || '', Tipo: m.kind, Unidade: m.unit || '', Passo: m.step ?? '', Alvo: m.target ?? '',
    Sucesso: simNao(m.success_value), 'Padrão': simNao(m.default_value), 'Sentimento quando': simNao(m.feeling_on),
    Dias: (m.weekdays || []).join(','), 'Modo %': m.pct_mode, 'Início': m.start_date, Ordem: m.sort_order ?? i,
    Ativa: sn(m.active !== false), Checklist: m.checklist?.length ? JSON.stringify(m.checklist) : ''
  })), { header: COLS_METAS }), 'Metas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((estado.listas.sentimentos || []).map(s => ({ Sentimento: s })),
    { header: ['Sentimento'] }), 'Sentimentos');
  return wb;
}

// ---------------------------------------------------------------------
// Importar CSV ou o backup em Excel: mostra uma prévia e só grava depois de confirmar
// ---------------------------------------------------------------------
// Normaliza nomes de coluna/meta: minúsculas, sem acento, só letras e "_"
function normalizar(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
// Nomes de coluna da planilha antiga que não batem com o nome da meta
const APELIDOS = { organizacao: 'Organizar a semana', roi_unhas: 'Não roer unhas', unhas: 'Não roer unhas' };

let importacao = null;   // linhas prontas aguardando confirmação

// Liga cada coluna a uma meta pelo nome, pergunta ou apelido
function metasDasColunas(cab, lista = estado.todas) {
  const porCol = {}, ignoradas = [];
  for (const col of cab) {
    if (['data', 'dia', 'sentimento', 'obs'].includes(col)) continue;
    const meta = lista.find(m => normalizar(m.name) === col || normalizar(m.question || '') === col || APELIDOS[col] === m.name);
    if (meta) porCol[col] = meta; else ignoradas.push(col);
  }
  return { porCol, ignoradas };
}

// Backup em Excel (o arquivo que o próprio app exporta): abas Registros, Ideias e Notas
function lerBackup(wb) {
  const aba = nome => wb.Sheets[nome] ? XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '' }) : [];
  const txt = v => String(v ?? '').trim();
  const sim = v => /^s/i.test(txt(v));
  const agora = new Date().toISOString();
  const avisos = [];

  // Metas do backup: valida cada linha; as que não existem aqui (pelo nome) serão criadas antes dos registros
  const numOuNulo = v => txt(v) === '' || isNaN(Number(txt(v).replace(',', '.'))) ? null : Number(txt(v).replace(',', '.'));
  const simNaoOuNulo = v => txt(v) === '' ? null : sim(v);
  const ehData = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const ehUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const metasCriar = [];
  for (const l of aba('Metas')) {
    const nome = txt(l.Nome), tipo = txt(l.Tipo);
    if (!nome) continue;
    if (!['numeric', 'boolean'].includes(tipo)) { avisos.push(`Meta "${nome}" ignorada: tipo inválido`); continue; }
    if (estado.todas.some(m => m.name === nome) || metasCriar.some(m => m.name === nome)) continue;   // já existe: não mexe
    const dias = txt(l.Dias).split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
    const inicio = typeof l['Início'] === 'number' ? XLSX.SSF.format('yyyy-mm-dd', l['Início']) : txt(l['Início']);
    let checklist = null;
    try { const c = JSON.parse(txt(l.Checklist) || 'null'); if (Array.isArray(c) && c.length) checklist = c.map(String); } catch { avisos.push(`Checklist da meta "${nome}" ilegível`); }
    const id = ehUuid(txt(l.id)) && !estado.todas.some(m => m.id === txt(l.id)) ? txt(l.id) : crypto.randomUUID();
    const meta = {
      id, name: nome, question: txt(l.Pergunta) || null, kind: tipo, unit: txt(l.Unidade) || null,
      step: numOuNulo(l.Passo) ?? 1, target: numOuNulo(l.Alvo),
      success_value: simNaoOuNulo(l.Sucesso), default_value: simNaoOuNulo(l['Padrão']), feeling_on: simNaoOuNulo(l['Sentimento quando']),
      weekdays: dias.length ? [...new Set(dias)].sort() : [0, 1, 2, 3, 4, 5, 6],
      pct_mode: ['sum', 'days', 'answered'].includes(txt(l['Modo %'])) ? txt(l['Modo %']) : 'days',
      start_date: ehData(inicio) ? inicio : C.hoje(), sort_order: numOuNulo(l.Ordem) ?? 0,
      active: txt(l.Ativa) === '' ? true : sim(l.Ativa)
    };
    if (checklist) meta.checklist = checklist;
    if (tipo === 'numeric' && meta.target == null) { avisos.push(`Meta "${nome}" ignorada: sem alvo`); continue; }
    if (tipo === 'boolean' && meta.success_value == null) meta.success_value = true;
    metasCriar.push(meta);
  }
  const lista = [...estado.todas, ...metasCriar];
  const sentimentos = aba('Sentimentos').map(l => txt(l.Sentimento)).filter(Boolean);

  const regs = aba('Registros').map(l => {
    const reg = {};
    for (const [k, v] of Object.entries(l)) reg[normalizar(k)] = txt(v);
    // Se a planilha foi salva no Excel, a data pode virar número de série
    reg.data = typeof l.Data === 'number' ? XLSX.SSF.format('yyyy-mm-dd', l.Data) : txt(l.Data);
    return reg;
  });
  const { porCol, ignoradas } = metasDasColunas(Object.keys(regs[0] || {}), lista);
  const r = regsParaLinhas(regs, porCol);
  // Descarta valores numéricos ilegíveis (ex.: texto numa coluna de número)
  const antes = r.entries.length;
  r.entries = r.entries.filter(e => e.num_value == null || Number.isFinite(e.num_value));
  if (r.entries.length < antes) avisos.push(`${antes - r.entries.length} valores numéricos ilegíveis foram ignorados`);
  r.metasCriar = metasCriar;
  r.sentimentos = sentimentos;
  r.avisos = avisos;
  r.ideias = aba('Ideias').filter(l => txt(l.id) && txt(l.Ideia)).map(l => ({
    id: txt(l.id), text: txt(l.Ideia), source: txt(l['Referência']) || null, kind: txt(l.Tipo) || null,
    done: sim(l.Feita), created_at: txt(l['Criada em']) || agora
  }));
  r.anot = aba('Notas').filter(l => txt(l.id)).map(l => {
    let itens = [];
    try { itens = JSON.parse(txt(l.Itens) || '[]'); } catch { }
    return { id: txt(l.id), kind: txt(l.Tipo) === 'list' ? 'list' : 'text', title: txt(l['Título']), body: txt(l.Texto), items: itens,
      pinned: sim(l.Fixada), archived: sim(l.Arquivada), created_at: txt(l['Criada em']) || agora, updated_at: txt(l['Atualizada em']) || agora };
  });
  // Checklist: junta os itens de volta no registro do dia (entries.checks)
  for (const l of aba('Checklist')) {
    const dia = typeof l.Data === 'number' ? XLSX.SSF.format('yyyy-mm-dd', l.Data) : txt(l.Data);
    const meta = lista.find(m => m.name === txt(l.Meta));
    const item = txt(l.Item);
    if (!meta || !item || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    let e = r.entries.find(x => x.goal_id === meta.id && x.day === dia);
    if (!e) {
      const atual = estado.mapa[meta.id + '|' + dia] || {};
      e = { goal_id: meta.id, day: dia, num_value: null, bool_value: atual.bool_value ?? null, feeling: atual.feeling ?? null };
      r.entries.push(e);
    }
    e.checks = e.checks || { ok: [], obs: {} };
    if (sim(l.Feito)) e.checks.ok.push(item);
    if (txt(l['Comentário'])) e.checks.obs[item] = txt(l['Comentário']);
  }
  return { r, porCol, ignoradas };
}

$('#arq-csv').onchange = async ev => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  let porCol, ignoradas;
  if (/\.xlsx$/i.test(arq.name)) {
    if (!window.XLSX) return alert('A biblioteca do Excel ainda não carregou. Tente de novo em alguns segundos.');
    const wb = XLSX.read(await arq.arrayBuffer());
    if (!wb.Sheets.Registros) return $('#previa-csv').innerHTML = '<p class="previa vermelho">Esse Excel não tem a aba "Registros". Use o arquivo exportado pelo app.</p>';
    ({ r: importacao, porCol, ignoradas } = lerBackup(wb));
  } else {
    const texto = await arq.text();
    const cab = texto.split(/\r?\n/)[0].split(';').map(normalizar);
    if (!cab.includes('data')) return $('#previa-csv').innerHTML = '<p class="previa vermelho">O arquivo precisa ter a coluna "data" e usar ";" como separador.</p>';
    ({ porCol, ignoradas } = metasDasColunas(cab));
    // csvParaLinhas lê o cabeçalho original; reescreve-o normalizado
    const linhasTxt = texto.split(/\r?\n/); linhasTxt[0] = cab.join(';');
    importacao = { ...csvParaLinhas(linhasTxt.join('\n'), porCol), ideias: [], anot: [] };
  }
  importacao.metasCriar ??= []; importacao.sentimentos ??= []; importacao.avisos ??= [];
  const dias = new Set(importacao.entries.map(e => e.day).concat(importacao.notas.map(n => n.day)));
  const extras = [importacao.ideias.length && `<b>${importacao.ideias.length}</b> ideias`, importacao.anot.length && `<b>${importacao.anot.length}</b> notas`].filter(Boolean);
  const criar = importacao.metasCriar;
  $('#previa-csv').innerHTML = `<div class="previa">
      <p><b>${dias.size}</b> dias, <b>${importacao.entries.length}</b> valores e <b>${importacao.notas.length}</b> anotações${extras.length ? ', além de ' + extras.join(' e ') : ''}.<br>
      ${criar.length ? `Metas que serão criadas antes: <b>${criar.map(m => esc(m.name)).join(', ')}</b>.<br>` : ''}
      Colunas reconhecidas: ${Object.entries(porCol).map(([c, m]) => `${c} → ${esc(m.name)}`).join(', ') || 'nenhuma'}.
      ${ignoradas.length ? `<br><span class="amarelo">Ignoradas: ${ignoradas.map(esc).join(', ')}</span>` : ''}
      ${importacao.avisos.length ? `<br><span class="amarelo">${importacao.avisos.map(esc).join('<br>')}</span>` : ''}</p>
      <p class="dica">Valores do arquivo substituem os já registrados nos mesmos dias. Metas que já existem não são alteradas.
      Antes de gravar, o app baixa um backup do que está no app agora (para desfazer, é só importar esse arquivo).</p>
      <div class="acoes"><button id="btn-confirmar-csv" class="primario">Importar</button><button id="btn-cancelar-csv" class="btn-sec">Cancelar</button></div>
    </div>`;
};

$('#previa-csv').addEventListener('click', async ev => {
  if (ev.target.id === 'btn-cancelar-csv') { importacao = null; $('#previa-csv').innerHTML = ''; return; }
  if (ev.target.id !== 'btn-confirmar-csv' || !importacao) return;
  if (!navigator.onLine) return alert('Sem internet. A importação precisa de conexão para gravar com segurança.');
  const imp = importacao;
  const msg = t => $('#previa-csv').innerHTML = `<p class="previa">${t}</p>`;

  // 1) Segurança: baixa um backup do estado atual antes de mudar qualquer coisa
  const temDados = Object.keys(estado.mapa).length || Object.keys(estado.ideias || {}).length || Object.keys(estado.anot || {}).length;
  if (temDados && window.XLSX) XLSX.writeFile(gerarBackup(), `metas-antes-da-importacao-${C.hoje()}.xlsx`);

  ev.target.disabled = true; ev.target.textContent = 'Importando…';
  const uid = estado.user.id;
  // Envia em lotes de 500 linhas; tenta de novo até 3 vezes se a rede falhar
  const enviar = async (tabela, linhas, conflito) => {
    for (let i = 0; i < linhas.length; i += 500) {
      let error;
      for (let t = 0; t < 3; t++) {
        ({ error } = await sb.from(tabela).upsert(linhas.slice(i, i + 500).map(l => ({ ...l, user_id: uid })), { onConflict: conflito }));
        if (!error) break;
        await new Promise(r => setTimeout(r, 1000 * (t + 1)));
      }
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
  };
  let etapa = '';
  try {
    // 2) Envia o que estava pendente na fila local, para não sobrescrever a importação depois
    etapa = 'pendências locais'; if (typeof sincronizar === 'function') await sincronizar();
    // 3) Metas primeiro: os registros dependem delas
    etapa = 'metas'; msg('Criando metas…');
    if (imp.metasCriar.length) {
      // Cria sem duplicar: se uma meta com o mesmo nome já existir no banco, não mexe nela
      const { error } = await sb.from('goals').upsert(imp.metasCriar.map(m => ({ ...m, user_id: uid })), { onConflict: 'user_id,name', ignoreDuplicates: true });
      if (error) throw new Error('goals: ' + error.message);
      // Confere que todas as metas usadas pelos registros existem com o id esperado
      const { data, error: e2 } = await sb.from('goals').select('id,name');
      if (e2) throw new Error('goals: ' + e2.message);
      const ids = new Set(data.map(g => g.id));
      const faltando = imp.metasCriar.filter(m => !ids.has(m.id));
      if (faltando.length) {
        // Já existia com outro id (mesmo nome): aponta os registros para o id do banco
        const porNome = Object.fromEntries(data.map(g => [g.name, g.id]));
        const troca = Object.fromEntries(faltando.map(m => [m.id, porNome[m.name]]));
        if (faltando.some(m => !porNome[m.name])) throw new Error('não foi possível criar as metas: ' + faltando.map(m => m.name).join(', '));
        for (const e of imp.entries) if (troca[e.goal_id]) e.goal_id = troca[e.goal_id];
      }
    }
    if (imp.sentimentos.length) {
      etapa = 'sentimentos';
      const juntos = [...new Set([...(estado.listas.sentimentos || []), ...imp.sentimentos])];
      const { error } = await sb.from('lists').upsert({ user_id: uid, key: 'sentimentos', items: juntos });
      if (error) throw new Error('lists: ' + error.message);
    }
    // 4) Registros e o resto
    etapa = 'registros'; msg('Gravando registros…'); await enviar('entries', imp.entries, 'user_id,goal_id,day');
    etapa = 'OBS'; await enviar('day_notes', imp.notas, 'user_id,day');
    etapa = 'ideias'; await enviar('ideas', imp.ideias, 'id');
    etapa = 'notas'; await enviar('notes', imp.anot, 'id');
    // 5) Conferência: recarrega do banco e verifica se cada item importado está lá
    etapa = 'conferência'; msg('Conferindo…');
    await carregar();
    const faltam = imp.entries.filter(e => !estado.mapa[e.goal_id + '|' + e.day]).length
      + imp.ideias.filter(i => !estado.ideias[i.id]).length + imp.anot.filter(n => !estado.anot[n.id]).length
      + imp.notas.filter(n => estado.notas[n.day] == null).length;
    const total = imp.entries.length + imp.ideias.length + imp.anot.length + imp.notas.length;
    importacao = null;
    $('#previa-csv').innerHTML = faltam
      ? `<p class="previa vermelho">Importação terminou, mas ${faltam} de ${total} itens não apareceram no banco. Tente importar de novo (é seguro repetir).</p>`
      : `<p class="previa msg-ok">Importação concluída e conferida ✓ (${total} itens${imp.metasCriar.length ? `, ${imp.metasCriar.length} metas criadas` : ''})</p>`;
  } catch (e) {
    $('#previa-csv').innerHTML = `<p class="previa vermelho">Erro ao importar (${etapa}): ${esc(e.message)}<br>
      Nada foi apagado. Importar o mesmo arquivo de novo é seguro: o que já entrou é só atualizado, sem duplicar.</p>`;
  }
});
