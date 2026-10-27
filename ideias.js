// =====================================================================
// ideias.js — tela Ideias: coisas para fazer um dia e de onde vieram
// =====================================================================
const fmtIdeia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });

function renderIdeias() {
  const lista = Object.values(estado.ideias).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const fontes = [...new Set(lista.map(i => i.source).filter(Boolean))].sort();
  $('#fontes-ideia').innerHTML = fontes.map(f => `<option value="${esc(f)}">`).join('');
  $('#ideias-vazio').hidden = lista.length > 0;
  $('#lista-ideias').innerHTML = lista.map(i => `
    <div class="ideia" data-id="${i.id}">
      <div class="ideia-txt">
        <strong>${esc(i.text)}</strong>
        <span class="det">${i.source ? 'via ' + esc(i.source) + ' · ' : ''}${fmtIdeia.format(new Date(i.created_at))}</span>
      </div>
      <button class="icone apagar" aria-label="Apagar ideia">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`).join('');
}

$('#form-ideia').onsubmit = ev => {
  ev.preventDefault();
  const texto = $('#ideia-texto').value.trim();
  if (!texto) return;
  const agora = new Date().toISOString();
  const linha = { id: crypto.randomUUID(), text: texto, source: $('#ideia-fonte').value.trim() || null, created_at: agora };
  estado.ideias[linha.id] = linha;
  enfileirar('ideas', linha.id, linha);
  $('#form-ideia').reset();
  $('#ideia-texto').focus();
  renderIdeias();
};

$('#lista-ideias').addEventListener('click', async ev => {
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
