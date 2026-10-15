/* Auditoria de Telefonia Móvel (Nervia) — leitura das exportações do portal Claro Empresas.
   ProcessarTelefonia.processar(arquivos, cicloInicio) → { dados, linhas, resumo }
   arquivos = [{ nome, texto, modificado }]: os CSV "Relatorio-Dados", "Relatorio-Chamadas" e "Relatorio-Assinante"
   (pode misturar exportações de datas diferentes; as antigas e as novas se completam).
   Regras (as mesmas do gerar_dados.py usado na primeira versão):
   - Dados: o dia da exportação vem parcial, então cada data usa só a exportação mais recente que a contém;
     linhas idênticas são contadas uma vez.
   - Chamadas: são registros individuais; duplicados entre arquivos são removidos.
   - Ciclo de faturamento: começa no dia cicloInicio e fecha na véspera, no mês seguinte. */
(function () {
  const GRUPO = { "Web": "web", "Facebook, Instagram e Twitter": "social", "WhatsApp": "whats", "Waze": "waze", "Roaming": "roam" };
  const UNID = { KB: 1 / 1024 / 1024, MB: 1 / 1024, GB: 1 };
  const r3 = v => Math.round(v * 1000) / 1000, r1 = v => Math.round(v * 10) / 10;

  function tipoDe(texto) {
    const t = texto.replace(/^﻿/, "").split(/\r?\n/, 1)[0].trim().toLowerCase();
    if (t.startsWith("relatorio-dados")) return "dados";
    if (t.startsWith("relatorio-chamadas")) return "chamadas";
    if (t.startsWith("relatorio-assinante")) return "assinante";
    return null;
  }
  // carimbo da exportação: Relatorio-Dados-20261015_162917030.csv → "20261015_162917030"
  function carimbo(a) {
    const m = /(\d{8}_\d{6,})/.exec(a.nome || "");
    return m ? m[1] : new Date(a.modificado || 0).toISOString().replace(/\D/g, "").slice(0, 8) + "_" + new Date(a.modificado || 0).toISOString().replace(/\D/g, "").slice(8, 17);
  }
  // linhas de dados: pula o título ("Relatorio-...") e o cabeçalho; separador ";"
  function linhas(texto) {
    return texto.replace(/^﻿/, "").split(/\r?\n/).slice(2).filter(l => l.trim()).map(l => l.split(";"));
  }
  function ciclo(iso, ci) {
    let [y, m, d] = iso.split("-").map(Number);
    if (d < ci) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  const add = (o, k1, k2, k3, v) => { o[k1] ??= {}; o[k1][k2] ??= {}; o[k1][k2][k3] = (o[k1][k2][k3] || 0) + v; };
  const arred = o => { for (const a of Object.values(o)) for (const b of Object.values(a)) for (const k in b) b[k] = r3(b[k]); return o; };

  function processar(arquivos, cicloInicio = 6) {
    const ci = +cicloInicio || 6;
    const grupos = { dados: [], chamadas: [], assinante: [] }, ignorados = [];
    for (const a of arquivos) {
      const t = tipoDe(a.texto);
      if (t) grupos[t].push({ ...a, exp: carimbo(a) }); else ignorados.push(a.nome);
    }
    if (!grupos.dados.length) throw new Error("Nenhum arquivo Relatorio-Dados encontrado entre os enviados.");

    // ---------------- dados (internet)
    const porData = new Map(); // data -> exportação mais recente que a contém
    const brutos = [];
    for (const a of grupos.dados) for (const c of linhas(a.texto)) {
      if (c.length < 7 || !/^\d{4}-\d{2}-\d{2}$/.test(c[2])) continue;
      brutos.push({ exp: a.exp, c });
      if (!porData.has(c[2]) || porData.get(c[2]) < a.exp) porData.set(c[2], a.exp);
    }
    const vistos = new Set(), reg = [];
    for (const { exp, c } of brutos) {
      if (porData.get(c[2]) !== exp) continue;
      const chave = c.slice(0, 7).join(";");
      if (vistos.has(chave)) continue; vistos.add(chave);
      const gb = parseFloat(c[3]) * (UNID[c[4].trim().toUpperCase()] ?? NaN);
      if (!isFinite(gb)) continue;
      reg.push({ n: c[1].trim(), data: c[2], gb, g: GRUPO[c[5].trim()] || "outros", pac: c[6].trim(), ciclo: ciclo(c[2], ci) });
    }
    if (!reg.length) throw new Error("Os arquivos de dados não têm registros de consumo.");
    const datas = reg.map(r => r.data).sort();
    const dados = { cicloInicio: ci, inicio: datas[0], fim: datas.at(-1), dataCycle: {}, daily: {}, roam: [], voice: {} };
    for (const r of reg) { add(dados.dataCycle, r.n, r.ciclo, r.g, r.gb); add(dados.daily, r.n, r.data, r.g, r.gb); }
    arred(dados.dataCycle); arred(dados.daily);
    const rg = new Map();
    for (const r of reg.filter(r => r.g === "roam")) {
      const k = [r.n, r.pac, r.ciclo].join("|");
      const o = rg.get(k) || { n: r.n, pac: r.pac, ciclo: r.ciclo, ini: r.data, fim: r.data, dias: new Set(), GB: 0 };
      if (r.data < o.ini) o.ini = r.data; if (r.data > o.fim) o.fim = r.data;
      o.dias.add(r.data); o.GB += r.gb; rg.set(k, o);
    }
    dados.roam = [...rg.values()].sort((a, b) => (a.n + a.pac + a.ciclo).localeCompare(b.n + b.pac + b.ciclo))
      .map(o => ({ n: o.n, pac: o.pac, ciclo: o.ciclo, ini: o.ini, fim: o.fim, dias: o.dias.size, GB: r3(o.GB) }));

    // ---------------- chamadas (voz)
    const vc = new Set(); let fimVoz = "";
    for (const a of grupos.chamadas) for (const c of linhas(a.texto)) {
      if (c.length < 8) continue;
      const chave = c.slice(0, 8).join(";");
      if (vc.has(chave)) continue; vc.add(chave);
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[3].trim()); if (!m) continue;
      const iso = `${m[3]}-${m[2]}-${m[1]}`; if (iso > fimVoz) fimVoz = iso;
      const [hh, mm, ss] = c[6].trim().split(":").map(Number);
      const min = ((hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0)) / 60;
      const tipo = c[7].trim().toLowerCase();
      const k = tipo.includes("recados") || c[0].trim() === c[5].trim() ? "cx" : tipo.includes("fixo") ? "fixo" : tipo.includes("especial") ? "x0800" : "movel";
      const n = c[1].trim(), cic = ciclo(iso, ci);
      dados.voice[n] ??= {}; dados.voice[n][cic] ??= {};
      const v = dados.voice[n][cic][k] ??= [0, 0]; v[0] += 1; v[1] += min;
    }
    for (const a of Object.values(dados.voice)) for (const b of Object.values(a)) for (const k in b) b[k][1] = r1(b[k][1]);
    if (fimVoz) dados.fimVoz = fimVoz;

    // ---------------- assinante (cadastro das linhas): usa a exportação mais recente
    const linhasCad = [];
    const ass = grupos.assinante.sort((a, b) => b.exp.localeCompare(a.exp))[0];
    let conta = "", perfil = "";
    if (ass) for (const c of linhas(ass.texto)) {
      if (c.length < 8) continue;
      const ofertas = c[5].split("|").map(s => s.trim()).filter(Boolean);
      const plano = ofertas[0] || "";
      const fr = +(/(\d+)\s*GB/i.exec(plano) || [])[1] || 0;
      const addn = [];
      for (const o of ofertas.slice(1)) {
        const gb = (/\+\s*(\d+)\s*GB/i.exec(o) || [])[1];
        if (/passaporte\s+am[eé]ricas/i.test(o)) addn.push(`Passaporte Américas ${gb || 5} GB`);
        else if (/passaporte\s+mundo/i.test(o)) addn.push(`Passaporte Mundo ${gb || 10} GB`);
        else if (o !== plano) addn.push(o);
      }
      conta = conta || c[2].trim(); perfil = perfil || c[6].trim();
      linhasCad.push({ n: c[1].trim(), dono: "", plano, fr, iccid: c[4].trim(), add: [...new Set(addn)], status: c[7].trim() });
    }
    // linhas que aparecem no consumo mas não no cadastro
    const conhecidas = new Set(linhasCad.map(l => l.n));
    for (const n of new Set([...Object.keys(dados.dataCycle), ...Object.keys(dados.voice)]))
      if (!conhecidas.has(n)) linhasCad.push({ n, dono: "", plano: "", fr: 0, iccid: "", add: [], status: "" });

    const exps = [...new Set([...grupos.dados, ...grupos.chamadas, ...grupos.assinante].map(a => a.exp.slice(0, 8)))].sort()
      .map(s => `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`);
    return {
      dados, linhas: linhasCad, conta, perfil, exportacoes: exps, ignorados,
      resumo: { dados: grupos.dados.length, chamadas: grupos.chamadas.length, assinante: grupos.assinante.length, registros: reg.length, ligacoes: vc.size },
    };
  }
  const api = { processar };
  if (typeof window !== "undefined") window.ProcessarTelefonia = api;
  if (typeof module !== "undefined") module.exports = api;
})();
