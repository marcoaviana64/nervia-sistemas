// Registra "Ciência da Operação" nas NF-e selecionadas (libera o download do XML completo).
import { admin, bancoSupabase } from "../_shared/banco.ts";
import { clienteHttp } from "../_shared/certificado.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { CSTAT_CIENCIA_OK, manifestarCiencia } from "../_shared/sefaz.ts";

const sb = admin();
const banco = bancoSupabase(sb);

servir(async (req) => {
  const { cnpj, ids } = await req.json();
  if (!cnpj || !Array.isArray(ids) || !ids.length) return erro("Informe cnpj e ids.");
  const { data: notas, error } = await sb.from("nf_notas").select("chave")
    .eq("cnpj_consulta", cnpj).eq("tipo", "NFE").eq("completo", false).eq("manifestada", false)
    .neq("situacao", "Cancelada").in("id", ids);
  if (error) throw new Error(error.message);
  const chaves = (notas ?? []).map((n) => n.chave);
  if (!chaves.length) return erro("Nenhuma NF-e (resumo) pendente de ciência entre as selecionadas.");
  const cert = await banco.lerCertificado(cnpj);
  if (!cert) return erro("Certificado A1 não cadastrado para esta empresa.");
  const client = clienteHttp(cert);
  try {
    const res = await manifestarCiencia(banco, (u, i) => fetch(u, { ...i, client } as RequestInit), cert, cnpj, chaves);
    const ok = res.filter(([, s]) => CSTAT_CIENCIA_OK.has(s)).length;
    const falhas = res.filter(([, s]) => !CSTAT_CIENCIA_OK.has(s)).map(([c, s, m]) => `…${c.slice(-8)}: ${s} ${m}`);
    return json({
      ok: true, registradas: ok, falhas,
      mensagem: `Ciência registrada em ${ok} de ${res.length} nota(s). O XML completo chega na próxima busca de NF-e.`,
    });
  } finally {
    client.close();
  }
});
