// NVSintonia: regra da função sintonia-conta (cria conta só se o e-mail não existe; resposta igual; limite).
// Rodar: deno test -A testes/sintonia/conta_test.ts
import nodeAssert from "node:assert/strict";
import { pedirConta } from "../../supabase/functions/sintonia-conta/index.ts";

function falso(existentes: string[] = [], liberado = true) {
  const criados: string[] = [];
  return { criados, c: { limite: async () => liberado, existe: async (e: string) => existentes.includes(e), criar: async (e: string) => { criados.push(e); } } };
}

Deno.test("cria a conta de e-mail novo, em minúsculas", async () => {
  const f = falso();
  const r = await pedirConta({ email: " Caio@Exemplo.com ", nome: "Caio" }, "1.1.1.1", f.c);
  nodeAssert.deepStrictEqual([r.status, r.corpo.ok, f.criados], [200, true, ["caio@exemplo.com"]]);
});
Deno.test("e-mail que já existe: mesma resposta, nada criado", async () => {
  const f = falso(["ana@x.com"]);
  const r = await pedirConta({ email: "ana@x.com", nome: "Ana" }, "1.1.1.1", f.c);
  nodeAssert.deepStrictEqual([r.status, r.corpo.ok, f.criados.length], [200, true, 0]);
});
Deno.test("dados inválidos e limite", async () => {
  nodeAssert.equal((await pedirConta({ email: "sem-arroba", nome: "A" }, "", falso().c)).status, 400);
  nodeAssert.equal((await pedirConta({ email: "a@b.com", nome: "" }, "", falso().c)).status, 400);
  nodeAssert.equal((await pedirConta({ email: "a@b.com", nome: "x".repeat(41) }, "", falso().c)).status, 400);
  const f = falso([], false);
  const r = await pedirConta({ email: "a@b.com", nome: "A" }, "", f.c);
  nodeAssert.deepStrictEqual([r.status, f.criados.length], [429, 0]);
});
