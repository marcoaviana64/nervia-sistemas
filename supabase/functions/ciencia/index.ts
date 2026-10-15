// Manifestação do destinatário nas NF-e selecionadas ("só resumo"), para liberar o XML completo:
// - "ciencia"     → Ciência da Operação (210210), só até 10 dias da autorização;
// - "confirmacao" → Confirmação da Operação (210200), até 90 dias (NT 2020.001 v1.60).
// Sempre por clique de alguém: admin (equipe Nervia) ou cliente com acesso ao CNPJ. Nunca automático.
import { admin, bancoSupabase } from "../_shared/banco.ts";
import { clienteHttp } from "../_shared/certificado.ts";
import { erro, json, servir } from "../_shared/http.ts";
import { CSTAT_CIENCIA_OK, EVENTOS, type Http, manifestarCiencia, type TipoEvento } from "../_shared/sefaz.ts";
import { httpViaPonte, temPonte } from "../_shared/ponte.ts";

const sb = admin();
const banco = bancoSupabase(sb);
const DIA = 86_400_000;

servir(async (req, quem) => {
  const { cnpj, ids, evento = "ciencia" } = await req.json();
  if (!cnpj || !Array.isArray(ids) || !ids.length) return erro("Informe cnpj e ids.");
  if (!(evento in EVENTOS)) return erro("Evento inválido.");
  const tipo = evento as TipoEvento, ev = EVENTOS[tipo];
  if (quem.tipo === "cliente") {
    const { data: acesso } = await sb.from("nf_acessos").select("cnpj").eq("user_id", quem.userId).eq("cnpj", cnpj).maybeSingle();
    if (!acesso) return erro("Acesso negado a esta empresa.", 403);
  }
  const { data: notas, error } = await sb.from("nf_notas").select("chave, data_emissao")
    .eq("cnpj_consulta", cnpj).eq("tipo", "NFE").eq("papel", "recebida").eq("completo", false).eq("manifestada", false)
    .neq("situacao", "Cancelada").in("id", ids);
  if (error) throw new Error(error.message);
  const agora = Date.now();
  const noPrazo = (notas ?? []).filter((n) => !n.data_emissao || agora - new Date(n.data_emissao).getTime() <= ev.prazoDias * DIA);
  const foraPrazo = (notas ?? []).length - noPrazo.length;
  const chaves = noPrazo.map((n) => n.chave);
  if (!chaves.length) {
    return erro(foraPrazo
      ? `As NF-e selecionadas passaram do prazo da ${ev.nome} (${ev.prazoDias} dias da emissão).` +
        (tipo === "ciencia" ? " Para elas, use \"Confirmar operação\" (até 90 dias)." : " A SEFAZ não aceita mais manifestação para elas.")
      : `Nenhuma NF-e "só resumo" pendente entre as selecionadas.`);
  }
  const cert = await banco.lerCertificado(cnpj);
  if (!cert) return erro("Certificado A1 não cadastrado para esta empresa.");
  // NF-e: pela ponte com OpenSSL quando configurada (ver _shared/ponte.ts)
  const client = temPonte() ? null : clienteHttp(cert);
  const http: Http = client ? (u, i) => fetch(u, { ...i, client } as RequestInit) : httpViaPonte(cert);
  try {
    const res = await manifestarCiencia(banco, http, cert, cnpj, chaves, tipo);
    const ok = res.filter(([, s]) => CSTAT_CIENCIA_OK.has(s)).length;
    const falhas = res.filter(([, s]) => !CSTAT_CIENCIA_OK.has(s)).map(([c, s, m]) => `…${c.slice(-8)}: ${s} ${m}`);
    return json({
      ok: true, registradas: ok, falhas,
      mensagem: `${ev.nome} registrada em ${ok} de ${res.length} nota(s). O XML completo chega na próxima busca de NF-e.` +
        (foraPrazo ? ` ${foraPrazo} nota(s) fora do prazo de ${ev.prazoDias} dias foram ignoradas.` : ""),
    });
  } finally {
    client?.close();
  }
}, { permiteCliente: true });
