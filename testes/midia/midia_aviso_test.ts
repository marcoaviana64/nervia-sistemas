// Testes da montagem dos e-mails do aviso de dias de uso do Mídia Indoor (2.6).
// Rodar (na pasta do projeto):  deno test -A testes/midia/midia_aviso_test.ts
import nodeAssert from "node:assert/strict";
const assert = (c: unknown, m = "") => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
import { type ContaAviso, frase, LINK_MIDIA, montar, type TelaAviso } from "../../supabase/functions/midia-aviso/index.ts";

const tv = (o: Partial<TelaAviso>): TelaAviso => ({ tela_id: "t1", tela: "Hall <1>", valida_ate: "2026-11-26", faltam: 7, etapa: 7, pausa_em: "2026-11-30", ...o });
const conta = (telas: TelaAviso[], emails = ["cli@x.com", "marco@nervia.com.br"]): ContaAviso => ({ conta_id: "c1", conta: "Loja A", tolerancia: 3, emails, telas });

Deno.test("uma TV, 7 dias: um e-mail por destinatário, assunto com a data, botão do app", () => {
  const es = montar(conta([tv({})]));
  assertEquals(es.map((e) => e.para), ["cli@x.com", "marco@nervia.com.br"]);
  assertEquals(es[0].assunto, 'Mídia Indoor: dias de uso da TV "Hall <1>" terminam em 26/11/2026 (Loja A)');
  assert(es[0].html.includes(LINK_MIDIA));
  assert(es[0].html.includes("Hall &lt;1&gt;"), "nome escapado no corpo");
  assert(es[0].html.includes("faltam 7 dias de uso (válida até 26/11/2026)"));
  assert(es[0].html.includes("por 3 dias e depois pausa"));
});

Deno.test("frases das etapas", () => {
  assertEquals(frase(tv({ faltam: 1, etapa: 1 })), "hoje é o último dia de uso (válida até 26/11/2026)");
  assertEquals(frase(tv({ faltam: 0, etapa: 0 })), "os dias de uso acabaram em 26/11/2026; a TV continua passando até 29/11/2026 e pausa em 30/11/2026");
  assert(frase(tv({ faltam: 0, etapa: -1 })).startsWith("pausada desde 30/11/2026"));
});

Deno.test("várias TVs: assunto pela pior situação", () => {
  assertEquals(montar(conta([tv({}), tv({ tela: "B", faltam: 3, etapa: 3 })]))[0].assunto, "Mídia Indoor: dias de uso de 2 TVs terminando (Loja A)");
  assert(montar(conta([tv({}), tv({ tela: "B", etapa: 0, faltam: 0 })]))[0].assunto.startsWith("⚠️ Mídia Indoor: acabaram os dias de uso de 2 TVs"));
  assertEquals(montar(conta([tv({ etapa: -1, faltam: 0, tela: "B" })]))[0].assunto, '🔴 Mídia Indoor: TV "B" pausada (Loja A)');
});

Deno.test("sem destinatário: nenhum e-mail", () => {
  assertEquals(montar(conta([tv({})], [])).length, 0);
});
