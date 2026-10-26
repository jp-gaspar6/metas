// =====================================================================
// calc.js — datas e regras de cálculo de %. Não depende da interface,
// então também roda no Node para testes (node teste-calc.js).
// Datas são sempre strings 'AAAA-MM-DD' (dia local de São Paulo).
// =====================================================================
(function (raiz) {
  const FUSO = 'America/Sao_Paulo';

  // "Hoje" no fuso de São Paulo (evita o dia virar às 21h por causa do UTC)
  function hoje() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
  }
  // Trabalhamos as datas em UTC puro só para fazer contas de calendário
  function paraData(d) { const [a, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(a, m - 1, dd)); }
  function paraTexto(dt) { return dt.toISOString().slice(0, 10); }
  function somaDias(d, n) { const x = paraData(d); x.setUTCDate(x.getUTCDate() + n); return paraTexto(x); }
  function diaSemana(d) { return paraData(d).getUTCDay(); }           // 0=Dom ... 6=Sáb
  function inicioSemana(d) { return somaDias(d, -diaSemana(d)); }     // domingo
  function inicioMes(d) { return d.slice(0, 8) + '01'; }
  function fimMes(d) { const x = paraData(inicioMes(d)); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return paraTexto(x); }
  function listaDias(de, ate) { const r = []; for (let d = de; d <= ate; d = somaDias(d, 1)) r.push(d); return r; }

  // Valor efetivo de uma meta num dia. Numérica em branco = 0;
  // sim/não em branco = valor padrão da meta (ex.: unhas = "Não") ou nulo.
  function valor(meta, mapa, d) {
    const e = mapa[meta.id + '|' + d];
    if (meta.kind === 'numeric') {
      const v = e ? e.num_value : null;
      return v == null ? 0 : Number(v);
    }
    const v = e ? e.bool_value : null;
    return v == null ? (meta.default_value ?? null) : v;
  }
  function cumpriu(meta, v) {
    return meta.kind === 'numeric' ? v >= Number(meta.target) : v === meta.success_value;
  }

  // % de uma meta num período [de, ate], considerando só dias até hoje
  // e a partir do início da meta. Retorna null se nada conta ainda.
  function pctMeta(meta, mapa, de, ate, hojeStr) {
    const fim = ate < hojeStr ? ate : hojeStr;
    const ini = de > meta.start_date ? de : meta.start_date;
    if (fim < ini) return null;
    const dias = listaDias(ini, fim);
    const contam = dias.filter(d => meta.weekdays.includes(diaSemana(d)));
    const ok = contam.filter(d => cumpriu(meta, valor(meta, mapa, d))).length;

    if (meta.pct_mode === 'sum') {
      // Leitura: soma de TODOS os dias (fim de semana também) ÷ alvo × dias que contam
      if (!contam.length) return null;
      const soma = dias.reduce((s, d) => s + valor(meta, mapa, d), 0);
      const alvo = Number(meta.target) * contam.length;
      return { pct: Math.min(1, soma / alvo), soma, alvo, diasOk: ok, diasConta: contam.length };
    }
    if (meta.pct_mode === 'answered') {
      // Unhas: sucessos ÷ dias com resposta (branco sem padrão não conta)
      const resp = contam.filter(d => valor(meta, mapa, d) != null);
      if (!resp.length) return null;
      const okR = resp.filter(d => cumpriu(meta, valor(meta, mapa, d))).length;
      return { pct: okR / resp.length, diasOk: okR, diasConta: resp.length };
    }
    // Padrão: dias cumpridos ÷ dias em que a meta conta
    if (!contam.length) return null;
    return { pct: ok / contam.length, diasOk: ok, diasConta: contam.length };
  }

  // % de todas as metas + média geral (média simples das que têm valor)
  function resumo(metas, mapa, de, ate, hojeStr) {
    const porMeta = {};
    const vals = [];
    for (const m of metas) {
      const r = pctMeta(m, mapa, de, ate, hojeStr);
      porMeta[m.id] = r;
      if (r) vals.push(r.pct);
    }
    return { porMeta, media: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  }

  // Cor da planilha: verde = 100%, amarelo = 60–99%, vermelho < 60%
  function cor(p) {
    if (p == null) return '';
    if (p >= 0.9999) return 'verde';
    if (p >= 0.6) return 'amarelo';
    return 'vermelho';
  }
  function pctTexto(p) { return p == null ? '—' : Math.round(p * 100) + '%'; }

  const Calc = { FUSO, hoje, paraData, somaDias, diaSemana, inicioSemana, inicioMes, fimMes,
                 listaDias, valor, cumpriu, pctMeta, resumo, cor, pctTexto };
  if (typeof module !== 'undefined') module.exports = Calc; else raiz.Calc = Calc;
})(this);
