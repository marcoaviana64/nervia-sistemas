// Teste de ponta a ponta do NVSintonia (site/sintonia/) com a TELA real e o BANCO real: Postgres com todas as migrações e
// uma ponte mínima no lugar do PostgREST (como em testes/contratos/), que roda cada rpc como anon ou authenticated com o
// usuário do token — as regras das funções sin_* valem de verdade. Pessoas FICTÍCIAS.
//
// Precisa de: Postgres por TCP (PGHOST/PGPORT/PGUSER/PGPASSWORD), o pacote "pg" (NODE_PATH), Playwright, e cópias locais do
// supabase-js 2.117.2 (SUPABASE_JS) e do qrcode-generator 1.4.4 (QRCODE_JS) quando o CDN estiver bloqueado.
// Uso: PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=… SUPABASE_JS=… QRCODE_JS=… NODE_PATH=… node testes/sintonia/tela_sintonia_test.js [pasta_prints]
const path = require("path"), fs = require("fs"), http = require("http"), os = require("os"), { execFileSync } = require("child_process");
const { chromium, devices } = require("playwright");
const { Pool } = require("pg");
const RAIZ = path.resolve(__dirname, "..", ".."), SITE = path.join(RAIZ, "site");
const SAIDA = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "sintonia-"));
const PORTA = 8846, DB = "teste_sintonia", BASE = `http://127.0.0.1:${PORTA}`;
const ANA = "61000000-0000-0000-0000-000000000001", BIA = "61000000-0000-0000-0000-000000000002";
const PGC = { host: process.env.PGHOST || "127.0.0.1", port: +(process.env.PGPORT || 5432), user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD };

let falhas = 0, oks = 0;
const ok = (c, nome) => { if (c) { oks++; console.log("ok  " + nome); } else { falhas++; console.log("FALHOU  " + nome); } };

