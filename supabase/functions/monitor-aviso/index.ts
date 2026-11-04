// Monitor de Links: aviso por e-mail de queda e de volta (link caído ou roteador sem contato).
// Chamada pelo pg_cron "monitor-avisos" (cabeçalho x-cron-secret) só quando há aviso na fila (mon_avisos_tem).
// A fila e a regra (queda aberta há 5 min ou mais; depois, a volta) ficam no banco: mon_avisos_pendentes.
// Cada destinatário recebe UM e-mail com todos os avisos dele naquela rodada. Registro em email_envios.
import { admin } from "../_shared/banco.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { configEmail, enviarEmail, escHtml, modelo, registrarEnvio } from "../_shared/email.ts";

export interface Evento {
  queda_id: number; evento: "caiu" | "voltou"; tipo: "link" | "sem_contato"; inicio: string; fim: string | null;
  local_id: string; local: string; cliente: string; equipamento: string; link: string; operadora: string; emails: string[];
}
export interface Aviso { para: string; assunto: string; html: string; eventos: Evento[] }

export const LINK_MONITOR = "https://nervia.com.br/cliente/#app/monitor";
const TZ = "America/Sao_Paulo";
const hora = (v: string, comDia: boolean) =>
  new Date(v).toLocaleString("pt-BR", { timeZone: TZ, ...(comDia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" });
const mesmoDia = (a: string, b: string) =>
  new Date(a).toLocaleDateString("pt-BR", { timeZone: TZ }) === new Date(b).toLocaleDateString("pt-BR", { timeZone: TZ });

export function duracao(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

/** "Link via VPN Vogue (Claro)" ou "Roteador RB750" */
function oQue(e: Evento): string {
  return e.tipo === "sem_contato" ? `Roteador ${e.equipamento}` : `${e.link}${e.operadora ? ` (${e.operadora})` : ""}`;
}
function titulo(e: Evento): string {
  return e.evento === "caiu" ? (e.tipo === "sem_contato" ? "Sem contato" : "Caiu") : "Voltou";
}

function linha(e: Evento, agora: Date): string {
  const cor = e.evento === "caiu" ? "#b3261e" : "#1d7f46";
  const ini = hora(e.inicio, !mesmoDia(e.inicio, agora.toISOString()));
  const det = e.evento === "caiu"
    ? `desde ${ini} (há ${duracao((agora.getTime() - Date.parse(e.inicio)) / 6e4)})`
    : `ficou fora ${duracao((Date.parse(e.fim!) - Date.parse(e.inicio)) / 6e4)} — de ${ini} a ${hora(e.fim!, !mesmoDia(e.inicio, e.fim!))}`;
  const onde = [e.local, e.cliente && e.cliente !== e.local ? e.cliente : "", e.tipo === "link" ? e.equipamento : ""].filter(Boolean).join(" · ");
  return `<tr><td style="padding:10px 0;border-top:1px solid #E1E8EC">
    <span style="display:inline-block;background:${cor};color:#fff;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700">${escHtml(titulo(e))}</span>
    <b style="margin-left:6px">${escHtml(oQue(e))}</b><br>
    <span style="color:#4f5f73">${escHtml(onde)}</span><br><span>${escHtml(det)}</span></td></tr>`;
}

/** Junta os eventos por destinatário e monta um e-mail para cada um (exportado para os testes). */
export function montarAvisos(eventos: Evento[], agora = new Date()): Aviso[] {
  const por = new Map<string, Evento[]>();
  for (const e of eventos) for (const para of e.emails) por.set(para, [...(por.get(para) ?? []), e]);
  return [...por].map(([para, evs]) => {
    const caiu = evs.filter((e) => e.evento === "caiu").length, voltou = evs.length - caiu;
    const assunto = evs.length === 1
      ? `${evs[0].evento === "caiu" ? "🔴" : "🟢"} ${titulo(evs[0])}: ${oQue(evs[0])} — ${evs[0].local}`
      : `Monitor de Links: ${[caiu ? `${caiu} fora do ar` : "", voltou ? `${voltou} voltou${voltou > 1 ? "aram" : ""}` : ""].filter(Boolean).join(", ")}`;
    const cab = evs.length === 1 ? (evs[0].evento === "caiu" ? "Link fora do ar" : "Link de volta") : "Avisos do Monitor de Links";
    const corpo = `<table style="width:100%;border-collapse:collapse;font-size:15px">${evs.map((e) => linha(e, agora)).join("")}</table>
      <p style="font-size:13px;color:#4f5f73;margin-top:14px">Horários de Brasília. O aviso de queda sai quando ela passa de 5 minutos; quedas mais curtas aparecem só no painel.</p>`;
    return { para, assunto, html: modelo(cab, corpo, { texto: "Abrir o Monitor de Links", link: LINK_MONITOR },
      "Aviso automático do Monitor de Links da Plataforma Nervia. Para parar de receber, peça à Nervia (atendimento@nervia.com.br)."), eventos: evs };
  });
}

if (import.meta.main) {
  const sb = admin();
  servir(async (_req, quem) => {
    if (quem.tipo !== "cron" && quem.tipo !== "admin") return erro("Acesso negado", 401);
    const cfg = configEmail();
    if (!cfg) return erro("E-mail não configurado (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, EMAIL_REMETENTE).", 409);
    const { data, error } = await sb.rpc("mon_avisos_pendentes", { p_min: 5 });
    if (error) return erro(`mon_avisos_pendentes: ${error.message}`, 500);
    const eventos = (data ?? []) as Evento[];
    if (!eventos.length) return json({ ok: true, avisos: 0, enviados: 0 });

    const recebeu = new Set<number>();
    let enviados = 0, falhas = 0;
    for (const a of montarAvisos(eventos)) {
      const det = { quedas: a.eventos.map((e) => ({ id: e.queda_id, evento: e.evento, local: e.local, o_que: oQue(e) })) };
      try {
        await enviarEmail({ para: a.para, assunto: a.assunto, html: a.html, responderPara: "atendimento@nervia.com.br" }, fetch, cfg);
        a.eventos.forEach((e) => recebeu.add(e.queda_id));
        enviados++;
        await registrarEnvio(sb, { tipo: "monitor_aviso", para: a.para, assunto: a.assunto, ok: true, detalhes: det });
      } catch (e) {
        falhas++;
        await registrarEnvio(sb, { tipo: "monitor_aviso", para: a.para, assunto: a.assunto, ok: false, erro: (e as Error).message, detalhes: det });
      }
    }
    for (const ev of ["caiu", "voltou"] as const) {
      const doTipo = eventos.filter((e) => e.evento === ev);
      const ok = doTipo.filter((e) => recebeu.has(e.queda_id)).map((e) => e.queda_id);
      const nao = doTipo.filter((e) => !recebeu.has(e.queda_id)).map((e) => e.queda_id);
      if (ok.length) await sb.rpc("mon_aviso_marcar", { p_ids: ok, p_evento: ev, p_ok: true });
      if (nao.length) await sb.rpc("mon_aviso_marcar", { p_ids: nao, p_evento: ev, p_ok: false });
    }
    return json({ ok: falhas === 0, avisos: eventos.length, enviados, falhas });
  }, { permiteCron: true });
}
