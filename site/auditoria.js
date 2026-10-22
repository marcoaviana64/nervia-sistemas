// Registro de auditoria da Plataforma Nervia: nomes das ações e resumo de cada registro.
// Usado pelo Buscador (por empresa), pela Administração da Área do Cliente e pelo comprovante.
(function () {
  const ROTULO = {
    manifestacao_ciencia: "Ciência da Operação (SEFAZ)",
    manifestacao_confirmacao: "Confirmação da Operação (SEFAZ)",
    manifestacao_ciencia_falhou: "Ciência da Operação — tentativa com erro",
    manifestacao_confirmacao_falhou: "Confirmação da Operação — tentativa com erro",
    certificado_cadastrado: "Certificado A1 cadastrado",
    termo_registrado: "Termo de custódia registrado",
    nfe_ligada: "Busca de NF-e ligada",
    nfe_desligada: "Busca de NF-e desligada",
    nfe_recuperacao_iniciada: "Recuperação de NF-e anteriores iniciada",
    busca_automatica_ligada: "Busca automática ligada",
    busca_automatica_desligada: "Busca automática desligada",
    empresa_cadastrada: "Empresa cadastrada",
    empresa_alterada: "Empresa alterada",
    empresa_desativada: "Empresa desativada",
    empresa_reativada: "Empresa reativada",
    acesso_empresa_liberado: "Acesso à empresa liberado",
    acesso_empresa_retirado: "Acesso à empresa retirado",
    acesso_app_liberado: "Acesso a aplicativo liberado",
    acesso_app_retirado: "Acesso a aplicativo retirado",
    login_criado: "Login criado",
    login_excluido: "Login excluído",
    login_alterado: "Nome ou e-mail do login alterado",
    senha_link_enviado: "Link de senha nova enviado por e-mail",
    email_teste: "E-mail de teste enviado",
    senha_redefinida: "Senha redefinida pela Nervia",
    admin_concedido: "Perfil de administrador concedido",
    admin_retirado: "Perfil de administrador retirado",
  };
  const SENSIVEL = new Set(["manifestacao_ciencia", "manifestacao_confirmacao", "certificado_cadastrado", "termo_registrado"]);
  const dataHora = (v) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const quem = (r) => r.papel === "sistema" ? "Sistema (automático)" : `${r.nome || r.email || "?"}${r.email && r.nome ? " · " + r.email : ""}${r.papel === "admin" ? " (Nervia)" : ""}`;
  function resumo(r) {
    const d = r.detalhes || {};
    if (r.acao.startsWith("manifestacao_")) {
      const notas = d.notas || [];
      const ok = notas.filter((n) => ["135", "136", "573"].includes(n.cStat)).length;
      return d.erro ? `Erro: ${d.erro}` : `${notas.length} nota(s), ${ok} registrada(s) na SEFAZ` + (d.ignoradas_fora_do_prazo ? ` · ${d.ignoradas_fora_do_prazo} fora do prazo` : "");
    }
    if (r.acao === "certificado_cadastrado") return `${d.titular || ""} · válido até ${d.validade ? new Date(d.validade).toLocaleDateString("pt-BR") : "?"}`;
    if (r.acao === "termo_registrado") return `${d.situacao_anterior || "?"} → ${d.situacao}${d.signatario ? " · assinado por " + d.signatario : ""}${d.assinado_em ? " em " + new Date(d.assinado_em + "T12:00").toLocaleDateString("pt-BR") : ""}`;
    if (d.login) return `Login ${d.login}${d.app ? " · app " + d.app : ""}${d.cnpjs && d.cnpjs.length ? " · empresas " + d.cnpjs.join(", ") : ""}`;
    if (r.acao === "nfe_desligada" && d.motivo) return d.motivo;
    if (r.acao === "empresa_alterada") return `${d.nome_anterior} → ${d.nome}`;
    return "";
  }
  window.NERVIA_AUDITORIA = { ROTULO, SENSIVEL, dataHora, quem, resumo, rotulo: (a) => ROTULO[a] || a };
})();