async function prepararBanco() {
  const adm = new Pool({ ...PGC, database: "postgres" });
  await adm.query(`drop database if exists ${DB}`); await adm.query(`create database ${DB}`); await adm.end();
  const migs = fs.readdirSync(path.join(RAIZ, "supabase", "migrations")).filter(f => f.endsWith(".sql")).sort();
  const sql = fs.readFileSync(path.join(RAIZ, "testes", "stubs_supabase.sql"), "utf8") + "\n" +
    migs.map(f => fs.readFileSync(path.join(RAIZ, "supabase", "migrations", f), "utf8").split("\n").filter(x => !x.startsWith("create extension")).join("\n")).join("\n");
  const tmp = path.join(SAIDA, "_migracoes.sql"); fs.writeFileSync(tmp, sql);
  execFileSync("psql", ["-h", PGC.host, "-p", String(PGC.port), "-U", PGC.user, "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp],
    { env: { ...process.env, PGPASSWORD: PGC.password }, stdio: ["ignore", "ignore", "pipe"] });
  fs.unlinkSync(tmp);
  const pool = new Pool({ ...PGC, database: DB });
  await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'ana@exemplo.test', '{"nome":"Ana Lima"}'), ($2, 'bia@exemplo.test', '{}')`, [ANA, BIA]);
  return pool;
}

// ---------------------------------------------------------------- ponte
const PEDIDOS = { contas: [], otp: [] }, SENHAS = new Map();
let IP = 1;
function servidor(pool) {
  const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
  async function como(sub, ip, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query(sub ? "set local role authenticated" : "set local role anon");
      await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.headers', $2, true)", [sub || "", JSON.stringify({ "x-forwarded-for": ip })]);
      const r = await fn(c); await c.query("commit"); return r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }
  return http.createServer(async (req, res) => {
    const corpo = await new Promise(r => { const p = []; req.on("data", d => p.push(d)); req.on("end", () => r(Buffer.concat(p))); });
    const url = new URL(req.url, "http://x");
    const json = (st, o) => { res.writeHead(st, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); res.end(o === undefined ? "" : JSON.stringify(o)); };
    if (req.method === "OPTIONS") return json(200, {});
    try {
      let sub = null; try { sub = JSON.parse(Buffer.from((req.headers.authorization || "").split(" ")[1].split(".")[1], "base64url")).sub; } catch {}
      const ip = "10.0.0." + (req.headers["x-teste-ip"] || IP);
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.slice(13); if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return json(404, { message: "função" });
        const args = corpo.length ? JSON.parse(corpo) : {};
        const meta = (await pool.query(`select p.proargnames as nomes, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos, format_type(p.prorettype, null) as ret
          from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn])).rows[0];
        if (!meta) return json(404, { message: "Could not find the function " + fn });
        const vals = [], partes = [];
        (meta.nomes || []).slice(0, meta.tipos.length).forEach((n, i) => {
          if (!(n in args)) return;
          const t = meta.tipos[i]; vals.push(t === "jsonb" ? JSON.stringify(args[n]) : args[n]); partes.push(`${n} => $${vals.length}::${t}`);
        });
        const q = meta.ret === "void" ? `select public.${fn}(${partes.join(", ")}) is null as r` : `select to_jsonb(public.${fn}(${partes.join(", ")})) as r`;
        try {
          const r = await como(sub, ip, c => c.query(q, vals));
          return meta.ret === "void" ? json(204) : json(200, r.rows[0].r);
        } catch (e) { return json(400, { message: e.message, code: e.code }); }
      }
      if (url.pathname === "/functions/v1/sintonia-conta") {
        // a função de verdade (chave + usuário do Auth), imitada com as mesmas rpcs do banco
        const b = JSON.parse(corpo); PEDIDOS.contas.push(b);
        const sr = async (q, v) => { const c = await pool.connect(); try { await c.query("set role service_role"); return (await c.query(q, v)).rows[0]; } finally { await c.query("reset role"); c.release(); } };
        const senha = k => { const x = k.toUpperCase().replace(/[^0-9A-Z]/g, ""); return "Sn!" + x + x.toLowerCase(); };
        if (b.acao === "criar") {
          const k = (await sr("select sin_chave_nova() k")).k;
          const id = (await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [k.email, { nome: b.nome, origem: "sintonia" }])).rows[0].id;
          await sr("select sin_conta_auditar($1, 'sintonia_conta_criada')", [id]);
          SENHAS.set(k.email, senha(k.chave)); return json(200, { ok: true, ...k, id });
        }
        if (b.acao === "entrar") {
          const e = (await sr("select sin_chave_email($1) e", [b.chave])).e;
          return e ? json(200, { ok: true, email: e }) : json(400, { ok: false, mensagem: "Chave inválida: são 12 letras e números, como K7QM-4XPA-9TRD." });
        }
        if (b.acao === "converter") {
          if (!sub) return json(401, { ok: false, mensagem: "Entre no NVSintonia para trocar o e-mail pela chave." });
          const k = (await sr("select sin_chave_nova() k")).k;
          await pool.query("update auth.users set email = $1 where id = $2", [k.email, sub]);
          await sr("select sin_perfil_email($1, $2)", [sub, k.email]);
          await sr("select sin_conta_auditar($1, 'sintonia_email_trocado_por_chave')", [sub]);
          SENHAS.set(k.email, senha(k.chave)); return json(200, { ok: true, ...k });
        }
        return json(400, { ok: false, mensagem: "Ação desconhecida." });
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
        const b = JSON.parse(corpo), u = (await pool.query("select id, email from auth.users where email = $1", [b.email])).rows[0];
        if (!u || SENHAS.get(b.email) !== b.password) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials", code: "invalid_credentials" });
        return json(200, sessao(u.id, u.email));
      }
      if (url.pathname === "/auth/v1/otp") { PEDIDOS.otp.push({ corpo: JSON.parse(corpo), redirect: url.searchParams.get("redirect_to") }); return json(200, {}); }
      if (url.pathname.startsWith("/auth/v1/")) return json(200, {});
      // site estático (config.js apontando para esta ponte)
      if (url.pathname === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(`window.NERVIA_CONFIG = { SUPABASE_URL: "${BASE}", SUPABASE_ANON_KEY: "anon" };`); }
      let arq = path.join(SITE, decodeURIComponent(url.pathname)); if (arq.endsWith("/")) arq += "index.html";
      if (!arq.startsWith(SITE) || !fs.existsSync(arq)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": tipos[path.extname(arq)] || "application/octet-stream" }); res.end(fs.readFileSync(arq));
    } catch (e) { json(500, { message: String(e) }); }
  });
}

