window.__demo = (db) => {
  const C = "12345678000190";
  db.nf_empresas = [{ cnpj: C, nome: "Comercial Exemplo Ltda", uf: "RJ", ativo: true, busca_automatica: true, cert_secret_id: "s1",
    cert_titular: "COMERCIAL EXEMPLO LTDA:" + C, cert_validade: new Date(Date.now() + 200 * 864e5).toISOString(), termo_status: "assinado",
    ultima_sinc_nfe: new Date(Date.now() - 12 * 6e4).toISOString(), ultima_sinc_nfse: new Date(Date.now() - 12 * 6e4).toISOString() }];
  db.nf_acessos = [{ user_id: "u-cli", cnpj: C }];
  db.nf_log = [{ id: 1, cnpj: C, quando: new Date(Date.now() - 12 * 6e4).toISOString(), origem: "NFE", mensagem: "Tudo baixado. {\"nova\":3}" },
               { id: 2, cnpj: C, quando: new Date(Date.now() - 12 * 6e4).toISOString(), origem: "NFSE", mensagem: "Tudo baixado. {\"nova\":1}" }];
  const F = [ // tipo, cnpj, nome, base mensal, dia
    ["NFE", "21458963000112", "DISTRIBUIDORA ALFA EMBALAGENS LTDA", 6200, 4],
    ["NFE", "30987412000155", "TEXTIL HORIZONTE LTDA", 9800, 9],
    ["NFE", "45123698000140", "PAPELARIA PONTO CERTO ME", 640, 12],
    ["NFE", "52369874000121", "INFORMATICA SOLUCAO DIGITAL LTDA", 0, 18],
    ["NFSE", "61478523000108", "TRANSRAPIDO LOGISTICA LTDA", 2350, 6],
    ["NFSE", "73214569000133", "ESCRITORIO CONTABIL MODELO SS", 1450, 10],
    ["NFSE", "84569321000177", "FIBRA NET TELECOMUNICACOES LTDA", 389.9, 15],
    ["NFSE", "95874123000166", "MANUTENCAO PREDIAL ATIVA ME", 780, 21],
  ];
  let id = 1, num = 1000; db.nf_notas = [];
  const saz = [0.85, 1.25, 0.7, 0.8, 0.95, 0.9, 1.0, 0.92, 1.05, 1.1, 0.98, 1.15]; // nov/25..out/26
  for (let m = 0; m < 12; m++) {
    const ano = m < 2 ? 2025 : 2026, mes = m < 2 ? 11 + m : m - 1;
    for (const [t, ec, en, base, dia] of F) {
      let v = base; if (!v) { if (m !== 3 && m !== 9) continue; v = m === 3 ? 7450 : 3890; }
      if (t === "NFE") v = Math.round(v * saz[m] * (0.9 + ((m * 7 + dia) % 5) / 20) * 100) / 100;
      if (ano === 2026 && mes === 10 && dia > 14) continue;
      const d = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T10:00:00-03:00`;
      const recente = ano === 2026 && mes >= 9;
      const sit = (m === 7 && dia === 12) ? "Cancelada" : "Autorizada";
      const completo = !(ano === 2026 && mes === 10 && dia === 9);
      db.nf_notas.push({ id: id++, cnpj_consulta: C, tipo: t, chave: String(33260000000000 + id).padEnd(44, "7"), numero: String(num += 7), emit_cnpj: ec, emit_nome: en,
        dest_cnpj: C, dest_nome: "COMERCIAL EXEMPLO LTDA", data_emissao: d, valor: v, situacao: sit, papel: "recebida",
        completo, manifestada: false, xml_path: recente ? `${C}/x${id}.xml` : null });
    }
    // vendas
    for (const [cc, cn, b, dia] of [["11223344000155", "LOJA CENTRO VAREJO LTDA", 14200, 8], ["22334455000166", "MERCADO BOA VISTA LTDA", 8600, 16], ["33445566000177", "BOUTIQUE ESTILO ME", 3900, 25]]) {
      if (ano === 2026 && mes === 10 && dia > 14) continue;
      const d = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T10:00:00-03:00`;
      db.nf_notas.push({ id: id++, cnpj_consulta: C, tipo: "NFE", chave: String(33261000000000 + id).padEnd(44, "3"), numero: String(5000 + id), emit_cnpj: C, emit_nome: "COMERCIAL EXEMPLO LTDA",
        dest_cnpj: cc, dest_nome: cn, data_emissao: d, valor: Math.round(b * saz[m] * 100) / 100, situacao: "Autorizada", papel: "emitida", completo: true, manifestada: false, xml_path: null });
    }
  }
};
