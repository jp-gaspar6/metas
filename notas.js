// =====================================================================
// notas.js — tela Notas, no estilo do Google Keep: cartões em mosaico,
// notas de texto ou de caixinhas, cores, fixar, arquivar e busca.
// =====================================================================

const CORES_NOTA = { vermelho: '#f28b82', laranja: '#fbbc04', amarelo: '#fff475', verde: '#ccff90',
  'azul-claro': '#a7ffeb', azul: '#aecbfa', roxo: '#d7aefb', rosa: '#fdcfe8' };
const notasUi = { busca: '', arquivo: false };
let editando = null;   // nota aberta no editor
let notaNova = false;  // true até a nota ter algum conteúdo salvo

const semAcento = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const corNota = n => n.color && CORES_NOTA[n.color] ? `style="--nc:${CORES_NOTA[n.color]}"` : '';
const notaVazia = n => !(n.title || '').trim() && !(n.body || '').trim() && !n.items.some(i => i.t.trim());

// ---------------------------------------------------------------------
// Mosaico
// ---------------------------------------------------------------------
function cartaoNota(n) {
  let corpo = '';
  if (n.kind === 'list') {
    const abertos = n.items.filter(i => !i.done && i.t.trim()), feitos = n.items.filter(i => i.done && i.t.trim());
    corpo = abertos.slice(0, 8).map(i => `<li>☐ ${esc(i.t)}</li>`).join('') +
      (abertos.length > 8 ? `<li class="mais">…</li>` : '') +
      (feitos.length ? `<li class="mais">+ ${feitos.length} ${feitos.length > 1 ? 'itens marcados' : 'item marcado'}</li>` : '');
    corpo = `<ul>${corpo}</ul>`;
  } else if (n.body) corpo = `<p>${esc(n.body)}</p>`;
  return `<button class="nota-card" data-id="${n.id}" ${corNota(n)}>
      ${n.title ? `<strong>${esc(n.title)}</strong>` : ''}${corpo}
    </button>`;
}

function renderNotas() {
  const q = semAcento(notasUi.busca);
  const todas = Object.values(estado.anot)
    .filter(n => n.archived === notasUi.arquivo)
    .filter(n => !q || semAcento([n.title, n.body, ...n.items.map(i => i.t)].join(' ')).includes(q))
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const fixadas = notasUi.arquivo ? [] : todas.filter(n => n.pinned);
  const outras = notasUi.arquivo ? todas : todas.filter(n => !n.pinned);
  $('#notas-fixadas').innerHTML = fixadas.map(cartaoNota).join('');
  $('#notas-outras').innerHTML = outras.map(cartaoNota).join('');
  $('#notas-fixadas-tit').hidden = !fixadas.length;
  $('#notas-outras-tit').hidden = !fixadas.length || !outras.length;
  $('#notas-arquivo').classList.toggle('sel', notasUi.arquivo);
  $('#notas-novas').hidden = notasUi.arquivo;
  $('#notas-vazio').hidden = todas.length > 0;
  $('#notas-vazio').textContent = q ? 'Nenhuma nota encontrada.'
    : notasUi.arquivo ? 'Nenhuma nota arquivada.' : 'Suas notas aparecem aqui.';
}

$('#notas-busca').addEventListener('input', ev => { notasUi.busca = ev.target.value; renderNotas(); });
$('#notas-arquivo').onclick = () => { notasUi.arquivo = !notasUi.arquivo; renderNotas(); };
$('#nova-nota').onclick = () => abrirNota(null, 'text');
$('#nova-lista').onclick = () => abrirNota(null, 'list');
for (const id of ['#notas-fixadas', '#notas-outras']) {
  $(id).addEventListener('click', ev => {
    const c = ev.target.closest('.nota-card');
    if (c) abrirNota(estado.anot[c.dataset.id]);
  });
}

// ---------------------------------------------------------------------
// Editor (sobreposto). Salva a cada alteração; nota nova vazia é descartada.
// ---------------------------------------------------------------------
document.body.appendChild($('#editor-nota'));
const novoItem = (t = '') => ({ id: crypto.randomUUID(), t, done: false });

function abrirNota(n, kind) {
  notaNova = !n;
  editando = n ? JSON.parse(JSON.stringify(n)) : {
    id: crypto.randomUUID(), kind, title: '', body: '', items: kind === 'list' ? [novoItem()] : [],
    color: null, pinned: false, archived: false, created_at: new Date().toISOString()
  };
  $('#ne-titulo').value = editando.title || '';
  $('#ne-corpo').value = editando.body || '';
  renderEditor();
  $('#editor-nota').hidden = false;
  if (notaNova) (kind === 'list' ? $('#ne-itens input.ne-txt') : $('#ne-corpo')).focus();
}

