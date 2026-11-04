// Testes da montagem dos e-mails de aviso do Monitor de Links.
// Rodar (na pasta do projeto):  deno test -A testes/monitor/monitor_aviso_test.ts
import nodeAssert from "node:assert/strict";
const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
import { duracao, type Evento, LINK_MONITOR, montarAvisos } from "../../supabase/functions/monitor-aviso/index.ts";

const AGORA = new Date("2026-11-04T04:30:00Z"); // 01:30 em Brasília
const base: Evento = {
  queda_id: 1, evento: "caiu", tipo: "link", inicio: "2026-11-04T04:00:37Z", fim: null, local_id: "L1",
  local: "Taquara Recepção", cliente: "Iguardei", equipamento: "RB750", link: "Link via VPN Vogue", operadora: "", emails: ["marco@nervia.com.br"],
};

Deno.test("duração em texto", () => {
  assertEquals([duracao(0.2), duracao(29), duracao(72), duracao(1500)], ["1 min", "29 min", "1h12", "1d 1h"]);
});

Deno.test("queda de link: assunto, horário de Brasília, há quanto tempo e botão do Monitor", () => {
  const [a] = montarAvisos([base], AGORA);
  assertEquals(a.para, "marco@nervia.com.br");
  assertEquals(a.assunto, "🔴 Caiu: Link via VPN Vogue — Taquara Recepção");
  assert(a.html.includes("desde 01:00 (há 29 min)"), "horário e duração");
  assert(a.html.includes("Taquara Recepção · Iguardei · RB750"));
  assert(a.html.includes(LINK_MONITOR));
});

Deno.test("volta: quanto tempo ficou fora", () => {
  const [a] = montarAvisos([{ ...base, evento: "voltou", fim: "2026-11-04T05:12:37Z" }], AGORA);
  assertEquals(a.assunto, "🟢 Voltou: Link via VPN Vogue — Taquara Recepção");
  assert(a.html.includes("ficou fora 1h12 — de 01:00 a 02:12"));
});

Deno.test("roteador sem contato", () => {
  const [a] = montarAvisos([{ ...base, tipo: "sem_contato", link: "" }], AGORA);
  assertEquals(a.assunto, "🔴 Sem contato: Roteador RB750 — Taquara Recepção");
});

Deno.test("um e-mail por destinatário, com todos os avisos dele; texto escapado", () => {
  const evs: Evento[] = [
    base,
    { ...base, queda_id: 2, link: "Claro <fibra>", operadora: "Claro", emails: ["marco@nervia.com.br", "ti@cliente.com"] },
    { ...base, queda_id: 3, evento: "voltou", fim: "2026-11-04T04:20:00Z", emails: ["ti@cliente.com"] },
  ];
  const av = montarAvisos(evs, AGORA);
  assertEquals(av.map((a) => [a.para, a.eventos.map((e) => e.queda_id)]), [["marco@nervia.com.br", [1, 2]], ["ti@cliente.com", [2, 3]]]);
  assertEquals(av[0].assunto, "Monitor de Links: 2 fora do ar");
  assertEquals(av[1].assunto, "Monitor de Links: 1 fora do ar, 1 voltou");
  assert(av[0].html.includes("Claro &lt;fibra&gt; (Claro)") && !av[0].html.includes("<fibra>"));
});
