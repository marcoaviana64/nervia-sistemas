// Registro de auditoria (tabela public.auditoria, somente inclusão). Ver migração ..._auditoria.sql.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import type { Chamador } from "./http.ts";

/** Grava quem fez (login), quando (relógio do servidor), de onde (IP/navegador) e o quê.
 *  Falha ao gravar NÃO pode passar em silêncio: lança erro (a ação sensível fica sem comprovante). */
export async function auditar(
  sb: SupabaseClient, req: Request, quem: NonNullable<Chamador>,
  acao: string, cnpj: string | null, detalhes: Record<string, unknown>,
): Promise<void> {
  let email: string | null = null, nome: string | null = null;
  const userId = quem.tipo === "cron" ? null : quem.userId;
  if (userId) {
    const { data } = await sb.from("perfis").select("email, nome").eq("user_id", userId).maybeSingle();
    email = data?.email ?? null; nome = data?.nome ?? null;
  }
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const { error } = await sb.from("auditoria").insert({
    user_id: userId, email, nome, papel: quem.tipo === "cron" ? "sistema" : quem.tipo, acao, cnpj, detalhes,
    ip, navegador: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  if (error) throw new Error(`Auditoria: ${error.message}`);
}
