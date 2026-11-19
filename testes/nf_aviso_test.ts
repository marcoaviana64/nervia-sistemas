// Testes da montagem dos e-mails do Buscador de NF (resumo diário e certificado vencendo).
// Rodar (na pasta do projeto):  deno test -A testes/nf_aviso_test.ts
import nodeAssert from "node:assert/strict";
const assert = (c: unknown, m = "") => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
import { type Certificado, LINK_BUSCADOR, montarCertificado, montarResumo, type NotaResumo, type Resumo } from "../supabase/functions/nf-aviso/index.ts";

const nota: NotaResumo = {
  empresa: "Linum", cnpj: "46469501000112", tipo: "NFE", papel: "recebida", numero: "123", data_emissao: "2026-11-18T13:00:00Z",
  valor: 1234.5, situacao: "Autorizada", completo: false, parte: "Tecidos <Rio>",
};
const resumo: Resumo = {
  user_id: "u1", email: "gorette@linum.com.br", nome: "Gorette Diener", desde: "2026-11-18T10:40:00Z", total: 2,
  notas: [nota, { ...nota, tipo: "NFSE", papel: "emitida", numero: "9", parte: "Cliente B", completo: true, valor: "50.00" }],
  totais: [{ empresa: "Linum", cnpj: "46469501000112", papel: "recebida", qtd: 1, valor: 1234.5 },
    { empresa: "Linum", cnpj: "46469501000112", papel: "emitida", qtd: 1, valor: "50.00" }],
};

Deno.test("resumo: assunto com recebidas e emitidas, saudação e botão do Buscador", () => {
  const e = montarResumo(resumo);
  assertEquals(e.para, "gorette@linum.com.br");
  assertEquals(e.assunto, "Notas fiscais: 2 notas novas (1 recebida, 1 emitida)");
  assert(e.html.includes("Olá, Gorette."));
  assert(e.html.includes(LINK_BUSCADOR));
  assert(e.html.includes("46.469.501/0001-12"));
  assert(e.html.includes("18/11/2026"), "data em Brasília");
});

Deno.test("resumo: NF-e só resumo avisa da ciência; texto escapado; valores em reais", () => {
  const e = montarResumo(resumo);
  assert(e.html.includes("só resumo: falta a ciência"));
  assert(e.html.includes("Tecidos &lt;Rio&gt;") && !e.html.includes("<Rio>"));
  assert(e.html.includes("R$\u00a01.234,50") && e.html.includes("R$\u00a050,00"));
  assert(e.html.includes("emitida por Linum") && e.html.includes("para Linum"));
});

Deno.test("resumo: mais de 40 notas mostra as 40 e diz quantas faltam", () => {
  const muitas = Array.from({ length: 45 }, (_, i) => ({ ...nota, numero: String(i) }));
  const e = montarResumo({ ...resumo, total: 45, notas: muitas, totais: [{ ...resumo.totais[0], qtd: 45 }] });
  assertEquals(e.assunto, "Notas fiscais: 45 notas novas (45 recebidas)");
  assert(e.html.includes("E mais 5 notas"));
});

const cert: Certificado = {
  cnpj: "46469501000112", empresa: "Linum", validade: "2027-05-12T18:22:25Z", titular: "GORETTE", faltam: 14, etapa: 15,
  emails: ["marco@nervia.com.br", "gorette@linum.com.br"],
};

Deno.test("certificado: um e-mail por destinatário, com os dias que faltam", () => {
  const es = montarCertificado(cert);
  assertEquals(es.map((e) => e.para), ["marco@nervia.com.br", "gorette@linum.com.br"]);
  assertEquals(es[0].assunto, "⚠️ Certificado A1 de Linum vence em 14 dias (12/05/2027)");
  assert(es[0].html.includes("Certificado A1 perto de vencer"));
});

Deno.test("certificado: amanhã e vencido", () => {
  assertEquals(montarCertificado({ ...cert, faltam: 1, etapa: 1 })[0].assunto, "⚠️ Certificado A1 de Linum vence amanhã (12/05/2027)");
  const v = montarCertificado({ ...cert, faltam: 0, etapa: 0 })[0];
  assertEquals(v.assunto, "🔴 Certificado A1 de Linum venceu (12/05/2027)");
  assert(v.html.includes("Certificado A1 vencido"));
});
