// Confere o leitor de XML da versão web contra notas REAIS já baixadas pela versão local.
// Uso: deno run -A testes/comparar_reais.ts <pasta dados da versao-local> <esperado.json>
// O esperado.json sai de: python3 testes/exportar_esperado.py <notas.db> > esperado.json
import { lerNFSe, lerProcNFe, lerResNFe, nfseCancelada, parseXml } from "../supabase/functions/_shared/xml.ts";

const [pasta, arqEsperado] = Deno.args;
const esperado: Record<string, Record<string, unknown>> = JSON.parse(Deno.readTextFileSync(arqEsperado));
let ok = 0, dif = 0, cancel = 0;
const campos = ["numero", "emit_cnpj", "emit_nome", "dest_cnpj", "dest_nome", "valor", "completo"] as const;

for (const cnpj of [...Deno.readDirSync(pasta)].filter((d) => d.isDirectory).map((d) => d.name)) {
  for (const sub of ["nfe", "nfse"]) {
    let itens: Deno.DirEntry[] = [];
    try { itens = [...Deno.readDirSync(`${pasta}/${cnpj}/${sub}`)]; } catch { continue; }
    for (const f of itens) {
      const xml = Deno.readTextFileSync(`${pasta}/${cnpj}/${sub}/${f.name}`);
      const raiz = parseXml(xml);
      if (f.name.startsWith("evento-")) { if (nfseCancelada(raiz)) cancel++; continue; }
      const d = sub === "nfse" ? lerNFSe(raiz) : f.name.includes("resumo") ? lerResNFe(raiz) : lerProcNFe(raiz);
      const e = esperado[`${cnpj}|${sub === "nfse" ? "NFSE" : "NFE"}|${d.chave}`];
      if (!e) { console.log("sem correspondente:", f.name); dif++; continue; }
      const erros = campos.filter((c) => String(d[c] ?? "") !== String(e[c] ?? ""));
      // data: compara o instante (a versão local guarda texto; a web guarda timestamptz)
      if (new Date(d.data_emissao).getTime() !== new Date(String(e.data_emissao)).getTime()) erros.push("data_emissao" as never);
      if (erros.length) { dif++; console.log(f.name, erros.map((c) => `${c}: web=${(d as never)[c]} local=${e[c]}`).join(" | ")); }
      else ok++;
    }
  }
}
console.log(`\nIguais: ${ok} · Diferentes: ${dif} · Eventos de cancelamento reconhecidos: ${cancel}`);
if (dif) Deno.exit(1);
