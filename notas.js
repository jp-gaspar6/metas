// =====================================================================
// notas.js — tela Notas, no estilo do Google Keep: cartões em mosaico,
// notas de texto ou de caixinhas, fixar, arquivar e busca.
// =====================================================================

const notasUi = { busca: '', arquivo: false, sel: new Set() };
let editando = null;   // nota aberta no editor
let notaNova = false;  // true até a nota ter algum conteúdo salvo

const semAcento = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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
  const cor = n.color ? ` style="--nc:${n.color}"` : '';
  return `<button class="nota-card ${notasUi.sel.has(n.id) ? 'sel' : ''}" data-id="${n.id}"${cor}>
      ${n.title ? `<strong>${esc(n.title)}</strong>` : ''}${corpo}
    </button>`;
}

function renderNotas() {
  const q = semAcento(notasUi.busca);
  const todas = Object.values(estado.anot)
    .filter(n => n.archived === notasUi.arquivo)
    .filter(n => !q || semAcento([n.title, n.body, ...n.items.map(i => i.t)].join(' ')).includes(q))
    .sort(porOrdem);
  const fixadas = notasUi.arquivo ? [] : todas.filter(n => n.pinned);
  const outras = notasUi.arquivo ? todas : todas.filter(n => !n.pinned);
  $('#notas-fixadas').innerHTML = fixadas.map(cartaoNota).join('');
  $('#notas-outras').innerHTML = outras.map(cartaoNota).join('');
  $('#notas-fixadas-tit').hidden = !fixadas.length;
  $('#notas-outras-tit').hidden = !fixadas.length || !outras.length;
  $('#notas-arquivo').classList.toggle('sel', notasUi.arquivo);
  barraSel();
  $('#notas-novas').hidden = notasUi.arquivo;
  $('#notas-vazio').hidden = todas.length > 0;
  $('#notas-vazio').textContent = q ? 'Nenhuma nota encontrada.'
    : notasUi.arquivo ? 'Nenhuma nota arquivada.' : 'Suas notas aparecem aqui.';
}
function barraSel() {
  $('#notas-selbar').hidden = !notasUi.sel.size;
  $('#sel-qtd').textContent = notasUi.sel.size;
  $('#sel-arquivar').setAttribute('aria-label', notasUi.arquivo ? 'Desarquivar' : 'Arquivar');
}

$('#notas-busca').addEventListener('input', ev => { notasUi.busca = ev.target.value; renderNotas(); });
$('#notas-arquivo').onclick = () => { notasUi.arquivo = !notasUi.arquivo; renderNotas(); };
$('#nova-nota').onclick = () => abrirNota(null, 'text');
$('#nova-lista').onclick = () => abrirNota(null, 'list');

// Ordem manual (arrastar) fica na tabela lists, chave 'ordem_notas'.
// Notas fora da ordem (novas) aparecem primeiro, mais recentes no topo.
const ordemNotas = () => estado.listas.ordem_notas || [];
function porOrdem(a, b) {
  const o = ordemNotas(), ia = o.indexOf(a.id), ib = o.indexOf(b.id);
  if (ia < 0 || ib < 0) return (ia >= 0) - (ib >= 0) || (b.updated_at || '').localeCompare(a.updated_at || '');
  return ia - ib;
}
let timerOrdem;
function salvarOrdem() {
  const vistos = [...document.querySelectorAll('#notas-fixadas .nota-card, #notas-outras .nota-card')].map(c => c.dataset.id);
  const items = [...vistos, ...ordemNotas().filter(id => !vistos.includes(id) && estado.anot[id])];
  estado.listas.ordem_notas = items;
  if (estado.leitor) return;
  clearTimeout(timerOrdem);
  timerOrdem = setTimeout(async () => {
    const { error } = await sb.from('lists').upsert({ user_id: estado.user.id, key: 'ordem_notas', items });
    if (error) console.error(error);
  }, 500);
}

