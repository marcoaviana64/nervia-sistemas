// Acesso ao banco/Storage com a service_role (ignora RLS — só as funções usam).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import type { DadosNota } from "./xml.ts";
import type { CertGuardado } from "./certificado.ts";

export interface Empresa {
  cnpj: string; nome: string; uf: string; ativo: boolean; busca_automatica: boolean;
  cert_secret_id: string | null; cert_validade: string | null;
  ult_nsu_nfe: number; max_nsu_nfe: number; bloqueio_nfe: string | null;
  ult_nsu_nfse: number;
  nfe_ativa?: boolean; nfe_656_seguidas?: number; nfe_pausa_motivo?: string | null;
}

/** Interface usada pela lógica da SEFAZ/ADN (permite testar sem Supabase). */
export interface Banco {
  empresa(cnpj: string): Promise<Empresa | null>;
  atualizarEmpresa(cnpj: string, campos: Partial<Record<string, unknown>>): Promise<void>;
  gravarNota(cnpj: string, tipo: "NFE" | "NFSE", dados: DadosNota, nsu: number, xmlPath: string | null): Promise<string>;
  marcarCancelada(cnpj: string, tipo: "NFE" | "NFSE", chave: string): Promise<void>;
  marcarManifestada(cnpj: string, chave: string): Promise<void>;
  salvarXml(caminho: string, conteudo: string): Promise<string>;
  registrar(cnpj: string, origem: string, mensagem: string): Promise<void>;
  lerCertificado(cnpj: string): Promise<CertGuardado | null>;
}

/** Chave secreta: as novas (sb_secret_…, em SUPABASE_SECRET_KEYS) ou, se não houver, a service_role antiga. */
function chaveSecreta(): string {
  try {
    const novas = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const k = novas.default ?? Object.values(novas)[0];
    if (typeof k === "string" && k) return k;
  } catch { /* segue para a antiga */ }
  const antiga = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!antiga) throw new Error("Chave secreta do Supabase não disponível na função.");
  return antiga;
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, chaveSecreta(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Banco: ${r.error.message}`);
  return r.data;
}

export function bancoSupabase(sb: SupabaseClient = admin()): Banco {
  return {
    async empresa(cnpj) {
      return ok(await sb.from("nf_empresas").select("*").eq("cnpj", cnpj).maybeSingle()) as Empresa | null;
    },
    async atualizarEmpresa(cnpj, campos) {
      ok(await sb.from("nf_empresas").update(campos).eq("cnpj", cnpj));
    },
    async gravarNota(cnpj, tipo, dados, nsu, xmlPath) {
      return ok(await sb.rpc("nf_gravar_nota", {
        p_cnpj: cnpj, p_tipo: tipo, p_dados: dados, p_nsu: nsu, p_xml_path: xmlPath,
      })) as string;
    },
    async marcarCancelada(cnpj, tipo, chave) {
      ok(await sb.from("nf_notas").update({ situacao: "Cancelada", atualizado: new Date().toISOString() })
        .eq("cnpj_consulta", cnpj).eq("tipo", tipo).eq("chave", chave));
    },
    async marcarManifestada(cnpj, chave) {
      ok(await sb.from("nf_notas").update({ manifestada: true, atualizado: new Date().toISOString() })
        .eq("cnpj_consulta", cnpj).eq("tipo", "NFE").eq("chave", chave));
    },
    async salvarXml(caminho, conteudo) {
      ok(await sb.storage.from("nf-xml").upload(caminho, new Blob([conteudo], { type: "application/xml" }), {
        upsert: true, contentType: "application/xml",
      }));
      return caminho;
    },
    async registrar(cnpj, origem, mensagem) {
      await sb.from("nf_log").insert({ cnpj, origem, mensagem });
    },
    async lerCertificado(cnpj) {
      const txt = ok(await sb.rpc("nf_ler_certificado", { p_cnpj: cnpj })) as string | null;
      return txt ? JSON.parse(txt) as CertGuardado : null;
    },
  };
}
