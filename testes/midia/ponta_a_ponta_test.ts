// Parte em Deno do teste de ponta a ponta (rode pelo ponta_a_ponta.sh, que prepara o banco e o PostgREST).
// Fluxo: Nervia cria a conta → cliente cola o link da pasta → "Atualizar agora" (função midia) lê o Drive imitado →
// TV pede código → cliente vincula → TV recebe o token, a playlist e manda o sinal → pasta muda → TV vê conteúdo novo →
// troca de playlist → desvincular → TV recebe 401.
import nodeAssert from "node:assert/strict";
import { encodeHex } from "jsr:@std/encoding@1/hex";
import { crypto as stdCrypto } from "jsr:@std/crypto@1";

const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m ?? "");
const eq = (a: unknown, b: unknown, m?: string) => nodeAssert.deepStrictEqual(a, b, m ?? "");
const PGRST = Deno.env.get("PGRST")!, SEGREDO = Deno.env.get("JWT_SEGREDO")!;

// ------------------------------------------------------------------ JWT (HS256) e usuários
const b64 = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const CHAVE_HMAC = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEGREDO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
async function jwt(claims: Record<string, unknown>) {
  const c = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + b64(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  return c + "." + b64(new Uint8Array(await crypto.subtle.sign("HMAC", CHAVE_HMAC, new TextEncoder().encode(c))));
}
const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLI = "00000000-0000-0000-0000-0000000000c1";
const T = { service: await jwt({ role: "service_role" }), admin: await jwt({ role: "authenticated", sub: ADMIN }), cli: await jwt({ role: "authenticated", sub: CLI }) };

async function rest(token: string, caminho: string, init: RequestInit = {}) {
  const r = await fetch(PGRST + caminho, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${caminho}: ${r.status} ${txt}`);
  return txt ? JSON.parse(txt) : null;
}
const rpc = (token: string, fn: string, args: unknown) => rest(token, `/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
// usuários de teste (o gatilho cria o perfil)
await rest(T.service, "/rpc/__nada", { method: "POST", body: "{}" }).catch(() => {});
const psql = async (sql: string) => {
  const r = await new Deno.Command("psql", { args: ["-v", "ON_ERROR_STOP=1", "-q", "-d", Deno.env.get("PGDB")!, "-c", sql] }).output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
};
await psql(`insert into auth.users (id, email) values ('${ADMIN}', 'marco@nervia.com.br'), ('${CLI}', 'mkt@cliente.com');
  update perfis set admin = true where user_id = '${ADMIN}';`);

// ------------------------------------------------------------------ Drive imitado (vídeos reais do ffmpeg)
const DIR = await Deno.makeTempDir();
async function video(nome: string, args: string[]) {
  const r = await new Deno.Command("ffmpeg", { args: ["-hide_banner", "-loglevel", "error", "-y", ...args, `${DIR}/${nome}`] }).output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
  return Deno.readFileSync(`${DIR}/${nome}`);
}
const h264 = await video("a.mp4", ["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=25:duration=3", "-c:v", "libx264", "-preset", "ultrafast"]);
const hevc = await video("b.mp4", ["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=1", "-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1", "-x265-params", "log-level=none"]);
const md5 = (b: Uint8Array) => encodeHex(stdCrypto.subtle.digestSync("MD5", new Uint8Array(b)));
type It = { id: string; name: string; mimeType: string; parent: string; dados?: Uint8Array };
const PASTA = "application/vnd.google-apps.folder";
const DRIVE: It[] = [
  { id: "SUBhall", name: "Hall", mimeType: PASTA, parent: "PASTAteste01" },
  { id: "SUBpraca", name: "Praça", mimeType: PASTA, parent: "PASTAteste01" },
  { id: "v1", name: "01_promo.mp4", mimeType: "video/mp4", parent: "SUBhall", dados: h264 },
  { id: "i1", name: "02_horario.png", mimeType: "image/png", parent: "SUBhall", dados: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
  { id: "v2", name: "03_iphone.mp4", mimeType: "video/mp4", parent: "SUBhall", dados: hevc },
  { id: "i2", name: "01_cardapio.jpg", mimeType: "image/jpeg", parent: "SUBpraca", dados: new Uint8Array([255, 216, 255, 1]) },
];
let pedidosDrive = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  if (url.hostname !== "www.googleapis.com") return fetchReal(entrada, init);
  pedidosDrive++;
  if (url.searchParams.get("key") !== "CHAVE-TESTE") return Response.json({ error: { message: "API key not valid" } }, { status: 400 });
  if (url.pathname === "/drive/v3/files") {
    const pai = url.searchParams.get("q")!.match(/'([^']+)' in parents/)![1];
    return Response.json({ files: DRIVE.filter((i) => i.parent === pai).map((i) => ({ id: i.id, name: i.name, mimeType: i.mimeType,
      size: i.dados ? String(i.dados.length) : undefined, md5Checksum: i.dados ? md5(i.dados) : undefined, modifiedTime: "2026-11-04T10:00:00Z" })) });
  }
  const it = DRIVE.find((i) => i.id === decodeURIComponent(url.pathname.split("/").pop()!));
  if (!it?.dados) return new Response("{}", { status: 404 });
  const h = new Headers(init?.headers as HeadersInit), m = (h.get("Range") ?? "").match(/bytes=(\d+)-(\d*)/);
  return m ? new Response(it.dados.slice(+m[1], m[2] ? +m[2] + 1 : undefined), { status: 206 }) : new Response(it.dados.slice());
}) as typeof fetch;

// ------------------------------------------------------------------ "Supabase" para as funções: /rest/v1 → PostgREST, /auth/v1/user pelo JWT
const proxy = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/auth/v1/user") {
    const tok = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const sub = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
    return sub ? Response.json({ id: sub, aud: "authenticated", role: "authenticated" }) : Response.json({ msg: "invalid" }, { status: 401 });
  }
  const destino = PGRST + u.pathname.replace(/^\/rest\/v1/, "") + u.search;
  const h = new Headers(req.headers); h.set("Authorization", `Bearer ${T.service}`); h.delete("host");
  return fetchReal(destino, { method: req.method, headers: h, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer() });
});
Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${proxy.addr.port}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", T.service);
Deno.env.set("GOOGLE_DRIVE_CHAVE", "CHAVE-TESTE");