// Seleção (toque longo) e ações em lote
function alternarSel(id) {
  notasUi.sel.has(id) ? notasUi.sel.delete(id) : notasUi.sel.add(id);
  renderNotas();
}
function emLote(fn) {
  for (const id of notasUi.sel) {
    const n = estado.anot[id];
    if (!n) continue;
    fn(n);
    n.updated_at = new Date().toISOString();
    enfileirar('notes', id, n);
  }
  notasUi.sel.clear(); renderNotas();
}
$('#sel-sair').onclick = () => { notasUi.sel.clear(); renderNotas(); };
$('#sel-fixar').onclick = () => {
  const todas = [...notasUi.sel].every(id => estado.anot[id]?.pinned);
  emLote(n => { n.pinned = !todas; if (n.pinned) n.archived = false; });
};
$('#sel-arquivar').onclick = () => emLote(n => { n.archived = !notasUi.arquivo; if (n.archived) n.pinned = false; });
$('#sel-apagar').onclick = async () => {
  const ids = [...notasUi.sel];
  if (!confirm(ids.length > 1 ? `Apagar ${ids.length} notas?` : 'Apagar esta nota?')) return;
  notasUi.sel.clear();
  for (const id of ids) apagarLocal(id);
  renderNotas();
  const { error } = await sb.from('notes').delete().in('id', ids);
  if (error) { status('erro ao apagar', true); console.error(error); }
};
function apagarLocal(id) {
  delete estado.anot[id];
  delete fila['notes|' + id];
  gravarLocal('fila_' + estado.user.id, fila);
}

