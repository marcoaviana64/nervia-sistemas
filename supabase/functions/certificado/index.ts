// Recebe o .pfx + senha, valida e guarda certificado e chave criptografados no Vault.
// A senha e o .pfx original não são armazenados.
import { admin, bancoSupabase } from "../_shared/banco.ts";
import { lerPfx } from "../_shared/certificado.ts";
import { erro, json, servir } from "../_shared/http.ts";

const sb = admin();
const banco = bancoSupabase(sb);

servir(async (req) => {
  const { cnpj, pfx_base64, senha } = await req.json();
  if (!cnpj || !pfx_base64) return erro("Envie o CNPJ e o arquivo .pfx.");
  if (pfx_base64.length > 200_000) return erro("Arquivo grande demais para um certificado A1.");
  const emp = await banco.empresa(cnpj);
  if (!emp) return erro("Empresa não cadastrada.", 404);
  let info;
  try {
    info = lerPfx(pfx_base64, senha ?? "");
  } catch (e) {
    return erro((e as Error).message);
  }
  if (info.cnpj && info.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    return erro(`Este certificado é do CNPJ ${info.cnpj}, que não é da mesma empresa que ${cnpj}.`);
  }
  if (new Date(info.validade) < new Date()) {
    return erro(`Certificado vencido em ${new Date(info.validade).toLocaleDateString("pt-BR")}.`);
  }
  const { error } = await sb.rpc("nf_salvar_certificado", {
    p_cnpj: cnpj, p_conteudo: JSON.stringify(info.guardado), p_titular: info.titular,
    p_cert_cnpj: info.cnpj, p_validade: info.validade,
  });
  if (error) throw new Error(error.message);
  await banco.registrar(cnpj, "CERTIFICADO", `Certificado de ${info.titular} cadastrado (válido até ${info.validade.slice(0, 10)}).`);
  return json({
    ok: true, titular: info.titular, validade: info.validade,
    aviso: info.cnpj && info.cnpj !== cnpj ? `Certificado da matriz/filial ${info.cnpj} (mesma raiz) — a SEFAZ aceita.` : null,
  });
});
