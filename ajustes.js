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
        <span class="card-alvo">${numerica ? `alvo ${num(m.target)} ${esc(m.unit || '')}` : 'sim/não'} · ${textoDias(m.weekdays)}</span></div>
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
      <label class="largura">Cálculo do %<select name="pct_mode">${Object.entries(MODOS).map(([k, t]) => opt(k, t, m.pct_mode)).join('')}</select></label>
      <div class="largura"><label>Dias em que conta</label>
        <div class="dias-sel">${NOMES_DIAS.map((n, d) => `<button type="button" data-dow="${d}" class="${m.weekdays.includes(d) ? 'sel' : ''}">${n}</button>`).join('')}</div>
      </div>
      <div class="botoes">
        <span class="msg-ok"></span>
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
  const hoje = C.hoje();
  const metas = estado.metas;
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
  XLSX.writeFile(wb, `metas-${hoje}.xlsx`);
};

// ---------------------------------------------------------------------
// Importar CSV ou o backup em Excel: mostra uma prévia e só grava depois de confirmar
// ---------------------------------------------------------------------
// Normaliza nomes de coluna/meta: minúsculas, sem acento, só letras e "_"
function normalizar(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
// Nomes de coluna da planilha antiga que não batem com o nome da meta
const APELIDOS = { organizacao: 'Organizar a semana', roi_unhas: 'Não roer unhas', unhas: 'Não roer unhas' };

let importacao = null;   // linhas prontas aguardando confirmação

// Liga cada coluna a uma meta pelo nome, pergunta ou apelido
function metasDasColunas(cab) {
  const porCol = {}, ignoradas = [];
  for (const col of cab) {
    if (['data', 'dia', 'sentimento', 'obs'].includes(col)) continue;
    const meta = estado.todas.find(m => normalizar(m.name) === col || normalizar(m.question || '') === col || APELIDOS[col] === m.name);
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
  const regs = aba('Registros').map(l => {
    const reg = {};
    for (const [k, v] of Object.entries(l)) reg[normalizar(k)] = txt(v);
    // Se a planilha foi salva no Excel, a data pode virar número de série
    reg.data = typeof l.Data === 'number' ? XLSX.SSF.format('yyyy-mm-dd', l.Data) : txt(l.Data);
    return reg;
  });
  const { porCol, ignoradas } = metasDasColunas(Object.keys(regs[0] || {}));
  const r = regsParaLinhas(regs, porCol);
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
  const dias = new Set(importacao.entries.map(e => e.day).concat(importacao.notas.map(n => n.day)));
  const extras = [importacao.ideias.length && `<b>${importacao.ideias.length}</b> ideias`, importacao.anot.length && `<b>${importacao.anot.length}</b> notas`].filter(Boolean);
  $('#previa-csv').innerHTML = `<div class="previa">
      <p><b>${dias.size}</b> dias, <b>${importacao.entries.length}</b> valores e <b>${importacao.notas.length}</b> anotações${extras.length ? ', além de ' + extras.join(' e ') : ''}.<br>
      Colunas reconhecidas: ${Object.entries(porCol).map(([c, m]) => `${c} → ${esc(m.name)}`).join(', ') || 'nenhuma'}.
      ${ignoradas.length ? `<br><span class="amarelo">Ignoradas: ${ignoradas.join(', ')}</span>` : ''}</p>
      <p class="dica">Valores do arquivo substituem os já registrados nos mesmos dias.</p>
      <div class="acoes"><button id="btn-confirmar-csv" class="primario">Importar</button><button id="btn-cancelar-csv" class="btn-sec">Cancelar</button></div>
    </div>`;
};

$('#previa-csv').addEventListener('click', async ev => {
  if (ev.target.id === 'btn-cancelar-csv') { importacao = null; $('#previa-csv').innerHTML = ''; return; }
  if (ev.target.id !== 'btn-confirmar-csv' || !importacao) return;
  ev.target.disabled = true; ev.target.textContent = 'Importando…';
  const uid = estado.user.id;
  // Envia em lotes de 500 linhas
  const enviar = async (tabela, linhas, conflito) => {
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await sb.from(tabela).upsert(linhas.slice(i, i + 500).map(l => ({ ...l, user_id: uid })), { onConflict: conflito });
      if (error) throw error;
    }
  };
  try {
    await enviar('entries', importacao.entries, 'user_id,goal_id,day');
    await enviar('day_notes', importacao.notas, 'user_id,day');
    await enviar('ideas', importacao.ideias, 'id');
    await enviar('notes', importacao.anot, 'id');
    importacao = null;
    $('#previa-csv').innerHTML = '<p class="previa msg-ok">Importação concluída ✓</p>';
    await carregar();
  } catch (e) {
    $('#previa-csv').innerHTML = `<p class="previa vermelho">Erro ao importar: ${esc(e.message)}</p>`;
  }
});
