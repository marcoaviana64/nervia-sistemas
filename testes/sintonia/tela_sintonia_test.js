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
const PEDIDOS = { contas: [], otp: [] };
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
      if (url.pathname === "/functions/v1/sintonia-conta") { PEDIDOS.contas.push(JSON.parse(corpo)); return json(200, { ok: true }); }
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
async function pagina(browser, uid, opc = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, ...opc });
  if (uid) {
    const s = { access_token: token(uid), refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: "authenticated", role: "authenticated" } };
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
    // ---------- entrar (sem conta): pede a conta à função e o link por e-mail, sem criar usuário pelo Auth
    {
      const { pg, erros, ctx } = await pagina(browser, null);
      await pg.goto(BASE + "/sintonia/");
      await pg.fill("#eNome", "Caio"); await pg.fill("#eEmail", "Caio@Exemplo.test");
      await pg.click("#bEntrar");
      await pg.waitForSelector("#mEntrar .okm");
      ok(PEDIDOS.contas[0]?.email === "caio@exemplo.test" && PEDIDOS.contas[0]?.nome === "Caio", "entrar: pede a conta à função sintonia-conta com nome e e-mail");
      const otp = PEDIDOS.otp[0];
      ok(otp && otp.corpo.create_user === false && /\/sintonia\/$/.test(otp.redirect || ""), "entrar: link de entrada sem criar usuário pelo Auth e voltando para /sintonia/");
      await pg.screenshot({ path: path.join(SAIDA, "01-entrar.png") });
      todosErros.push(...erros); await ctx.close();
    }
    // ---------- Ana: perfil, círculo, convite
    const A = await pagina(browser, ANA, { permissions: ["geolocation"], geolocation: { latitude: -22.98321, longitude: -43.20111 } });
    const pa = A.pg;
    await pa.goto(BASE + "/sintonia/");
    await pa.waitForSelector("#fPerfil");
    ok(await pa.inputValue("#pNome") === "Ana Lima", "perfil: nome vem do login");
    await pa.fill("#pNome", "Ana"); await pa.click("#fPerfil button");
    await pa.waitForSelector("#bMeuQr");
    ok(/Ana · SN-[A-Z0-9]{4}/.test(await pa.textContent("#topoInfo")), "perfil criado: topo com o nome e o código do dia");
    ok(/aparece depois das primeiras 5/.test(await pa.textContent("main")), "encontros: sem nota até o primeiro lote de 5");
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
        ok(await P.pg.isVisible("#balao") && /Calor humano/.test(await P.pg.textContent("#balao")), "balão: tocar no nome do item mostra o que ele quer dizer (celular)");
        await P.pg.locator("h1").tap();
        ok(!(await P.pg.isVisible("#balao")), "balão: tocar fora fecha");
        ok(await P.pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "convite: sem rolagem lateral no celular");
        await P.pg.screenshot({ path: path.join(SAIDA, "02-convite-celular.png") });
        ok(await P.pg.isDisabled("#bResp"), "convite: enviar só com todos os itens");
      }
      await estrelas(P.pg, 5, i => (k + i) % 5 + 1);
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
    await estrelas(pa, 5, 4, ".card.g");
    await pa.click("#bAuto");
    await pa.waitForSelector("text=Como você se vê × como te veem");
    ok(/como te veem \(5\)/.test(await pa.textContent("main")), "espelho: resultado com as 5 respostas");
    ok(/5 respostas no resultado/.test(await pa.textContent("main")), "espelho: círculo mostra as respostas do lote");
    await pa.screenshot({ path: path.join(SAIDA, "03-espelho-pessoal.png"), fullPage: true });
    // ---------- 360°: gestor responde e aparece identificado
    await pa.click('[data-modo="r"]'); await pa.waitForSelector("#bAuto");
    ok((await pa.$$("[data-conv]")).length === 4, "360°: gestor, pares, liderados e clientes internos já criados");
    await estrelas(pa, 10, i => (i === 5 || i === 6) ? "na" : 4, ".card.g");
    await pa.click("#bAuto"); await pa.waitForSelector("text=Nenhum grupo completou");
    const gest = await um(pool, "select c.codigo from sin_circulos c join sin_espelhos e on e.id = c.espelho_id where e.modelo = 'r' and c.gestor");
    {
      const G = await pagina(browser, null); IP = 30;
      await G.pg.goto(BASE + "/sintonia/#c-" + gest.codigo); await G.pg.waitForSelector("#bResp");
      ok(/aparece identificada/.test(await G.pg.textContent("main")) && /Com que frequência/.test(await G.pg.textContent("main")), "360°: o gestor é avisado de que aparece identificado; escala de frequência");
      await estrelas(G.pg, 10, i => i === 5 ? "na" : 3);
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
    const B = await pagina(browser, BIA, { permissions: ["geolocation"], geolocation: { latitude: -22.98410, longitude: -43.20240 } });
    const pb = B.pg;
    await pb.goto(BASE + "/sintonia/#e-" + cod);
    await pb.waitForSelector("#fPerfil"); await pb.fill("#pNome", "Bia"); await pb.click("#fPerfil button");
    await pb.waitForSelector("#mCod .okm");
    ok(/Encontro com Ana registrado/.test(await pb.textContent("#mCod")), "QR: quem lê o QR (mesmo antes de criar o perfil) registra o encontro");
    await pb.click('[data-ficha]'); await pb.waitForSelector("#bEnviaF");
    await estrelas(pb, 5, 5, "#dlg"); await pb.click("#bEnviaF");
    ok(await pb.waitForSelector("[data-ficha]", { state: "detached", timeout: 5000 }).then(() => true, () => false), "encontro: avaliação enviada e a ficha some");
    const en = await um(pool, "select count(*)::int n from sin_enc_notas where alvo = $1", [ANA]);
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
    const pos = await um(pool, "select lat::text, lon::text from sin_posicoes where user_id = $1", [ANA]);
    ok(pos.lat === "-22.983" && pos.lon === "-43.201", "mapa: o banco guarda só a quadra");
    await pa.click("#bDesliga"); await pa.waitForSelector("#bLiga");
    ok(!(await um(pool, "select 1 from sin_posicoes where user_id = $1", [ANA])), "mapa: ficar invisível apaga a posição");
    // ---------- conta: apagar tudo
    await pa.click('#nav [data-aba="conta"]'); await pa.click("#bApaga"); await pa.click("#bSim");
    await pa.waitForSelector("#fPerfil");
    ok(!(await um(pool, "select 1 from sin_pessoas where user_id = $1", [ANA])), "conta: apagar tudo remove os dados e volta para criar o perfil");
    ok(await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "sem rolagem lateral");
    todosErros.push(...A.erros, ...B.erros);
    ok(todosErros.length === 0, "nenhum erro de script nas páginas" + (todosErros.length ? ": " + todosErros.join(" | ") : ""));
  } catch (e) { falhas++; console.log("FALHOU  " + (e.stack || e)); }
  await browser.close(); srv.close(); await pool.end();
  console.log(`\n${oks} ok, ${falhas} falha(s). Prints em ${SAIDA}`);
  process.exit(falhas ? 1 : 0);
})();