function renderEditor() {
  const n = editando, lista = n.kind === 'list';
  $('#editor-nota .nota-editor').setAttribute('style', n.color ? `--nc:${CORES_NOTA[n.color]}` : '');
  $('#ne-corpo').hidden = lista;
  $('#ne-itens').hidden = !lista;
  $('#ne-fixar').classList.toggle('sel', n.pinned);
  $('#ne-fixar').setAttribute('aria-pressed', n.pinned);
  $('#ne-tipo').textContent = lista ? 'Virar texto' : 'Virar lista';
  $('#ne-arquivar').textContent = n.archived ? 'Desarquivar' : 'Arquivar';
  $('#ne-apagar').hidden = notaNova;
  $('#ne-arquivar').hidden = notaNova;
  if (lista) {
    const linha = i => `<div class="ne-item ${i.done ? 'feito' : ''}" data-id="${i.id}">
        <input type="checkbox" class="ne-marca" ${i.done ? 'checked' : ''} aria-label="Marcar item">
        <input class="ne-txt" value="${esc(i.t)}" placeholder="Item">
        <button class="icone ne-tirar" aria-label="Remover item">×</button>
      </div>`;
    const abertos = n.items.filter(i => !i.done), feitos = n.items.filter(i => i.done);
    $('#ne-itens').innerHTML = abertos.map(linha).join('') +
      `<button class="link ne-add">+ Item</button>` +
      (feitos.length ? `<div class="ne-sep">${feitos.length} ${feitos.length > 1 ? 'itens marcados' : 'item marcado'}</div>` + feitos.map(linha).join('') : '');
  }
}

function salvarNota() {
  const n = editando;
  n.title = $('#ne-titulo').value;
  n.body = $('#ne-corpo').value;
  if (notaNova && notaVazia(n)) return;
  notaNova = false;
  n.updated_at = new Date().toISOString();
  estado.anot[n.id] = JSON.parse(JSON.stringify(n));
  enfileirar('notes', n.id, estado.anot[n.id]);
  $('#ne-apagar').hidden = $('#ne-arquivar').hidden = false;
}

function fecharNota() {
  if (!editando) return;
  salvarNota();
  $('#editor-nota').hidden = true;
  editando = null;
  renderNotas();
}

$('#ne-titulo').addEventListener('input', salvarNota);
$('#ne-corpo').addEventListener('input', salvarNota);
$('#ne-fechar').onclick = fecharNota;
$('#editor-nota').addEventListener('click', ev => { if (ev.target.id === 'editor-nota') fecharNota(); });
$('#ne-fixar').onclick = () => { editando.pinned = !editando.pinned; renderEditor(); salvarNota(); };
$('#ne-tipo').onclick = () => {
  const n = editando;
  n.body = $('#ne-corpo').value;
  if (n.kind === 'text') {
    n.items = n.body.split('\n').filter(l => l.trim()).map(l => novoItem(l.trim()));
    if (!n.items.length) n.items = [novoItem()];
    n.body = ''; n.kind = 'list';
  } else {
    n.body = n.items.filter(i => i.t.trim()).map(i => i.t).join('\n');
    $('#ne-corpo').value = n.body;
    n.items = []; n.kind = 'text';
  }
  renderEditor(); salvarNota();
};
$('#ne-arquivar').onclick = () => { editando.archived = !editando.archived; if (editando.archived) editando.pinned = false; fecharNota(); };
$('#ne-apagar').onclick = async () => {
  if (!confirm('Apagar esta nota?')) return;
  const id = editando.id;
  delete estado.anot[id];
  delete fila['notes|' + id];
  gravarLocal('fila_' + estado.user.id, fila);
  $('#editor-nota').hidden = true; editando = null; renderNotas();
  const { error } = await sb.from('notes').delete().eq('id', id);
  if (error) { status('erro ao apagar', true); console.error(error); }
};

// Itens da lista
const itemDe = el => editando.items.find(i => i.id === el.closest('.ne-item').dataset.id);
$('#ne-itens').addEventListener('input', ev => {
  if (ev.target.classList.contains('ne-txt')) { itemDe(ev.target).t = ev.target.value; salvarNota(); }
});
$('#ne-itens').addEventListener('change', ev => {
  if (ev.target.classList.contains('ne-marca')) { itemDe(ev.target).done = ev.target.checked; renderEditor(); salvarNota(); }
});
$('#ne-itens').addEventListener('click', ev => {
  if (ev.target.closest('.ne-tirar')) {
    const it = itemDe(ev.target);
    editando.items = editando.items.filter(i => i !== it);
    renderEditor(); salvarNota();
  } else if (ev.target.closest('.ne-add')) {
    editando.items.push(novoItem());
    renderEditor();
    [...$('#ne-itens').querySelectorAll('.ne-item:not(.feito) .ne-txt')].pop().focus();
  }
});
// Enter num item cria o próximo logo abaixo, como no Keep
$('#ne-itens').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || !ev.target.classList.contains('ne-txt')) return;
  ev.preventDefault();
  const atual = itemDe(ev.target), novo = novoItem();
  editando.items.splice(editando.items.indexOf(atual) + 1, 0, novo);
  renderEditor();
  $(`#ne-itens .ne-item[data-id="${novo.id}"] .ne-txt`).focus();
});
