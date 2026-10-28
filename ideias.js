// =====================================================================
// ideias.js — tela Ideias: coisas para fazer um dia e de onde vieram
// =====================================================================
const fmtIdeia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });

// Como no Keep: pendentes em cima; concluídas embaixo, numa seção recolhível
let verConcluidas = lerLocal('ver_concluidas', false);

const nomeTipo = v => $(`#ideia-tipo option[value="${v}"]`)?.textContent || v;

function cartaoIdeia(i) {
  return `
    <div class="ideia ${i.done ? 'feita' : ''}" data-id="${i.id}">
      <input type="checkbox" class="marcar" ${i.done ? 'checked' : ''} aria-label="Marcar como feita">
      <div class="ideia-txt">
        <strong>${esc(i.text)}</strong>
        <span class="det">${i.source ? 'via ' + esc(i.source) + ' · ' : ''}${fmtIdeia.format(new Date(i.created_at))}${i.done && i.kind ? ` <span class="ideia-tipo">${esc(nomeTipo(i.kind))}</span>` : ''}</span>
      </div>
      <button class="icone apagar" aria-label="Apagar ideia">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`;
}

function renderIdeias() {
  const lista = Object.values(estado.ideias).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const fontes = [...new Set(lista.map(i => i.source).filter(Boolean))].sort();
  $('#fontes-ideia').innerHTML = fontes.map(f => `<option value="${esc(f)}">`).join('');
  $('#ideias-vazio').hidden = true;  // a grade de tipos já aparece vazia
  const pendentes = lista.filter(i => !i.done), feitas = lista.filter(i => i.done);
  // Um card por tipo (o tipo faz o papel da primeira palavra da ideia); cada card rola sozinho
  const tipos = [...$('#ideia-tipo').options].slice(1).map(o => [o.value, o.textContent]);
  const grupos = [...tipos, ['', 'Outras']].map(([v, nome]) => [nome, pendentes.filter(i => (i.kind || '') === v || (!v && !tipos.some(t => t[0] === i.kind)))])
    .filter(([nome, itens]) => nome !== 'Outras' || itens.length);  // os 8 tipos sempre aparecem
  $('#lista-ideias').innerHTML = '<div class="grade-ideias">' + grupos.map(([nome, itens]) => `
    <section class="grupo-ideias">
      <h3>${esc(nome)} <span>${itens.length}</span></h3>
      <div class="grupo-lista">${itens.map(cartaoIdeia).join('') || '<p class="dica">—</p>'}</div>
    </section>`).join('') + '</div>' + (!feitas.length ? '' : `
    <button class="link concluidas-topo" aria-expanded="${verConcluidas}">${verConcluidas ? '▾' : '▸'} ${feitas.length} concluída${feitas.length > 1 ? 's' : ''}</button>
    ${verConcluidas ? feitas.map(cartaoIdeia).join('') : ''}`);
}

$('#lista-ideias').addEventListener('change', ev => {
  if (!ev.target.classList.contains('marcar')) return;
  const i = estado.ideias[ev.target.closest('.ideia').dataset.id];
  i.done = ev.target.checked;
  enfileirar('ideas', i.id, i);
  renderIdeias();
});

$('#form-ideia').onsubmit = ev => {
  ev.preventDefault();
  const texto = $('#ideia-texto').value.trim();
  if (!texto) return;
  const agora = new Date().toISOString();
  const linha = { id: crypto.randomUUID(), text: texto, source: $('#ideia-fonte').value.trim() || null, kind: $('#ideia-tipo').value || null, done: false, created_at: agora };
  estado.ideias[linha.id] = linha;
  enfileirar('ideas', linha.id, linha);
  $('#form-ideia').reset();
  $('#ideia-texto').focus();
  renderIdeias();
};

$('#lista-ideias').addEventListener('click', async ev => {
  if (ev.target.closest('.concluidas-topo')) {
    verConcluidas = !verConcluidas; gravarLocal('ver_concluidas', verConcluidas); renderIdeias(); return;
  }
  const b = ev.target.closest('.apagar');
  if (!b) return;
  const id = b.closest('.ideia').dataset.id;
  if (!confirm('Apagar esta ideia?')) return;
  delete estado.ideias[id];
  delete fila['ideas|' + id];
  gravarLocal('fila_' + estado.user.id, fila);
  renderIdeias();
  const { error } = await sb.from('ideas').delete().eq('id', id);
  if (error) { status('erro ao apagar', true); console.error(error); }
});
