// Buscador de NF: avisos por e-mail (Buscador 1.9).
//   * Resumo diário das notas novas (só para quem ligou o resumo; só nos dias com nota nova).
//   * Certificado A1 vencendo (30, 15, 7, 1 dia(s) antes e no dia em que vence).
// Chamada uma vez por dia pelo pg_cron "nf-avisos" (cabeçalho x-cron-secret) ou pela equipe Nervia.
// O que avisar vem do banco (nf_avisos_pendentes); registro em email_envios (nf_resumo / nf_certificado).
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { configEmail, enviarEmail, escHtml, modelo, registrarEnvio } from "../_shared/email.ts";

export interface NotaResumo {
  empresa: string; cnpj: string; tipo: "NFE" | "NFSE"; papel: "recebida" | "emitida"; numero: string | null;
  data_emissao: string | null; valor: number | string | null; situacao: string; completo: boolean; parte: string | null;
}
export interface Total { empresa: string; cnpj: string; papel: "recebida" | "emitida"; qtd: number; valor: number | string | null }
export interface Resumo { user_id: string; email: string; nome: string; desde: string; total: number; notas: NotaResumo[]; totais: Total[] }
export interface Certificado { cnpj: string; empresa: string; validade: string; titular: string | null; faltam: number; etapa: number; emails: string[] }
export interface Pendentes { agora: string; resumos: Resumo[]; certificados: Certificado[] }
export interface Email { para: string; assunto: string; html: string }

export const LINK_BUSCADOR = "https://nervia.com.br/cliente/#app/notas";
export const LINK_PAINEL = "https://nervia.com.br/cliente/#app/painel-nf";
const TZ = "America/Sao_Paulo";
const MAX_LINHAS = 40;
const brl = (v: unknown) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (v: string | null) => v ? new Date(v).toLocaleDateString("pt-BR", { timeZone: TZ }) : "";
const cnpjFmt = (c: string) => c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

/** E-mail do resumo diário de um login (exportado para os testes). */
export function montarResumo(r: Resumo): Email {
  const rec = r.totais.filter((t) => t.papel === "recebida").reduce((s, t) => s + t.qtd, 0);
  const emi = r.totais.filter((t) => t.papel === "emitida").reduce((s, t) => s + t.qtd, 0);
  const partes = [rec ? plural(rec, "recebida", "recebidas") : "", emi ? plural(emi, "emitida", "emitidas") : ""].filter(Boolean);
  const assunto = `Notas fiscais: ${plural(r.total, "nota nova", "notas novas")} (${partes.join(", ")})`;

  const totais = `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px">
    <tr style="color:#4f5f73;text-align:left"><th style="padding:6px 0">Empresa</th><th>Notas</th><th style="text-align:right">Valor</th></tr>
    ${r.totais.map((t) => `<tr><td style="padding:6px 0;border-top:1px solid #E1E8EC">${escHtml(t.empresa)}<br><span style="color:#667;font-size:12px">${cnpjFmt(t.cnpj)}</span></td>
      <td style="border-top:1px solid #E1E8EC">${plural(t.qtd, t.papel === "emitida" ? "emitida" : "recebida", t.papel === "emitida" ? "emitidas" : "recebidas")}</td>
      <td style="border-top:1px solid #E1E8EC;text-align:right">${brl(t.valor)}</td></tr>`).join("")}</table>`;

  const linhas = r.notas.slice(0, MAX_LINHAS).map((n) => {
    const tipo = n.tipo === "NFE" ? "NF-e" : "NFS-e";
    const obs = [n.situacao === "Cancelada" ? "cancelada" : "", n.tipo === "NFE" && n.papel === "recebida" && !n.completo ? "só resumo: falta a ciência" : ""].filter(Boolean).join(" · ");
    return `<tr><td style="padding:7px 0;border-top:1px solid #E1E8EC;font-size:13px">
      <b>${escHtml(n.parte || "(sem nome)")}</b><br>
      <span style="color:#4f5f73">${tipo} ${n.numero ? "nº " + escHtml(n.numero) : ""} · ${n.papel === "emitida" ? "emitida por" : "para"} ${escHtml(n.empresa)} · ${dia(n.data_emissao)}${obs ? ` · <span style="color:#b3261e">${escHtml(obs)}</span>` : ""}</span></td>
      <td style="border-top:1px solid #E1E8EC;text-align:right;font-size:13px;white-space:nowrap">${brl(n.valor)}</td></tr>`;
  }).join("");
  const resto = r.total - Math.min(r.notas.length, MAX_LINHAS);
  const corpo = `<p>${r.nome ? `Olá, ${escHtml(r.nome.split(" ")[0])}. ` : ""}Chegaram ${plural(r.total, "nota nova", "notas novas")} no Buscador de NF desde o último resumo.</p>
    ${totais}<table style="width:100%;border-collapse:collapse">${linhas}</table>
    ${resto > 0 ? `<p style="font-size:13px;color:#4f5f73">E mais ${plural(resto, "nota", "notas")}: veja todas no Buscador.</p>` : ""}
    <p style="font-size:13px;color:#4f5f73;margin-top:14px">Valores das notas canceladas ficam fora do total. Para ver gráficos e comparações, abra o <a href="${LINK_PAINEL}" style="color:#107D9A">Painel de Notas</a>.</p>`;
  return { para: r.email, assunto, html: modelo("Notas fiscais novas", corpo, { texto: "Abrir o Buscador de NF", link: LINK_BUSCADOR },
    "Resumo diário do Buscador de NF da Plataforma Nervia. Para parar de receber, desmarque \"Resumo diário\" em Avisos por e-mail, no Buscador.") };
}