// Toque: abre (ou alterna seleção). Toque longo: seleciona; segurar e mover: arrasta.
let toque = null, ignorarClique = false;
function iniciarToque(ev) {
  const c = ev.target.closest('.nota-card');
  if (!c || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  toque = { c, id: c.dataset.id, x: ev.clientX, y: ev.clientY, armado: false, fantasma: null };
  toque.timer = setTimeout(() => {
    if (!toque) return;
    toque.armado = true;
    navigator.vibrate?.(30);
    // Sem re-renderizar: o cartão sob o dedo precisa continuar no DOM
    notasUi.sel.add(toque.id);
    toque.c.classList.add('sel');
    barraSel();
  }, 450);
}
function moverToque(ev) {
  if (!toque) return;
  const dx = ev.clientX - toque.x, dy = ev.clientY - toque.y;
  if (!toque.armado) {
    if (Math.hypot(dx, dy) > 10) { clearTimeout(toque.timer); toque = null; }   // é rolagem
    return;
  }
  if (!toque.fantasma) {
    if (Math.hypot(dx, dy) < 8) return;
    const r = toque.c.getBoundingClientRect();
    toque.fantasma = toque.c.cloneNode(true);
    toque.fantasma.classList.add('nota-fantasma');
    Object.assign(toque.fantasma.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    toque.ox = r.left; toque.oy = r.top;
    document.body.appendChild(toque.fantasma);
    toque.c.classList.add('arrastando');
  }
  toque.fantasma.style.left = toque.ox + dx + 'px';
  toque.fantasma.style.top = toque.oy + dy + 'px';
  // Troca de lugar com o cartão sob o dedo (só dentro da mesma seção)
  const alvo = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nota-card');
  if (alvo && alvo !== toque.c && alvo.parentNode === toque.c.parentNode) {
    const irmaos = [...alvo.parentNode.children];
    alvo.parentNode.insertBefore(toque.c, irmaos.indexOf(toque.c) < irmaos.indexOf(alvo) ? alvo.nextSibling : alvo);
  }
  // Rola a tela perto das bordas
  if (ev.clientY < 70) scrollBy(0, -12); else if (ev.clientY > innerHeight - 70) scrollBy(0, 12);
}
function soltarToque() {
  if (!toque) return;
  clearTimeout(toque.timer);
  if (toque.armado) ignorarClique = true;
  if (toque.fantasma) {
    toque.fantasma.remove();
    toque.c.classList.remove('arrastando');
    notasUi.sel.clear();
    salvarOrdem(); renderNotas();
  }
  toque = null;
}
for (const id of ['#notas-fixadas', '#notas-outras']) {
  const el = $(id);
  el.addEventListener('pointerdown', iniciarToque);
  el.addEventListener('contextmenu', ev => ev.preventDefault());
  el.addEventListener('click', ev => {
    const c = ev.target.closest('.nota-card');
    if (!c) return;
    if (ignorarClique) { ignorarClique = false; return; }
    if (notasUi.sel.size) alternarSel(c.dataset.id);
    else abrirNota(estado.anot[c.dataset.id]);
  });
}
addEventListener('pointermove', moverToque);
addEventListener('pointerup', soltarToque);
addEventListener('pointercancel', soltarToque);
// Enquanto arrasta, a página não rola com o dedo
addEventListener('touchmove', ev => { if (toque?.armado) ev.preventDefault(); }, { passive: false });

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
  historico = [JSON.stringify(editando)]; posHist = 0;
  $('#ne-cores').hidden = $('#ne-menu').hidden = true;
  renderEditor();
  $('#editor-nota').hidden = false;
  history.pushState({ nota: true }, '');
  if (notaNova) (kind === 'list' ? $('#ne-itens input.ne-txt') : $('#ne-corpo')).focus();
}

function renderEditor() {
  const n = editando, lista = n.kind === 'list';
  $('#ne-corpo').hidden = lista;
  $('#ne-itens').hidden = !lista;
  $('#ne-fixar').classList.toggle('sel', n.pinned);
  $('#ne-fixar').setAttribute('aria-pressed', n.pinned);
  $('#ne-tipo').textContent = lista ? '≡' : '☑';
  $('#ne-tipo').setAttribute('aria-label', lista ? 'Virar texto' : 'Virar lista');
  $('#ne-arquivar').setAttribute('aria-label', n.archived ? 'Desarquivar' : 'Arquivar');
  $('#ne-arquivar').classList.toggle('sel', n.archived);
  $('#ne-mais').hidden = notaNova;
  $('.nota-editor').style.cssText = n.color ? `--nc:${n.color}` : '';
  $('#ne-desfazer').disabled = posHist <= 0;
  $('#ne-refazer').disabled = posHist >= historico.length - 1;
  $('#ne-editado').textContent = n.updated_at ? 'Editado ' + new Date(n.updated_at).toLocaleString('pt-BR',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  if (lista) {
    const linha = i => `<div class="ne-item ${i.done ? 'feito' : ''}" data-id="${i.id}">
        <input type="checkbox" class="ne-marca" ${i.done ? 'checked' : ''} aria-label="Marcar item">
        <input class="ne-txt" value="${esc(i.t)}" placeholder="Item">
        <button class="icone ne-tirar" aria-label="Remover item">×</button>
      </div>`;
    const abertos = n.items.filter(i => !i.done), feitos = n.items.filter(i => i.done);
    $('#ne-itens').innerHTML = abertos.map(linha).join('') +
      `<button class="link ne-add">+ Item da lista</button>` +
      (feitos.length ? `<div class="ne-sep">${feitos.length} ${feitos.length > 1 ? 'itens marcados' : 'item marcado'}</div>` + feitos.map(linha).join('') : '');
  }
}

// Desfazer/refazer: fotos da nota; digitação seguida vira um passo só
let historico = [], posHist = 0, ultimaFoto = 0;
function guardarFoto() {
  const foto = JSON.stringify({ ...editando, updated_at: undefined });
  if (foto === historico[posHist]) return;
  const agora = Date.now();
  historico = historico.slice(0, posHist + 1);
  if (agora - ultimaFoto < 800 && posHist > 0) historico[posHist] = foto;
  else { historico.push(foto); posHist++; }
  ultimaFoto = agora;
}
function irHist(passo) {
  const p = posHist + passo;
  if (p < 0 || p >= historico.length) return;
  posHist = p; ultimaFoto = 0;
  editando = { ...JSON.parse(historico[p]), updated_at: editando.updated_at };
  $('#ne-titulo').value = editando.title || '';
  $('#ne-corpo').value = editando.body || '';
  gravarNota(); renderEditor();
}

function salvarNota() {
  const n = editando;
  n.title = $('#ne-titulo').value;
  n.body = $('#ne-corpo').value;
  guardarFoto();
  gravarNota();
  $('#ne-desfazer').disabled = posHist <= 0;
  $('#ne-refazer').disabled = true;
}
function gravarNota() {
  const n = editando;
  if (notaNova && notaVazia(n)) return;
  notaNova = false;
  n.updated_at = new Date().toISOString();
  estado.anot[n.id] = JSON.parse(JSON.stringify(n));
  enfileirar('notes', n.id, estado.anot[n.id]);
  $('#ne-mais').hidden = false;
}

function fecharNota(peloVoltar) {
  if (!editando) return;
  if (peloVoltar !== true && history.state?.nota) setTimeout(() => history.back());
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
$('#ne-desfazer').onclick = () => irHist(-1);
$('#ne-refazer').onclick = () => irHist(1);
const CORES = [null, '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8'];
$('#ne-cor').onclick = () => {
  $('#ne-menu').hidden = true;
  $('#ne-cores').hidden = !$('#ne-cores').hidden;
  $('#ne-cores').innerHTML = CORES.map(c => `<button class="ne-cor ${c === (editando.color || null) ? 'sel' : ''}"
    data-cor="${c || ''}" ${c ? `style="--c:${c}"` : ''} aria-label="${c ? 'Cor' : 'Sem cor'}">${c ? '' : '⊘'}</button>`).join('');
};
$('#ne-cores').addEventListener('click', ev => {
  const b = ev.target.closest('.ne-cor');
  if (!b) return;
  editando.color = b.dataset.cor || null;
  $('#ne-cores').hidden = true;
  salvarNota(); renderEditor();
});
$('#ne-mais').onclick = () => { $('#ne-cores').hidden = true; $('#ne-menu').hidden = !$('#ne-menu').hidden; };
$('#ne-copiar').onclick = () => {
  salvarNota();
  const copia = { ...JSON.parse(JSON.stringify(editando)), id: crypto.randomUUID(), pinned: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  copia.items.forEach(i => { i.id = crypto.randomUUID(); });
  estado.anot[copia.id] = copia;
  enfileirar('notes', copia.id, copia);
  fecharNota();
};
$('#ne-arquivar').onclick = () => {
  if (notaNova && notaVazia(editando)) return fecharNota();
  editando.archived = !editando.archived; if (editando.archived) editando.pinned = false; fecharNota();
};
$('#ne-apagar').onclick = async () => {
  if (!confirm('Apagar esta nota?')) return;
  const id = editando.id;
  apagarLocal(id);
  $('#editor-nota').hidden = true; editando = null; renderNotas();
  if (history.state?.nota) history.back();
  const { error } = await sb.from('notes').delete().eq('id', id);
  if (error) { status('erro ao apagar', true); console.error(error); }
};

// Itens da lista
const itemDe = el => editando.items.find(i => i.id === el.closest('.ne-item').dataset.id);
$('#ne-itens').addEventListener('input', ev => {
  if (ev.target.classList.contains('ne-txt')) { itemDe(ev.target).t = ev.target.value; salvarNota(); sugerir(ev.target); }
});

// Sugestão: ao digitar algo que já está na lista, oferece reaproveitar o item (sem duplicar)
function sugerir(campo) {
  document.querySelector('.ne-sug')?.remove();
  const q = semAcento(campo.value.trim()), atual = itemDe(campo);
  if (!q) return;
  const achados = editando.items.filter(i => i !== atual && i.t.trim() && semAcento(i.t).includes(q)).slice(0, 5);
  if (!achados.length) return;
  campo.closest('.ne-item').insertAdjacentHTML('beforeend', `<div class="ne-sug">${achados.map(i =>
    `<button data-id="${i.id}">${i.done ? '☑' : '☐'} ${esc(i.t)}</button>`).join('')}</div>`);
}
$('#ne-itens').addEventListener('pointerdown', ev => {
  const b = ev.target.closest('.ne-sug button');
  if (!b) return;
  ev.preventDefault();
  const atual = itemDe(b), achado = editando.items.find(i => i.id === b.dataset.id);
  achado.done = false;
  const lista = editando.items.filter(i => i !== achado);
  lista.splice(lista.indexOf(atual), 1, achado);   // o item reaproveitado ocupa o lugar do que estava sendo digitado
  editando.items = lista;
  renderEditor(); salvarNota();
});
$('#ne-itens').addEventListener('focusout', () => setTimeout(() => {
  if (!$('#ne-itens').contains(document.activeElement)) document.querySelector('.ne-sug')?.remove();
}));
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

// Gesto "voltar" do Android (deslizar da borda): fecha a nota em vez de sair do app
addEventListener('popstate', () => { if (editando) fecharNota(true); });