function token(uid) {
  const b = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: uid, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
}
function sessao(uid, email) {
  return { access_token: token(uid), refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: uid, aud: "authenticated", role: "authenticated", email } };
}
async function pagina(browser, uid, opc = {}) {
  const { email: _e, ...resto } = opc;
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, ...resto });
  if (uid) {
    const s = sessao(uid, opc.email);
    await ctx.addInitScript(`localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(s))});`);
  }
  const pg = await ctx.newPage(), erros = [];
  pg.on("pageerror", e => erros.push(String(e)));
  if (process.env.SUPABASE_JS) await pg.route("**/supabase-js@*/**", r => r.fulfill({ path: process.env.SUPABASE_JS, contentType: "text/javascript" }));
  if (process.env.QRCODE_JS) await pg.route("**/qrcode-generator/**", r => r.fulfill({ path: process.env.QRCODE_JS, contentType: "text/javascript" }));
  await pg.route("**/fonts.googleapis.com/**", r => r.fulfill({ body: "", contentType: "text/css" }));
  await ctx.route("**/sintonia/sw.js", r => r.fulfill({ body: "", contentType: "text/javascript" }));
  return { pg, erros, ctx };
}
const um = async (pool, q, v) => (await pool.query(q, v)).rows[0];
async function estrelas(pg, n, valor, escopo = "") {
  for (let i = 0; i < n; i++) {
    const v = typeof valor === "function" ? valor(i) : valor;
    await pg.click(`${escopo} button[data-i="${i}"][data-v="${v}"]`);
  }
}