/** E-mails do aviso de certificado (um por destinatário da empresa). */
export function montarCertificado(c: Certificado): Email[] {
  const venceu = c.faltam <= 0;
  const quando = venceu ? "venceu" : c.faltam === 1 ? "vence amanhã" : `vence em ${c.faltam} dias`;
  const assunto = `${venceu ? "🔴" : "⚠️"} Certificado A1 de ${c.empresa} ${quando} (${dia(c.validade)})`;
  const corpo = `<p>O certificado digital A1 de <b>${escHtml(c.empresa)}</b> (${cnpjFmt(c.cnpj)}) ${quando}: válido até <b>${dia(c.validade)}</b>.</p>
    ${c.titular ? `<p style="color:#4f5f73;font-size:13px">Titular: ${escHtml(c.titular)}</p>` : ""}
    <p>${venceu ? "Sem o certificado válido, o Buscador para de baixar as notas desta empresa." : "Quando ele vencer, o Buscador para de baixar as notas desta empresa."}
    Renove o certificado com a sua certificadora e fale com a Nervia (atendimento@nervia.com.br ou WhatsApp (21) 96686-9374) para cadastrar o certificado novo.</p>`;
  return c.emails.map((para) => ({ para, assunto, html: modelo(venceu ? "Certificado A1 vencido" : "Certificado A1 perto de vencer", corpo,
    { texto: "Abrir o Buscador de NF", link: LINK_BUSCADOR },
    "Aviso automático do Buscador de NF da Plataforma Nervia. Para parar de receber, desmarque \"Certificado vencendo\" em Avisos por e-mail, no Buscador.") }));
}

if (import.meta.main) {
  const sb = admin();
  servir(async (_req, quem) => {
    if (quem.tipo !== "cron" && quem.tipo !== "admin") return erro("Acesso negado", 401);
    const cfg = configEmail();
    if (!cfg) return erro("E-mail não configurado (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, EMAIL_REMETENTE).", 409);
    const { data, error } = await sb.rpc("nf_avisos_pendentes");
    if (error) return erro(`nf_avisos_pendentes: ${error.message}`, 500);
    const p = data as Pendentes;
    let enviados = 0, falhas = 0;
    const mandar = async (tipo: string, m: Email, det: Record<string, unknown>) => {
      try {
        await enviarEmail({ ...m, responderPara: "atendimento@nervia.com.br" }, fetch, cfg);
        enviados++;
        await registrarEnvio(sb, { tipo, para: m.para, assunto: m.assunto, ok: true, detalhes: det });
        return true;
      } catch (e) {
        falhas++;
        await registrarEnvio(sb, { tipo, para: m.para, assunto: m.assunto, ok: false, erro: (e as Error).message, detalhes: det });
        return false;
      }
    };
    for (const r of p.resumos) {
      const ok = await mandar("nf_resumo", montarResumo(r), { notas: r.total, desde: r.desde, ate: p.agora });
      if (ok) await sb.rpc("nf_resumo_marcar", { p_user: r.user_id, p_ate: p.agora });
    }
    for (const c of p.certificados) {
      let algum = !c.emails.length;   // sem destinatário: marca assim mesmo, para não repetir todo dia
      for (const m of montarCertificado(c)) if (await mandar("nf_certificado", m, { cnpj: c.cnpj, validade: c.validade, etapa: c.etapa })) algum = true;
      if (algum) await sb.rpc("nf_cert_aviso_marcar", { p_cnpj: c.cnpj, p_validade: c.validade, p_dias: c.etapa });
    }
    return json({ ok: falhas === 0, resumos: p.resumos.length, certificados: p.certificados.length, enviados, falhas });
  }, { permiteCron: true });
}
