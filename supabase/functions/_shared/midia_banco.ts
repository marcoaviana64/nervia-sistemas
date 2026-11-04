// Implementação de BancoMidia sobre o Supabase (service role).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import type { BancoMidia, Conferidos } from "./midia.ts";

export function bancoMidia(sb: SupabaseClient): BancoMidia {
  const ok = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    async reservar(conta, segundos) { return !!ok(await sb.rpc("mi_sinc_reservar", { p_conta: conta, p_seg: segundos })); },
    async conta(conta) { return ok(await sb.from("mi_contas").select("id, pasta_id, pasta_chave, limite_mb").eq("id", conta).maybeSingle()); },
    async conferidos(conta) {
      const linhas = ok(await sb.from("mi_midias").select("drive_id, md5, situacao, motivo, largura, altura, duracao_s, codec, mi_playlists!inner(conta_id)")
        .eq("mi_playlists.conta_id", conta).eq("tipo", "video")) as Record<string, unknown>[];
      const m: Conferidos = new Map();
      for (const l of linhas ?? []) {
        // falha de leitura (rede) não fica guardada: confere de novo na próxima vez
        if (String(l.motivo ?? "").startsWith("não foi possível conferir")) continue;
        m.set(String(l.drive_id), { md5: String(l.md5), situacao: l.situacao as "ok" | "recusado", motivo: String(l.motivo ?? ""),
          largura: l.largura as number | null, altura: l.altura as number | null, duracao_s: l.duracao_s == null ? null : Number(l.duracao_s), codec: String(l.codec ?? "") });
      }
      return m;
    },
    async gravar(conta, pastas, erro) { ok(await sb.rpc("mi_sinc_gravar", { p_conta: conta, p_pastas: pastas, p_erro: erro })); },
  };
}
