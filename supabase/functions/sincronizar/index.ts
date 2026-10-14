// Busca NF-e (SEFAZ) e NFS-e (ADN).
// - Botão na tela (admin): { cnpj, tipo: "nfe" | "nfse" } → roda na hora e devolve o resultado.
// - Cron de hora em hora: { origem: "cron" } → responde 202 e roda todas as empresas em segundo plano.
import { admin, bancoSupabase } from "../_shared/banco.ts";
import { clienteHttp } from "../_shared/certificado.ts";
import { erro, json, mensagemDeRede, servir, VERSAO } from "../_shared/http.ts";
import * as sefaz from "../_shared/sefaz.ts";
import * as adn from "../_shared/adn.ts";
import { httpViaPonte, nfeHabilitada, temPonte } from "../_shared/ponte.ts";

const sb = admin();
// NF-e passa pela ponte com OpenSSL (Cloud Run): o servidor de NF-e da SEFAZ (IIS) pede o certificado por
// renegociação TLS, que o runtime das Edge Functions (rustls) não suporta. Sem PONTE_URL, a NF-e fica desligada.
const NFE_HABILITADA = nfeHabilitada();
const banco = bancoSupabase(sb);

async function comCertificado<T>(cnpj: string, tipo: "nfe" | "nfse", fn: (http: sefaz.Http) => Promise<T>): Promise<T> {
  const cert = await banco.lerCertificado(cnpj);
  if (!cert) throw new Error("Certificado A1 não cadastrado para esta empresa.");
  if (tipo === "nfe" && temPonte()) return await fn(httpViaPonte(cert));
  const client = clienteHttp(cert);
  try {
    return await fn((url, init) => fetch(url, { ...init, client } as RequestInit));
  } finally {
    client.close();
  }
}

async function rodar(cnpj: string, tipo: "nfe" | "nfse", prazoMs: number): Promise<sefaz.Resultado> {
  const { data: travou } = await sb.rpc("nf_travar_empresa", { p_cnpj: cnpj });
  if (!travou) return { ok: false, mensagem: "Já existe uma busca em andamento para esta empresa." };
  try {
    return await comCertificado(cnpj, tipo, (http) =>
      tipo === "nfe" ? sefaz.sincronizar(banco, http, cnpj, { prazoMs }) : adn.sincronizar(banco, http, cnpj, { prazoMs })
    );
  } catch (e) {
    const msg = `${mensagemDeRede(e)} [${VERSAO}]`;
    await banco.registrar(cnpj, tipo.toUpperCase(), `ERRO: ${msg}`);
    return { ok: false, mensagem: msg };
  } finally {
    await sb.rpc("nf_liberar_empresa", { p_cnpj: cnpj });
  }
}

/** Todas as empresas ativas, as mais atrasadas primeiro, dentro de ~120 s. */
async function rodarTodas() {
  const inicio = Date.now();
  const LIMITE = 120_000;
  const { data: empresas } = await sb.from("nf_empresas")
    .select("cnpj, cert_validade, bloqueio_nfe, nfe_ativa")
    .eq("ativo", true).eq("busca_automatica", true).not("cert_secret_id", "is", null)
    .order("ultima_sinc_nfe", { ascending: true, nullsFirst: true });
  for (const e of empresas ?? []) {
    const resta = LIMITE - (Date.now() - inicio);
    if (resta < 15_000) break;
    if (e.cert_validade && new Date(e.cert_validade) < new Date()) {
      await banco.registrar(e.cnpj, "CRON", "Certificado vencido — busca automática ignorada.");
      continue;
    }
    if (NFE_HABILITADA && e.nfe_ativa !== false && (!e.bloqueio_nfe || new Date(e.bloqueio_nfe) <= new Date())) await rodar(e.cnpj, "nfe", resta - 10_000);
    const resta2 = LIMITE - (Date.now() - inicio);
    if (resta2 > 15_000) await rodar(e.cnpj, "nfse", resta2 - 10_000);
  }
}

servir(async (req, quem) => {
  const corpo = await req.json().catch(() => ({}));
  if (quem.tipo === "cron") {
    // @ts-ignore EdgeRuntime existe no runtime do Supabase
    EdgeRuntime.waitUntil(rodarTodas());
    return json({ ok: true, mensagem: "Busca automática iniciada." }, 202);
  }
  const cnpj = String(corpo.cnpj ?? "").toUpperCase();
  const tipo = corpo.tipo;
  if (!cnpj || (tipo !== "nfe" && tipo !== "nfse")) return erro("Informe cnpj e tipo (nfe ou nfse).");
  if (tipo === "nfe" && !NFE_HABILITADA) {
    return erro("A busca de NF-e (produtos) ainda não está ligada: falta configurar a ponte SEFAZ (segredos PONTE_URL e PONTE_SEGREDO no Supabase). A NFS-e funciona normalmente.", 409);
  }
  const r = await rodar(cnpj, tipo, 110_000);
  return json(r, r.ok ? 200 : 409);
}, { permiteCron: true });