(async () => {
  const pool = await prepararBanco(), srv = servidor(pool).listen(PORTA);
  const browser = await chromium.launch();
  const todosErros = [];
  try {
    // ---------- conta nova por CHAVE (sem e-mail): a chave aparece uma vez e só segue com "Anotei"
    const A = await pagina(browser, null, { permissions: ["geolocation", "clipboard-read", "clipboard-write"], geolocation: { latitude: -22.98321, longitude: -43.20111 } });
    const pa = A.pg;
    await pa.goto(BASE + "/sintonia/");
    ok(/Você é um número, não um nome/.test(await pa.textContent("main")), "entrada: explica o anonimato (um número sem nome)");
    ok(!/e-mail/i.test(await pa.textContent("#fCriar")) || /Sem e-mail/.test(await pa.textContent("#fCriar")), "entrada: conta nova pede só o nome, sem e-mail");
    await pa.fill("#eNome", "Ana"); await pa.click("#bCriar");
    await pa.waitForSelector("#kTexto");
    const chave = (await pa.textContent("#kTexto")).trim();
    ok(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(chave), "chave: 12 letras e números em 3 grupos, sem letras confusas");
    ok(/perde a conta/.test(await pa.textContent("main")) && await pa.isDisabled("#bSegue"), "chave: avisa que perder a chave perde a conta; só segue depois de \"Anotei\"");
    await pa.screenshot({ path: path.join(SAIDA, "01-chave.png") });
    await pa.check("#kOk"); await pa.click("#bSegue");
    await pa.waitForSelector("#bMeuQr");
    ok(/Ana · SN-[A-Z0-9]{4}/.test(await pa.textContent("#topoInfo")), "conta criada: entra direto, com o nome e o código do dia");
    const anaUser = await um(pool, "select u.id, u.email, p.email pe from auth.users u join perfis p on p.user_id = u.id where u.email like 's-%'");
    ok(anaUser && /^s-[0-9a-f]{40}@sintonia\.nervia\.com\.br$/.test(anaUser.email) && !(await um(pool, "select 1 from sin_chaves where hash ilike $1", ["%" + chave.replace(/-/g, "") + "%"])),
      "banco: login sem e-mail de verdade e a chave não fica guardada");
    const ANA_ID = anaUser.id;
    ok(/aparece depois das primeiras 5/.test(await pa.textContent("main")), "encontros: sem nota até o primeiro lote de 5");
    ok(/Você na multidão/.test(await pa.textContent("main")) && /aparece quando 10 pessoas/.test(await pa.textContent("main")), "multidão: explica que a comparação aparece com 10 pessoas com nota");
    // sair e voltar com a chave
    await pa.click('#nav [data-aba="conta"]');
    await pa.click("#bVerK"); ok((await pa.textContent("#cK")).trim() === chave, "conta: mostra a chave guardada neste aparelho");
    await pa.click("#bSair"); await pa.waitForSelector("#bSim");
    ok(/chave/.test(await pa.textContent("#dlg")), "sair: lembra de conferir a chave anotada");
    await pa.click("#bSim"); await pa.waitForSelector("#fChave");
    await pa.fill("#eChave", "ABCD-EFGH-2345"); await pa.click("#bChave"); await pa.waitForSelector("#mChave .err");
    ok(/não encontrada/.test(await pa.textContent("#mChave")), "entrar: chave errada não entra");
    await pa.fill("#eChave", chave.toLowerCase().replace(/-/g, " ")); await pa.click("#bChave");
    await pa.waitForSelector("#bMeuQr");
    ok(/Ana · SN-/.test(await pa.textContent("#topoInfo")), "entrar: a mesma chave (com minúsculas e espaços) volta para a mesma conta");
    await pa.click('#nav [data-aba="espelho"]');
    await pa.waitForSelector("#bAuto");
    await pa.click('[data-sug="Família"]');
    await pa.waitForSelector('[data-conv]');
    await pa.click('[data-conv]');
    const msg = await pa.textContent("#dlg p[style]");
    const link = (msg.match(/http\S+#c-[0-9a-f]+/) || [])[0];
    ok(link && /anônimo/.test(msg), "convite: mensagem pronta com o link e o aviso de anonimato");
    ok(/wa\.me\/\?text=/.test(await pa.getAttribute("#dlg a", "href")), "convite: botão do WhatsApp com a mensagem");
    await pa.click("#bFecha");
    // ---------- 5 pessoas respondem pelo link, sem login (cada uma num aparelho)
    for (let k = 1; k <= 5; k++) {
      const P = await pagina(browser, null, k === 1 ? { ...devices["Pixel 7"] } : {});
      IP = 10 + k;
      await P.pg.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
      await P.pg.waitForSelector("#bResp");
      if (k === 1) {
        ok(/Ana pediu a sua opinião/.test(await P.pg.textContent("h1")) && /anônimo/.test(await P.pg.textContent("main")), "convite: abre sem login, com o nome de quem pediu e o aviso de anonimato");
        await P.pg.locator(".tip").first().tap();
        ok(await P.pg.isVisible("#balao") && /Ouvir de verdade/.test(await P.pg.textContent("#balao")) && /Respeito e consideração/.test(await P.pg.textContent("#balao")), "balão: tocar no nome do item mostra o que ele quer dizer (celular)");
        await P.pg.locator("h1").tap();
        ok(!(await P.pg.isVisible("#balao")), "balão: tocar fora fecha");
        ok(await P.pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "convite: sem rolagem lateral no celular");
        await P.pg.screenshot({ path: path.join(SAIDA, "02-convite-celular.png") });
        ok(await P.pg.isDisabled("#bResp"), "convite: enviar só com todos os itens");
      }
      if (k === 1) {
        ok(/como você avalia minha capacidade de ouvir/.test(await P.pg.textContent("main")) && (await P.pg.$$("button.na")).length === 5,
          "convite: as perguntas novas, como o Marco escreveu, com 'Não tenho condições de avaliar' em cada uma");
        await estrelas(P.pg, 5, i => i === 1 ? "na" : (k + i) % 5 + 1);
      } else await estrelas(P.pg, 5, i => (k + i) % 5 + 1);
      await P.pg.click("#bResp");
      await P.pg.waitForSelector("text=Obrigado!");
      if (k === 1) {
        await P.pg.reload(); await P.pg.waitForSelector("text=Obrigado!");
        ok(true, "convite: o mesmo aparelho não responde de novo (abre o obrigado)");
        ok(await P.pg.isVisible("text=Quero o meu também"), "convite: oferece criar o próprio espelho");
      }
      todosErros.push(...P.erros); await P.ctx.close();
    }
    const sr = await um(pool, "select count(*)::int n, bool_and(liberada) l from sin_respostas");
    ok(sr.n === 5 && sr.l, "banco: 5 respostas, lote fechado e liberado");
    // ---------- Ana se avalia e vê o resultado
    await pa.reload(); await pa.click('#nav [data-aba="espelho"]'); await pa.waitForSelector("#bAuto");
    ok(!(await pa.isVisible("text=Como você se vê × como te veem")), "espelho: resultado escondido antes da autoavaliação");
    await pa.hover(".tip >> nth=0");
    ok(await pa.isVisible("#balao") && /Base:/.test(await pa.textContent("#balao")), "balão: passar o mouse mostra o significado e a base");
    ok(/como você avalia a sua capacidade de ouvir/.test(await pa.textContent(".card.g")) && !(await pa.$(".card.g button.na")),
      "autoavaliação: pergunta na voz de quem se avalia, sem 'não tenho condições'");
    await estrelas(pa, 5, 4, ".card.g");
    await pa.click("#bAuto");
    await pa.waitForSelector("text=Como você se vê × como te veem");
    ok(/como te veem \(5\)/.test(await pa.textContent("main")), "espelho: resultado com as 5 respostas");
    ok(/5 respostas no resultado/.test(await pa.textContent("main")), "espelho: círculo mostra as respostas do lote");
    await pa.screenshot({ path: path.join(SAIDA, "03-espelho-pessoal.png"), fullPage: true });
    // ---------- 360°: gestor responde e aparece identificado
    await pa.click('[data-modo="r"]'); await pa.waitForSelector("#bAuto");
    ok((await pa.$$("[data-conv]")).length === 4, "360°: gestor, pares, liderados e clientes internos já criados");
    ok(/Liderança e capacidade de decisão/.test(await pa.textContent(".card.g")) && /como você avalia a sua capacidade de assumir/.test(await pa.textContent(".card.g")) && !(await pa.$(".card.g button.na")),
      "360°: as 5 competências novas, autoavaliação na voz de quem se avalia, sem 'não tenho condições'");
    await estrelas(pa, 5, 4, ".card.g");
    await pa.click("#bAuto"); await pa.waitForSelector("text=Nenhum grupo completou");
    const gest = await um(pool, "select c.codigo from sin_circulos c join sin_espelhos e on e.id = c.espelho_id where e.modelo = 'r' and c.gestor");
    {
      const G = await pagina(browser, null); IP = 30;
      await G.pg.goto(BASE + "/sintonia/#c-" + gest.codigo); await G.pg.waitForSelector("#bResp");
      ok(/aparece identificada/.test(await G.pg.textContent("main")) && /é uma referência/i.test(await G.pg.textContent("main")) && /orientar pessoas na busca por resultados/.test(await G.pg.textContent("main")) && (await G.pg.$$("button.na")).length === 5,
        "360°: o gestor é avisado de que aparece identificado; escala de 0 a 5 com 'Não tenho condições de avaliar'");
      await estrelas(G.pg, 5, i => i === 4 ? "na" : 3);
      await G.pg.click("#bResp"); await G.pg.waitForSelector("text=Obrigado!");
      todosErros.push(...G.erros); await G.ctx.close();
    }
    await pa.reload(); await pa.click('#nav [data-aba="espelho"]'); await pa.click('[data-modo="r"]');
    await pa.waitForSelector("text=Por grupo");
    ok(/Gestor\*/.test(await pa.textContent("table")) && /identificado/.test(await pa.textContent("main")), "360°: relatório por grupo com o gestor identificado");
    await pa.screenshot({ path: path.join(SAIDA, "04-espelho-360.png"), fullPage: true });
    // ---------- encontro pelo QR: Ana mostra, Bia lê
    await pa.click('#nav [data-aba="inicio"]'); await pa.click("#bMeuQr");
    await pa.waitForSelector("#dlg .codigo");
    const cod = (await pa.textContent("#dlg .codigo")).trim();
    ok(/^[0-9A-F]{8}$/.test(cod) && await pa.isVisible("#dlg .qr svg"), "QR: código de 8 letras e o desenho do QR");
    await pa.screenshot({ path: path.join(SAIDA, "05-qr.png") });
    await pa.click("#bFechaQr");
    const B = await pagina(browser, BIA, { email: "bia@exemplo.test", permissions: ["geolocation"], geolocation: { latitude: -22.98410, longitude: -43.20240 } });
    const pb = B.pg;
    await pb.goto(BASE + "/sintonia/#e-" + cod);
    await pb.waitForSelector("#fPerfil"); await pb.fill("#pNome", "Bia"); await pb.click("#fPerfil button");
    await pb.waitForSelector("#mCod .okm");
    ok(/Encontro com Ana registrado/.test(await pb.textContent("#mCod")), "QR: quem lê o QR (mesmo antes de criar o perfil) registra o encontro");
    await pb.click('[data-ficha]'); await pb.waitForSelector("#bEnviaF");
    ok(/capacidade dessa pessoa/.test(await pb.textContent("#dlg")), "encontro: pergunta sobre essa pessoa");
    await estrelas(pb, 5, 5, "#dlg"); await pb.click("#bEnviaF");
    ok(await pb.waitForSelector("[data-ficha]", { state: "detached", timeout: 5000 }).then(() => true, () => false), "encontro: avaliação enviada e a ficha some");
    const en = await um(pool, "select count(*)::int n from sin_enc_notas where alvo = $1", [ANA_ID]);
    ok(en.n === 1, "banco: nota do encontro guardada para a Ana (sem quem deu)");
    await pa.reload(); await pa.waitForSelector("[data-ficha]");
    ok(/Bia/.test(await pa.textContent(".card.g")), "encontro: a Ana também tem a ficha para avaliar a Bia");
    // ---------- mapa: quem vê, aparece
    await pb.click('#nav [data-aba="mapa"]'); await pb.click("#bLiga"); await pb.waitForSelector("#mapa");
    await pa.click('#nav [data-aba="mapa"]'); await pa.waitForSelector("#bLiga");
    ok(/quem vê, aparece/.test(await pa.textContent("main")), "mapa: explica que para ver é preciso aparecer");
    await pa.click("#bLiga"); await pa.waitForSelector("#lista button");
    const lista = await pa.textContent("#lista");
    ok(/SN-[A-Z0-9]{4}/.test(lista) && /sem nota ainda/.test(lista) && !/Bia/.test(lista), "mapa: a Bia aparece pelo código do dia, sem nome, ainda sem nota");
    await pa.screenshot({ path: path.join(SAIDA, "06-mapa.png") });
    const pos = await um(pool, "select lat::text, lon::text from sin_posicoes where user_id = $1", [ANA_ID]);
    ok(pos.lat === "-22.983" && pos.lon === "-43.201", "mapa: o banco guarda só a quadra");
    await pa.click("#bDesliga"); await pa.waitForSelector("#bLiga");
    ok(!(await um(pool, "select 1 from sin_posicoes where user_id = $1", [ANA_ID])), "mapa: ficar invisível apaga a posição");
    // ---------- você na multidão com 10+ pessoas com nota
    await pool.query(`insert into auth.users (id, email) select ('63000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'x' || i || '@t' from generate_series(1, 11) i;
      insert into sin_pessoas (user_id, nome) select ('63000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'X' || i from generate_series(1, 11) i;
      insert into sin_enc_notas (alvo, notas, liberada) select ('63000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, array_fill((1 + i % 5)::smallint, array[5]), true from generate_series(1, 11) i, generate_series(1, 5)`);
    await pool.query(`insert into sin_enc_notas (alvo, notas, liberada) select $1, '{4,4,4,4,4}', true from generate_series(1, 5)`, [ANA_ID]);
    await pa.click('#nav [data-aba="inicio"]'); await pa.waitForSelector("text=das pessoas têm nota menor");
    ok(/\d+%/.test(await pa.textContent("main")) && !/X\d|63000000/.test(await pa.textContent("main")), "multidão: mostra o percentil e as faixas, sem nome de ninguém");
    await pa.screenshot({ path: path.join(SAIDA, "07-multidao.png"), fullPage: true });
    // ---------- quem entrou pelo e-mail (1.0) troca o e-mail por uma chave
    await pb.click('#nav [data-aba="conta"]'); await pb.waitForSelector("#bConv");
    await pb.click("#bConv"); await pb.waitForSelector("#kTexto");
    const chaveB = (await pb.textContent("#kTexto")).trim();
    ok(/e-mail foi apagado/.test(await pb.textContent("main")), "conversão: avisa que o e-mail saiu e os dados ficam");
    await pb.check("#kOk"); await pb.click("#bSegue"); await pb.waitForSelector("#bVerK");
    const bu = await um(pool, "select u.email, p.email pe from auth.users u join perfis p on p.user_id = u.id where u.id = $1", [BIA]);
    ok(/@sintonia\.nervia\.com\.br$/.test(bu.email) && bu.pe === bu.email && !!(await um(pool, "select 1 from sin_pessoas where user_id = $1", [BIA])),
      "conversão: e-mail real apagado do login e do perfil; mesma conta, dados mantidos");
    ok(!!(await um(pool, "select 1 from auditoria where acao = 'sintonia_email_trocado_por_chave' and user_id = $1", [BIA])), "conversão: registrada na auditoria");
    await pb.click("#bVerK"); ok((await pb.textContent("#cK")).trim() === chaveB, "conversão: a chave nova fica na Conta deste aparelho");
    // ---------- conta: apagar tudo
    await pa.click('#nav [data-aba="conta"]'); await pa.click("#bApaga"); await pa.click("#bSim");
    await pa.waitForSelector("#fPerfil");
    ok(!(await um(pool, "select 1 from sin_pessoas where user_id = $1", [ANA_ID])), "conta: apagar tudo remove os dados e volta para criar o perfil");
    ok(await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "sem rolagem lateral");
    todosErros.push(...A.erros, ...B.erros);
    ok(todosErros.length === 0, "nenhum erro de script nas páginas" + (todosErros.length ? ": " + todosErros.join(" | ") : ""));
  } catch (e) { falhas++; console.log("FALHOU  " + (e.stack || e)); try { for (const pg of browser.contexts().flatMap(c => c.pages())) console.log("TELA:", (await pg.textContent("main")).slice(0, 300), "ERROS:", ""); } catch {} }
  await browser.close(); srv.close(); await pool.end();
  console.log(`\n${oks} ok, ${falhas} falha(s). Prints em ${SAIDA}`);
  process.exit(falhas ? 1 : 0);
})();
