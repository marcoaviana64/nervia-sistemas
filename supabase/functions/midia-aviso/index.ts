// Mídia Indoor 2.6: aviso por e-mail antes de acabarem os dias de uso das TVs.
//   Etapas por TV: 7, 3 e 1 dia(s) antes (faltam = dias que sobram, contando hoje), 0 = os dias acabaram (ainda passa,
//   na tolerância) e -1 = a TV pausou. Cada etapa vai uma vez por TV e por "válida até".
// Chamada uma vez por dia pelo pg_cron "midia-avisos" (cabeçalho x-cron-secret) ou pela equipe Nervia.
// O que avisar vem do banco (mi_avisos_pendentes); UM e-mail por destinatário e conta; registro em email_envios (midia_dias).
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { configEmail, enviarEmail, escHtml, modelo, registrarEnvio } from "../_shared/email.ts";

export interface TelaAviso { tela_id: string; tela: string; valida_ate: string; faltam: number; etapa: number; pausa_em: string }
export interface ContaAviso { conta_id: string; conta: string; tolerancia: number; emails: string[]; telas: TelaAviso[] }
export interface Email { para: string; assunto: string; html: string }

export const LINK_MIDIA = "https://nervia.com.br/cliente/#app/midia";
export const CONTATO = "atendimento@nervia.com.br ou WhatsApp (21) 96686-9374";
const dia = (d: string) => d.split("-").reverse().join("/");
const dias = (n: number) => `${n} dia${n === 1 ? "" : "s"}`;

/** Situação de uma TV em uma frase (exportado para os testes). */
export function frase(t: TelaAviso): string {
  if (t.etapa === -1) return `pausada desde ${dia(t.pausa_em)}: mostra a tela de espera da Nervia até receber mais dias`;
  if (t.etapa === 0) return `os dias de uso acabaram em ${dia(t.valida_ate)}; a TV continua passando até ${dia(somaDia(t.pausa_em, -1))} e pausa em ${dia(t.pausa_em)}`;
  if (t.faltam <= 1) return `hoje é o último dia de uso (válida até ${dia(t.valida_ate)})`;
  return `faltam ${dias(t.faltam)} de uso (válida até ${dia(t.valida_ate)})`;
}
const somaDia = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** E-mails de uma conta (um por destinatário). */
export function montar(c: ContaAviso): Email[] {
  const pior = Math.min(...c.telas.map((t) => t.etapa));
  const pausadas = c.telas.filter((t) => t.etapa === -1).length;
  const nome = c.telas.length === 1 ? `da TV "${c.telas[0].tela}"` : `de ${c.telas.length} TVs`;
  const assunto = pior === -1
    ? (pausadas === c.telas.length ? `🔴 Mídia Indoor: ${c.telas.length === 1 ? `TV "${c.telas[0].tela}" pausada` : `${pausadas} TVs pausadas`} (${c.conta})`
                                   : `🔴 Mídia Indoor: dias de uso ${nome} (${c.conta})`)
    : pior === 0 ? `⚠️ Mídia Indoor: acabaram os dias de uso ${nome} (${c.conta})`
    : c.telas.length === 1 ? `Mídia Indoor: dias de uso da TV "${c.telas[0].tela}" terminam em ${dia(c.telas[0].valida_ate)} (${c.conta})`
    : `Mídia Indoor: dias de uso de ${c.telas.length} TVs terminando (${c.conta})`;
  const linhas = c.telas.map((t) => `<tr><td style="padding:8px 0;border-top:1px solid #E1E8EC;font-size:14px">
      <b>${escHtml(t.tela)}</b><br><span style="color:${t.etapa <= 0 ? "#b3261e" : "#4f5f73"};font-size:13px">${escHtml(frase(t))}</span></td></tr>`).join("");
  const corpo = `<p>Mídia Indoor de <b>${escHtml(c.conta)}</b>: situação dos dias de uso das TVs.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">${linhas}</table>
    <p>Cada TV tem os seus dias de uso. Quando eles acabam, a TV continua passando por ${dias(c.tolerancia)} e depois pausa,
    mostrando a tela de espera da Nervia até receber mais dias. Para renovar, fale com a Nervia: ${CONTATO}.</p>`;
  return c.emails.map((para) => ({ para, assunto, html: modelo(pior === -1 ? "TV pausada" : "Dias de uso das TVs", corpo,
    { texto: "Abrir o Mídia Indoor", link: LINK_MIDIA },
    "Aviso automático do Mídia Indoor da Plataforma Nervia, enviado 7, 3 e 1 dia antes de acabarem os dias de uso de cada TV.") }));
}

if (import.meta.main) {
  const sb = admin();
  servir(async (_req, quem) => {
    if (quem.tipo !== "cron" && quem.tipo !== "admin") return erro("Acesso negado", 401);
    const cfg = configEmail();
    if (!cfg) return erro("E-mail não configurado (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, EMAIL_REMETENTE).", 409);
    const { data, error } = await sb.rpc("mi_avisos_pendentes");
    if (error) return erro(`mi_avisos_pendentes: ${error.message}`, 500);
    const contas = (data ?? []) as ContaAviso[];
    let enviados = 0, falhas = 0;
    for (const c of contas) {
      let algum = !c.emails.length;   // sem destinatário: marca assim mesmo, para não repetir todo dia
      for (const m of montar(c)) {
        const det = { conta_id: c.conta_id, conta: c.conta, telas: c.telas.map((t) => ({ tela: t.tela, valida_ate: t.valida_ate, etapa: t.etapa })) };
        try {
          await enviarEmail({ ...m, responderPara: "atendimento@nervia.com.br" }, fetch, cfg);
          enviados++; algum = true;
          await registrarEnvio(sb, { tipo: "midia_dias", para: m.para, assunto: m.assunto, ok: true, detalhes: det });
        } catch (e) {
          falhas++;
          await registrarEnvio(sb, { tipo: "midia_dias", para: m.para, assunto: m.assunto, ok: false, erro: (e as Error).message, detalhes: det });
        }
      }
      if (algum) for (const t of c.telas) await sb.rpc("mi_cred_aviso_marcar", { p_tela: t.tela_id, p_valida: t.valida_ate, p_etapa: t.etapa });
    }
    return json({ ok: falhas === 0, contas: contas.length, enviados, falhas });
  }, { permiteCron: true });
}