// as funções chamam Deno.serve ao serem importadas: capturamos o handler para chamar direto
const handlers: ((r: Request) => Promise<Response>)[] = [];
const serveReal = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: any) => { handlers.push(typeof h === "function" ? h : h.handler); return { finished: Promise.resolve(), shutdown() {} }; };
await import("../../supabase/functions/midia-tv/index.ts");
await import("../../supabase/functions/midia/index.ts");
// deno-lint-ignore no-explicit-any
(Deno as any).serve = serveReal;
const [tvH, painelH] = handlers;
const tv = async (corpo: unknown) => { const r = await tvH(new Request("http://x/midia-tv", { method: "POST", body: JSON.stringify(corpo) })); return { status: r.status, j: await r.json() }; };
const painel = async (token: string, corpo: unknown) => {
  const r = await painelH(new Request("http://x/midia", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: "https://nervia.com.br" }, body: JSON.stringify(corpo) }));
  return { status: r.status, j: await r.json() };
};

Deno.test({ name: "Mídia Indoor de ponta a ponta", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  let conta = "", codigo = "", token = "";
  const APARELHO = "aparelho-e2e-0001";
  await t.step("Nervia cria a conta e libera o cliente; cliente cola o link da pasta", async () => {
    conta = (await rest(T.admin, "/mi_contas", { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), nome: "Cliente E2E" }) }))[0].id;
    await rest(T.admin, "/mi_acessos", { method: "POST", body: JSON.stringify({ user_id: CLI, conta_id: conta }) });
    await rpc(T.cli, "mi_conta_salvar", { p_conta: conta, p_pasta_url: "https://drive.google.com/drive/folders/PASTAteste01?usp=sharing", p_tempo: 9 });
  });
  await t.step("Atualizar agora (função midia) lê a pasta e confere os vídeos", async () => {
    const r = await painel(T.cli, { acao: "sincronizar", conta });
    eq(r.status, 200, JSON.stringify(r.j));
    eq([r.j.playlists, r.j.arquivos, r.j.recusados], [2, 4, 1]);
    const ms = await rest(T.cli, "/mi_midias?select=nome,situacao,codec,largura&order=nome");
    const v2 = ms.find((m: { nome: string }) => m.nome === "03_iphone.mp4");
    assert(v2.situacao === "recusado" && v2.codec === "H.265 (HEVC)");
    assert(ms.find((m: { nome: string }) => m.nome === "01_promo.mp4").largura === 1920);
  });
  await t.step("login sem acesso não sincroniza a conta de outro", async () => {
    const outro = await jwt({ role: "authenticated", sub: "00000000-0000-0000-0000-0000000000ff" });
    await psql(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ff', 'x@y.com')`);
    eq((await painel(outro, { acao: "sincronizar", conta })).status, 403);
  });
  await t.step("TV pede código e aguarda", async () => {
    const r = await tv({ acao: "codigo", aparelho: APARELHO });
    eq(r.status, 200); codigo = r.j.codigo; assert(/^[A-Z0-9]{6}$/.test(codigo));
    eq((await tv({ acao: "aguardar", aparelho: APARELHO, codigo })).j.situacao, "aguardando");
    eq((await tv({ acao: "codigo", aparelho: "x" })).status, 429, "aparelho inválido");
  });
  await t.step("cliente vincula; TV recebe o token uma vez", async () => {
    const pls = await rest(T.cli, `/mi_playlists?select=id,nome&conta_id=eq.${conta}`);
    const hall = pls.find((p: { nome: string }) => p.nome === "Hall").id;
    await rpc(T.cli, "mi_vincular", { p_codigo: codigo, p_conta: conta, p_nome: "Hall de entrada", p_playlist: hall });
    const a = await tv({ acao: "aguardar", aparelho: APARELHO, codigo });
    eq(a.j.situacao, "vinculado"); token = a.j.token; eq(a.j.tela, "Hall de entrada");
    eq((await tv({ acao: "aguardar", aparelho: APARELHO, codigo })).j.situacao, "usado");
  });
  let conteudo1 = "";
  await t.step("TV recebe a playlist: só os arquivos aceitos, na ordem, com a chave de download", async () => {
    const r = await tv({ acao: "playlist", token });
    eq(r.status, 200);
    eq(r.j.itens.map((i: { nome: string }) => i.nome), ["01_promo.mp4", "02_horario.png"]);
    eq(r.j.itens[1].tempo_s, 9, "imagem com o tempo padrão da conta");
    eq(r.j.chave_api, "CHAVE-TESTE");
    eq([r.j.rotacao, r.j.intervalo_playlist_s], [0, 300], "posição normal e consulta a cada 5 min com conteúdo");
    eq(r.j.itens[0].md5, md5(h264));
    // a TV baixa pela URL + chave (o Drive imitado devolve o vídeo e o md5 confere)
    const baixado = new Uint8Array(await (await fetch(r.j.itens[0].url + "&key=" + r.j.chave_api)).arrayBuffer());
    eq(md5(baixado), r.j.itens[0].md5);
    conteudo1 = r.j.conteudo;
  });
  await t.step("leitura da pasta pela TV respeita o intervalo (não chama o Drive a cada pedido)", async () => {
    const antes = pedidosDrive; await tv({ acao: "playlist", token }); eq(pedidosDrive, antes);
  });
  await t.step("sinal de vida aparece no painel", async () => {
    eq((await tv({ acao: "sinal", token, versao_app: "1.0", modelo: "Box Teste", android: "9", tocando: "01_promo.mp4", espaco_livre_mb: 4096,
      baixando: 0, conteudo: conteudo1, erros: [{ nome: "x.mp4", erro: "este aparelho não toca o vídeo" }] })).status, 200);
    const [tela] = await rest(T.cli, "/mi_telas?select=nome,ultimo_sinal,modelo,espaco_livre_mb,erros,tocando");
    assert(tela.ultimo_sinal && tela.modelo === "Box Teste" && tela.espaco_livre_mb === 4096 && tela.erros.length === 1 && tela.tocando === "01_promo.mp4");
  });
  await t.step("tempo próprio da imagem e arquivo novo na pasta mudam o conteúdo", async () => {
    const [img] = await rest(T.cli, "/mi_midias?select=id&nome=eq.02_horario.png");
    await rpc(T.cli, "mi_midia_tempo", { p_midia: img.id, p_tempo: 20 });
    DRIVE.push({ id: "i3", name: "00_abertura.jpg", mimeType: "image/jpeg", parent: "SUBhall", dados: new Uint8Array([255, 216, 9]) });
    // duas leituras forçadas seguidas (menos de 20 s) não rodam: a segunda avisa e não chama o Drive
    const cedo = await painel(T.cli, { acao: "sincronizar", conta });
    assert(String(cedo.j.mensagem).includes("acabou de ser lida"), JSON.stringify(cedo.j));
    await psql(`update mi_contas set sinc_iniciado_em = now() - interval '1 minute' where id = '${conta}'`);
    eq((await painel(T.cli, { acao: "sincronizar", conta })).j.arquivos, 5);
    const r = await tv({ acao: "playlist", token });
    eq(r.j.itens.map((i: { nome: string; tempo_s: number | null }) => [i.nome, i.tempo_s]), [["00_abertura.jpg", 9], ["01_promo.mp4", null], ["02_horario.png", 20]]);
    assert(r.j.conteudo !== conteudo1);
  });
  await t.step("posição da TV (em pé) chega à TV", async () => {
    const [tela] = await rest(T.cli, "/mi_telas?select=id");
    await rpc(T.cli, "mi_tela_girar", { p_tela: tela.id, p_rotacao: 90 });
    eq((await tv({ acao: "playlist", token })).j.rotacao, 90);
  });
  await t.step("troca de playlist chega à TV", async () => {
    const [tela] = await rest(T.cli, "/mi_telas?select=id");
    const [praca] = await rest(T.cli, `/mi_playlists?select=id&nome=eq.Pra%C3%A7a`);
    await rpc(T.cli, "mi_tela_salvar", { p_tela: tela.id, p_nome: "Hall de entrada", p_playlist: praca.id });
    const r = await tv({ acao: "playlist", token });
    eq([r.j.playlist, r.j.itens.map((i: { nome: string }) => i.nome)], ["Praça", ["01_cardapio.jpg"]]);
  });
  await t.step("conta suspensa: TV recebe playlist vazia (tela de espera)", async () => {
    await rest(T.admin, `/mi_contas?id=eq.${conta}`, { method: "PATCH", body: JSON.stringify({ ativo: false }) });
    const r = await tv({ acao: "playlist", token });
    eq([r.j.conta_ativa, r.j.itens.length, r.j.intervalo_playlist_s], [false, 0, 30], "sem conteúdo: pergunta de novo em 30 s");
    await rest(T.admin, `/mi_contas?id=eq.${conta}`, { method: "PATCH", body: JSON.stringify({ ativo: true }) });
  });
  await t.step("desvincular: TV recebe 401 na playlist e no sinal", async () => {
    const [tela] = await rest(T.cli, "/mi_telas?select=id");
    await rpc(T.cli, "mi_desvincular", { p_tela: tela.id });
    eq((await tv({ acao: "playlist", token })).status, 401);
    eq((await tv({ acao: "sinal", token })).status, 401);
  });
  await t.step("tudo ficou na auditoria", async () => {
    const acoes = (await rest(T.admin, "/auditoria?select=acao&acao=like.midia_*")).map((a: { acao: string }) => a.acao);
    for (const a of ["midia_conta_criada", "midia_acesso_liberado", "midia_pasta_alterada", "midia_tempo_alterado", "midia_tv_vinculada", "midia_playlist_trocada", "midia_conta_alterada", "midia_tv_desvinculada"]) {
      assert(acoes.includes(a), `falta ${a}`);
    }
  });
  await proxy.shutdown();
} });
