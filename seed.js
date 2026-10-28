// =====================================================================
// seed.js — metas padrão e dados iniciais, gravados no seu usuário no
// primeiro login (só quando você ainda não tem nenhuma meta).
// "csv" = nome da coluna correspondente no CSV de importação.
// =====================================================================
(function (raiz) {
  const SEED = {
    metas: [
      { csv: 'leitura',  name: 'Leitura',  question: 'Páginas lidas', kind: 'numeric', unit: 'páginas',  step: 1,    target: 10, weekdays: [1,2,3,4,5],     pct_mode: 'sum' },
      { csv: 'frutas',   name: 'Frutas',   question: 'Frutas',        kind: 'numeric', unit: 'unidades', step: 1,    target: 2,  weekdays: [0,1,2,3,4,5,6], pct_mode: 'days' },
      { csv: 'agua',     name: 'Água',     question: 'Água',          kind: 'numeric', unit: 'litros',   step: 0.5, target: 3,  weekdays: [0,1,2,3,4,5,6], pct_mode: 'days' },
      { csv: 'reflexao', name: 'Reflexão', question: 'Reflexão',      kind: 'numeric', unit: 'minutos',  step: 5,    target: 20, weekdays: [1,2,3,4,5],     pct_mode: 'days' },
      { csv: 'organizacao', name: 'Organizar a semana', question: 'Organizei a semana?', kind: 'boolean', success_value: true,  weekdays: [0], pct_mode: 'days' },
      { csv: 'roi_unhas',   name: 'Não roer unhas',     question: 'Roí unhas?',          kind: 'boolean', success_value: false, default_value: false, feeling_on: true, weekdays: [0,1,2,3,4,5,6], pct_mode: 'answered' }
    ],
    sentimentos: ['Estresse', 'Ansiedade', 'Tédio', 'Cansaço', 'Concentração', 'Tranquilo', 'Outro'],
    csv:
`data;leitura;frutas;agua;reflexao;organizacao;roi_unhas;sentimento;obs
2026-10-18;8;;1;20;Sim;Não;;
2026-10-19;15;1;4;20;;Não;;
2026-10-20;4;2;3;20;;Não;;
2026-10-21;16;2;3;20;;Não;;
2026-10-22;20;2;3;20;;Não;;
2026-10-23;6;3;2;20;;Sim;Ansiedade;Fiquei abalado com o fato de ter visto o horário da carona errado. Acho que o que mais me desesperou foi ter já falado pra Laura um horário e ele estar errado.
2026-10-24;;0;2;;;Não;;
2026-10-25;;1;0.7;;Sim;Não;;Sim e não. Organizei finanças, não a semana.
2026-10-26;7;;1.5;0;;Não;;Dormi pouco, mal e tava ansioso.`
  };

  // Converte o CSV (separador ;) em linhas de entries/day_notes.
  // metasPorCsv: { leitura: {id, kind, ...}, ... }. Campo vazio = não registrado.
  function csvParaLinhas(texto, metasPorCsv) {
    const linhas = texto.trim().split(/\r?\n/);
    const cab = linhas.shift().split(';').map(s => s.trim().toLowerCase());
    const regs = linhas.map(l => {
      const cols = l.split(';');
      const reg = {}; cab.forEach((c, i) => reg[c] = (cols[i] ?? '').trim());
      // Se obs é a última coluna, ela pode conter ";" — junta o resto da linha
      if (cab[cab.length - 1] === 'obs') reg.obs = cols.slice(cab.length - 1).join(';').trim();
      return reg;
    });
    return regsParaLinhas(regs, metasPorCsv);
  }

  // Mesma conversão a partir de registros já separados ({ data, <coluna>: valor, sentimento, obs }),
  // usada também na aba Registros do backup em Excel
  function regsParaLinhas(regs, metasPorCsv) {
    const entries = [], notas = [];
    for (const reg of regs) {
      const dia = reg.data;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
      for (const [col, meta] of Object.entries(metasPorCsv)) {
        const v = reg[col];
        if (v == null || v === '') continue;
        const e = { goal_id: meta.id, day: dia, num_value: null, bool_value: null, feeling: null };
        if (meta.kind === 'numeric') e.num_value = Number(v.replace(',', '.'));
        else e.bool_value = /^s/i.test(v);
        if (meta.feeling_on != null && e.bool_value === meta.feeling_on && reg.sentimento) e.feeling = reg.sentimento;
        entries.push(e);
      }
      if (reg.obs) notas.push({ day: dia, obs: reg.obs });
    }
    return { entries, notas };
  }

  const exp = { SEED, csvParaLinhas, regsParaLinhas };
  if (typeof module !== 'undefined') module.exports = exp; else Object.assign(raiz, exp);
})(this);
