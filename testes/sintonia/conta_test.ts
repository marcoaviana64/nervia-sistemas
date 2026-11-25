// NVSintonia 1.1: regra da função sintonia-conta (conta por chave, sem e-mail).
// Rodar: deno test -A testes/sintonia/conta_test.ts
import nodeAssert from "node:assert/strict";
import { atender, senhaDaChave } from "../../supabase/functions/sintonia-conta/index.ts";

function falso(op: { limite?: boolean; entrar?: boolean; usuario?: { id: string; email: string } | null } = {}) {
  const log: string[] = [];
  return {
    log,
    c: {
      limite: async () => op.limite ?? true,
      limiteEntrar: async () => op.entrar ?? true,
      chaveNova: async () => ({ chave: "K7QM-4XPA-9TRD", email: "s-aaa@sintonia.nervia.com.br" }),
      emailDaChave: async (k: string) => (/^[2-9A-HJ-NP-Z]{12}$/.test(k.toUpperCase().replace(/[^0-9A-Z]/gi, "")) ? "s-bbb@sintonia.nervia.com.br" : null),
      criarUsuario: async (e: string, s: string, n: string, o: string) => { log.push(`criar ${e} ${s} ${n} ${o}`); return "u1"; },
      usuarioDoToken: async () => op.usuario ?? null,
      trocarLogin: async (id: string, e: string, s: string) => { log.push(`trocar ${id} ${e} ${s}`); },
      auditar: async (id: string, a: string) => { log.push(`auditar ${id} ${a}`); },
    },
  };
}

Deno.test("senha derivada: tem maiúscula, minúscula, número e símbolo, e ignora traço e caixa", () => {
  nodeAssert.equal(senhaDaChave("k7qm-4xpa-9trd"), "Sn!K7QM4XPA9TRDk7qm4xpa9trd");
  nodeAssert.equal(senhaDaChave("K7QM 4XPA 9TRD"), senhaDaChave("k7qm4xpa9trd"));
});
Deno.test("criar: só com nome; devolve a chave uma vez; o usuário nasce com e-mail derivado e a senha da chave", async () => {
  const f = falso();
  const r = await atender({ acao: "criar", nome: " Ana " }, "1.1.1.1", "", f.c);
  nodeAssert.deepStrictEqual([r.status, r.corpo.chave, r.corpo.email], [200, "K7QM-4XPA-9TRD", "s-aaa@sintonia.nervia.com.br"]);
  nodeAssert.deepStrictEqual(f.log, ["criar s-aaa@sintonia.nervia.com.br Sn!K7QM4XPA9TRDk7qm4xpa9trd Ana sintonia", "auditar u1 sintonia_conta_criada"]);
  nodeAssert.equal((await atender({ acao: "criar", nome: "" }, "", "", falso().c)).status, 400);
  nodeAssert.equal((await atender({ acao: "criar", nome: "Ana" }, "", "", falso({ limite: false }).c)).status, 429);
});
Deno.test("entrar: chave válida devolve o e-mail derivado; inválida e limite recusam", async () => {
  nodeAssert.equal((await atender({ acao: "entrar", chave: "k7qm-4xpa-9trd" }, "", "", falso().c)).corpo.email, "s-bbb@sintonia.nervia.com.br");
  nodeAssert.equal((await atender({ acao: "entrar", chave: "abc" }, "", "", falso().c)).status, 400);
  nodeAssert.equal((await atender({ acao: "entrar", chave: "K7QM4XPA9TRD" }, "", "", falso({ entrar: false }).c)).status, 429);
});
Deno.test("converter: só com login de e-mail; mesmo usuário ganha a chave e perde o e-mail", async () => {
  nodeAssert.equal((await atender({ acao: "converter" }, "", "", falso().c)).status, 401);
  nodeAssert.equal((await atender({ acao: "converter" }, "", "t", falso({ usuario: { id: "u9", email: "s-x@sintonia.nervia.com.br" } }).c)).status, 400);
  const f = falso({ usuario: { id: "u9", email: "marco@x.com" } });
  const r = await atender({ acao: "converter" }, "", "t", f.c);
  nodeAssert.equal(r.corpo.chave, "K7QM-4XPA-9TRD");
  nodeAssert.deepStrictEqual(f.log, ["trocar u9 s-aaa@sintonia.nervia.com.br Sn!K7QM4XPA9TRDk7qm4xpa9trd", "auditar u9 sintonia_email_trocado_por_chave"]);
});
Deno.test("NVAura: criar com app aura usa a mesma chave, marca a origem e audita aura_conta_criada", async () => {
  const f = falso();
  const r = await atender({ acao: "criar", nome: "Bia", app: "aura" }, "1.1.1.1", "", f.c);
  nodeAssert.equal(r.status, 200);
  nodeAssert.deepStrictEqual(f.log, ["criar s-aaa@sintonia.nervia.com.br Sn!K7QM4XPA9TRDk7qm4xpa9trd Bia aura", "auditar u1 aura_conta_criada"]);
});
