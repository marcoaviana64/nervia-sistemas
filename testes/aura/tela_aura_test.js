// Teste de ponta a ponta do NVAura (site/aura/) com a TELA real e o BANCO real: Postgres com todas as migrações e uma ponte
// mínima no lugar do PostgREST (a mesma do teste do NVSintonia), que roda cada rpc como anon ou authenticated com o usuário
// do token — as regras das funções aur_* valem de verdade. Pessoas FICTÍCIAS.
//
// Precisa de: Postgres por TCP (PGHOST/PGPORT/PGUSER/PGPASSWORD), o pacote "pg" (NODE_PATH), Playwright, e cópias locais do
// supabase-js 2.117.2 (SUPABASE_JS) e do qrcode-generator 1.4.4 (QRCODE_JS) quando o CDN estiver bloqueado.
// Uso: PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=… SUPABASE_JS=… QRCODE_JS=… NODE_PATH=… node testes/aura/tela_aura_test.js [pasta_prints]
const path = require("path"), fs = require("fs"), http = require("http"), os = require("os"), { execFileSync } = require("child_process");
const { chromium, devices } = require("playwright");
const { Pool } = require("pg");
const RAIZ = path.resolve(__dirname, "..", ".."), SITE = path.join(RAIZ, "site");
const SAIDA = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "aura-"));
const PORTA = 8847, DB = "teste_aura", BASE = `http://127.0.0.1:${PORTA}`;
const BIA = "71000000-0000-0000-0000-000000000002", ADM = "71000000-0000-0000-0000-00000000000a";
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
  await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'bia@exemplo.test', '{"nome":"Bia"}'), ($2, 'equipe@nervia.test', '{"nome":"Equipe"}')`, [BIA, ADM]);
  await pool.query("update perfis set admin = true where user_id = $1", [ADM]);
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
          const app = b.app === "aura" ? "aura" : "sintonia";
          const id = (await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [k.email, { nome: b.nome, origem: app }])).rows[0].id;
          await sr("select sin_conta_auditar($1, $2)", [id, app + "_conta_criada"]);
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
        if (b.acao === "nova_chave") {
          if (!sub) return json(401, { ok: false, mensagem: "Entre na sua conta para gerar uma chave nova." });
          const k = (await sr("select sin_chave_nova() k")).k;
          await pool.query("update auth.users set email = $1 where id = $2", [k.email, sub]);
          await sr("select sin_conta_auditar($1, $2)", [sub, (b.app === "aura" ? "aura" : "sintonia") + "_chave_trocada"]);
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
  const { email: _e, chave = "sb-127-auth-token", ...resto } = opc;   // chave = onde a sessão fica guardada
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, ...resto });
  if (uid) {
    const s = sessao(uid, opc.email);
    await ctx.addInitScript(`localStorage.setItem(${JSON.stringify(chave)}, ${JSON.stringify(JSON.stringify(s))});`);
  }
  const pg = await ctx.newPage(), erros = [];
  pg.on("pageerror", e => erros.push(String(e)));
  if (process.env.SUPABASE_JS) await pg.route("**/supabase-js@*/**", r => r.fulfill({ path: process.env.SUPABASE_JS, contentType: "text/javascript" }));
  if (process.env.QRCODE_JS) await pg.route("**/qrcode-generator/**", r => r.fulfill({ path: process.env.QRCODE_JS, contentType: "text/javascript" }));
  await pg.route("**/fonts.googleapis.com/**", r => r.fulfill({ body: "", contentType: "text/css" }));
  await ctx.route("**/aura/sw.js", r => r.fulfill({ body: "", contentType: "text/javascript" }));
  return { pg, erros, ctx };
}
const um = async (pool, q, v) => (await pool.query(q, v)).rows[0];
async function estrelas(pg, n, valor, escopo = "") {
  for (let i = 0; i < n; i++) {
    const v = typeof valor === "function" ? valor(i) : valor;
    await pg.click(`${escopo} button[data-i="${i}"][data-v="${v}"]`);
  }
}

const semRolagem = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

(async () => {
  const pool = await prepararBanco(), srv = servidor(pool).listen(PORTA);
  const browser = await chromium.launch();
  const todosErros = [];
  try {
    // ---------- Ana cria a conta (chave) e o cartão com foto
    const A = await pagina(browser, null, { geolocation: { latitude: -22.9012, longitude: -43.2012 }, permissions: ["geolocation"] });
    const pa = A.pg;
    await pa.goto(BASE + "/aura/"); await pa.waitForSelector("#fCriar");
    ok(/Você é um número/.test(await pa.textContent("main")), "entrada: explica o anonimato");
    await pa.fill("#eNome", "Ana Lima"); await pa.click("#bCriar");
    await pa.waitForSelector("text=Guarde a sua chave de acesso");
    let chave = (await pa.textContent(".codigo")).trim();
    ok(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(chave) && PEDIDOS.contas[0].app === "aura", "conta: chave criada pela função de conta com app aura");
    ok(await pa.isDisabled("#bSegue"), "chave: só segue depois de marcar Guardei");
    ok(/em outro celular, no computador/.test(await pa.textContent("main")) && /não serve para entrar/.test(await pa.textContent("main")), "chave: explica que é o acesso em outro aparelho e que o código do radar não é a chave");
    const [baixado] = await Promise.all([pa.waitForEvent("download"), pa.click("#bArqK")]);
    const conteudo = fs.readFileSync(await baixado.path(), "utf8");
    ok(baixado.suggestedFilename() === "minha-chave-nvaura.txt" && conteudo.includes(chave), "chave: Salvar num arquivo baixa um .txt com a chave");
    await pa.screenshot({ path: path.join(SAIDA, "00-chave.png"), fullPage: true });
    await pa.check("#kOk"); await pa.click("#bSegue");
    await pa.waitForSelector("text=Monte o seu cartão");
    ok(await pa.inputValue("#fNome") === "Ana Lima", "cartão: nome já preenchido");
    await pa.setInputFiles("#fFoto", path.join(SITE, "aura", "icone-512.png"));
    await pa.waitForSelector("text=Foto pronta");
    await pa.click("#bSalva"); await pa.waitForSelector("#meuCartao");
    const c1 = await um(pool, "select c.*, length(c.foto) as tam from aur_cartoes c join auth.users u on u.id = c.user_id where c.nome = 'Ana Lima'");
    ok(c1 && /^data:image\/(webp|jpeg);base64,/.test(c1.foto) && c1.tam <= 60000, `foto reduzida no celular antes de enviar (${c1 && Math.round(c1.tam * 0.75 / 1024)} KB)`);
    ok(!!(await um(pool, "select 1 from auditoria where acao = 'aura_conta_criada'")) && !!(await um(pool, "select 1 from auditoria where acao = 'aura_cartao_criado'")), "auditoria: conta e cartão");
    ok((await pa.textContent("#topoInfo")).trim() === "Ana Lima", "topo: mostra o nome, não o código do dia");
    ok(/Para entrar em outro aparelho/.test(await pa.textContent("main")) && !(await pa.textContent("main")).includes(chave), "cartão: lembrete da chave, sem mostrar a chave");
    await pa.click("#bVerChave"); await pa.waitForSelector("#dlg[open] #dK");
    ok((await pa.textContent("#dK")).trim() === chave, "Ver a minha chave: mostra a chave na hora, numa janela");
    await pa.click("#dFecha");
    await pa.evaluate(() => localStorage.removeItem("aur-chave"));
    await pa.click("#bVerChave"); await pa.waitForSelector("#dlg[open]");
    ok(/não está neste aparelho/.test(await pa.textContent("#dlg")) && /onde você anotou/.test(await pa.textContent("#dlg")), "Ver a minha chave sem a chave guardada: explica onde ela está");
    // sem a chave e dentro da conta: gerar uma chave nova (mesma conta, cartão e dados)
    await pa.click("#dNova"); await pa.click("#cSim"); await pa.waitForSelector("text=Guarde a sua chave de acesso");
    const chave2 = (await pa.textContent(".codigo")).trim();
    ok(chave2 !== chave && /^[2-9A-HJ-NP-Z]{4}-/.test(chave2) && (await pa.evaluate(() => localStorage.getItem("aur-chave"))) === chave2, "chave nova: aparece na tela da chave e já fica guardada no aparelho");
    await pa.check("#kOk"); await pa.click("#bSegue"); await pa.waitForSelector("#meuCartao");
    ok(/Ana Lima/.test(await pa.textContent("#meuCartao")) && !!(await um(pool, "select 1 from auditoria where acao = 'aura_chave_trocada'")), "chave nova: mesmo cartão, troca na auditoria");
    chave = chave2;
    const txt = await pa.textContent("#meuCartao");
    ok(/Ana Lima/.test(txt) && /0 avaliações de 0 pedidos/.test(txt) && /A nota aparece quando juntar 5/.test(txt) && !!(await pa.$("#meuCartao .qr svg")) && !!(await pa.$("#meuCartao .ft img")), "cartão: foto, nome, sem nota ainda e QR");
    await pa.screenshot({ path: path.join(SAIDA, "01-cartao.png"), fullPage: true });
    const cod = c1.codigo;

    // ---------- 5 pessoas leem o QR e avaliam (sem conta)
    const notas = [5, 4, 5, 3, 4];
    for (let i = 0; i < notas.length; i++) {
      IP = 20 + i;
      const V = await pagina(browser, null);
      await V.pg.goto(BASE + "/aura/#a-" + cod); await V.pg.waitForSelector("#bEnvia");
      if (i === 0) {
        ok(/Como foi a nossa interação/.test(await V.pg.textContent("main")) && /Ana Lima/.test(await V.pg.textContent("#meuCartao")) && !(await V.pg.$("#meuCartao .qr")),
          "quem lê o QR: vê o cartão (sem o QR) e só a pergunta da interação");
        ok(await V.pg.isDisabled("#bEnvia"), "avaliar: enviar só depois de escolher as estrelas");
        ok(/0 avaliações/.test(await V.pg.textContent("#meuCartao")) && !/pedido/.test(await V.pg.textContent("#meuCartao")), "quem avalia vê quantas avaliações, sem os pedidos (só do dono)");
        await V.pg.screenshot({ path: path.join(SAIDA, "02-avaliar.png"), fullPage: true });
      }
      await V.pg.click(`.grandes button[data-v="${notas[i]}"]`);
      if (i === 0) ok((await V.pg.textContent("#rot")) === "Foi incrível", "avaliar: cada nota tem um texto");
      await V.pg.click("#bEnvia"); await V.pg.waitForSelector("text=Obrigado pela avaliação!");
      if (i === 0) {
        ok(/Criar o meu cartão/.test(await V.pg.textContent("main")), "obrigado: convite para criar o próprio cartão");
        await V.pg.screenshot({ path: path.join(SAIDA, "03-obrigado.png"), fullPage: true });
        await V.pg.goto(BASE + "/aura/#a-" + cod); await V.pg.waitForSelector("#bEnvia");
        await V.pg.click('.grandes button[data-v="1"]'); await V.pg.click("#bEnvia"); await V.pg.waitForSelector(".err");
        ok(/já avaliou este cartão hoje/.test(await V.pg.textContent(".err")), "avaliar: o mesmo celular avalia o mesmo cartão 1 vez por dia");
        // o convite leva à criação do cartão
        await V.pg.goto(BASE + "/aura/"); await V.pg.waitForSelector("#fCriar");
        ok(true, "obrigado → criar o meu cartão abre a entrada");
      }
      if (i === 3) {
        await pa.reload(); await pa.waitForSelector("#meuCartao");
        const t4 = await pa.textContent("#meuCartao");
        ok(/4 avaliações de 4 pedidos/.test(t4) && (await pa.$$("#meuCartao .est i.on")).length === 0, "1.6: o dono vê 4 avaliações de 4 pedidos; a nota ainda não aparece (lote)");
      }
      todosErros.push(...V.erros); await V.ctx.close();
    }
    await pa.reload(); await pa.waitForSelector("#meuCartao");
    const t2 = await pa.textContent("#meuCartao");
    ok(/4,2/.test(t2) && /5 avaliações de 5 pedidos/.test(t2) && (await pa.$$("#meuCartao .est i.on")).length === 4, "lote fechado: nota 4,2, 5 avaliações e 4 estrelas cheias");
    ok(!(await um(pool, "select 1 from information_schema.columns where table_name = 'aur_notas' and column_name in ('ip','marca','autor','em')")), "a nota não guarda autor, hora nem aparelho");
    await pa.screenshot({ path: path.join(SAIDA, "04-cartao-com-nota.png"), fullPage: true });

    // ---------- QR grande e impressão
    await pa.click("#bQr"); await pa.waitForSelector("#dlg[open] svg");
    ok((await pa.textContent("#dlg .codigo")).trim() === cod, "QR grande com o código embaixo");
    await pa.click("#bFecha");
    await pa.evaluate(() => { window.print = () => { window.__impresso = true; }; });
    await pa.click("#bImp");
    await pa.emulateMedia({ media: "print" });
    const impr = await pa.evaluate(() => { const r = document.getElementById("impr").getBoundingClientRect(); return { w: r.width, h: r.height, main: getComputedStyle(document.getElementById("tela")).display, svg: !!document.querySelector("#impr svg"), img: !!document.querySelector("#impr img"), txt: document.getElementById("impr").textContent }; });
    ok(await pa.evaluate(() => window.__impresso) && impr.main === "none" && impr.svg && impr.img && Math.abs(impr.w - 321) < 4 && Math.abs(impr.h - 208) < 4 && /Ana Lima/.test(impr.txt) && !/4,2/.test(impr.txt),
      `impressão: só o cartão de visita 85 × 55 mm com foto, nome e QR, sem a nota (${Math.round(impr.w)}×${Math.round(impr.h)} px)`);
    await pa.screenshot({ path: path.join(SAIDA, "05-impressao.png"), clip: { x: 0, y: 0, width: 330, height: 215 } });
    await pa.emulateMedia({ media: "screen" });

    // ---------- o próprio QR
    await pa.goto(BASE + "/aura/#a-" + cod); await pa.waitForSelector("text=Este é o seu cartão");
    ok(!(await pa.$("#bEnvia")), "ler o próprio QR: não deixa se avaliar");
    await pa.click("#bIr"); await pa.waitForSelector("#bQr");

    // ---------- radar: Bia cria o cartão (sem foto) e aparece; Ana vê só o código e a nota
    const B = await pagina(browser, BIA, { email: "bia@exemplo.test", chave: "nvaura-auth", geolocation: { latitude: -22.9030, longitude: -43.2030 }, permissions: ["geolocation"] });
    await B.pg.goto(BASE + "/aura/"); await B.pg.waitForSelector("text=Monte o seu cartão");
    ok(await B.pg.inputValue("#fNome") === "Bia", "login que já existia: nome do perfil já preenchido");
    await B.pg.click("#bSalva"); await B.pg.waitForSelector("#meuCartao");
    ok((await B.pg.textContent("#meuCartao .ft span")).trim() === "B", "sem foto: iniciais no lugar");
    await B.pg.click('#nav [data-aba="mapa"]'); await B.pg.click("#bLiga"); await B.pg.waitForSelector("#mapa");
    await pa.click('#nav [data-aba="mapa"]');
    ok(/quem vê, aparece/.test(await pa.textContent("main")), "radar: explica que para ver é preciso aparecer");
    await pa.click("#bLiga"); await pa.waitForSelector(".lista button");
    const lt = await pa.textContent("#lista");
    ok(/AU-[A-Z0-9]{4}/.test(lt) && !/Bia/.test(lt) && /sem nota ainda/.test(lt) && /~300 m/.test(lt), "radar: Bia aparece só pelo código do dia, a distância e a nota");
    ok(await pa.evaluate(() => document.querySelectorAll("#mapa radialGradient").length === 1), "radar: brilho (mapa de calor) na cor da nota");
    await pa.screenshot({ path: path.join(SAIDA, "06-radar.png"), fullPage: true });
    await B.pg.reload(); await B.pg.click('#nav [data-aba="mapa"]'); await B.pg.waitForSelector(".lista button");
    ok(/4,2/.test(await B.pg.textContent("#lista")) && !/Ana/.test(await B.pg.textContent("main")), "radar: Bia vê a nota da Ana, sem o nome");
    const pos = await um(pool, "select lat::text, lon::text from aur_posicoes where user_id = $1", [BIA]);
    ok(pos.lat === "-22.903" && pos.lon === "-43.203", "radar: o banco guarda só a quadra");
    todosErros.push(...B.erros); await B.ctx.close();

    // ---------- 1.9: estar entrado na Área do Cliente NÃO abre o NVAura com a conta da Nervia
    {
      const E = await pagina(browser, ADM, { email: "equipe@nervia.test" });
      await E.pg.goto(BASE + "/aura/"); await E.pg.waitForSelector("#fCriar");
      ok(!(await um(pool, "select 1 from aur_cartoes where user_id = $1", [ADM])), "isolamento: com a sessão da Área do Cliente, o NVAura abre na entrada (sem usar a conta da Nervia)");
      await E.pg.goto(BASE + "/apps/aura/"); await E.pg.waitForSelector(".kpis");
      ok(true, "isolamento: a gestão continua usando o login da Área do Cliente");
      todosErros.push(...E.erros); await E.ctx.close();
    }

    // ---------- 1.7: gestão (login do ecossistema, só equipe Nervia) e moderação
    {
      const X = await pagina(browser, BIA, { email: "bia@exemplo.test" });
      await X.pg.goto(BASE + "/apps/aura/"); await X.pg.waitForSelector("text=Gestão só da equipe Nervia");
      ok(true, "gestão: login comum (sem ser da equipe Nervia) não abre");
      todosErros.push(...X.erros); await X.ctx.close();
      const G = await pagina(browser, ADM, { email: "equipe@nervia.test", viewport: { width: 1200, height: 900 } });
      await G.pg.goto(BASE + "/apps/aura/"); await G.pg.waitForSelector(".kpis");
      const kt = await G.pg.textContent(".kpis");
      ok(/2\s*pessoas com cartão/.test(kt) && /5\s*avaliações/.test(kt) && /4,2/.test(kt), "gestão: pessoas, avaliações e nota média");
      ok(/Ana Lima/.test(await G.pg.textContent("main, body")) && (await G.pg.$$(".colunas .d")).length === 30, "gestão: mais avaliados e gráfico de 30 dias");
      await G.pg.screenshot({ path: path.join(SAIDA, "07-gestao.png"), fullPage: true });
      await G.pg.click('.aba[data-v="cartoes"]'); await G.pg.waitForSelector("[data-bloq]");
      const anaId = (await um(pool, "select user_id from aur_cartoes where nome = 'Ana Lima'")).user_id;
      await G.pg.click(`[data-bloq="${anaId}"]`); await G.pg.click("#dSim"); await G.pg.waitForSelector("#dM .msg.err");
      ok(/motivo/.test(await G.pg.textContent("#dM")), "gestão: bloquear sem motivo é recusado");
      await G.pg.fill("#mot", "teste de moderação"); await G.pg.click("#dSim"); await G.pg.waitForSelector(`[data-desb="${anaId}"]`);
      ok(/bloqueado: teste de moderação/.test(await G.pg.textContent("#tela")), "gestão: cartão bloqueado com o motivo");
      await G.pg.screenshot({ path: path.join(SAIDA, "08-gestao-cartoes.png"), fullPage: true });
      const V3 = await pagina(browser, null); IP = 50;
      await V3.pg.goto(BASE + "/aura/#a-" + cod); await V3.pg.waitForSelector("text=Cartão indisponível");
      ok(!/Ana Lima/.test(await V3.pg.textContent("main")), "bloqueado: quem lê o QR vê \"indisponível\", sem nome nem foto");
      todosErros.push(...V3.erros); await V3.ctx.close();
      await pa.reload(); await pa.waitForSelector("text=Seu cartão está bloqueado");
      ok(/teste de moderação/.test(await pa.textContent("main")), "bloqueado: o dono vê o aviso e o motivo");
      await G.pg.click(`[data-desb="${anaId}"]`); await G.pg.fill("#mot", "revisado"); await G.pg.click("#dSim"); await G.pg.waitForSelector(`[data-bloq="${anaId}"]`);
      ok(!!(await um(pool, "select 1 from auditoria where acao = 'aura_cartao_bloqueado'")) && !!(await um(pool, "select 1 from auditoria where acao = 'aura_cartao_desbloqueado'")), "gestão: bloqueio e desbloqueio na auditoria");
      todosErros.push(...G.erros); await G.ctx.close();
      await pa.reload(); await pa.waitForSelector("#meuCartao .qr svg");
      const S = await pagina(browser, null);
      await S.pg.goto(BASE + "/aura/sobre.html"); await S.pg.waitForSelector("text=Inspirado em");
      ok(/Queda Livre/.test(await S.pg.textContent("body")) && /Ninguém sabe quem deu cada nota/.test(await S.pg.textContent("body")) && await semRolagem(S.pg), "página de apresentação: como funciona, anonimato e Queda Livre, sem rolagem lateral");
      await S.pg.screenshot({ path: path.join(SAIDA, "09-sobre.png"), fullPage: true });
      todosErros.push(...S.erros); await S.ctx.close();
    }

    // ---------- 1.8: denúncia (3 celulares denunciam a foto → some; a gestão decide)
    {
      for (let i = 0; i < 3; i++) {
        IP = 60 + i;
        const D = await pagina(browser, null);
        await D.pg.goto(BASE + "/aura/#a-" + cod); await D.pg.waitForSelector("#lDen");
        await D.pg.click("#lDen"); await D.pg.waitForSelector("#dlg[open] #dEnv");
        if (i === 0) {
          await D.pg.click("#dEnv"); await D.pg.waitForSelector("#dM .err");
          ok(/Escolha o motivo/.test(await D.pg.textContent("#dM")), "denúncia: precisa escolher o motivo");
          await D.pg.screenshot({ path: path.join(SAIDA, "10-denuncia.png"), fullPage: true });
        }
        await D.pg.check('input[name="dMot"][value="foto"]');
        if (i === 0) await D.pg.fill("#dTxt", "foto imprópria");
        await D.pg.click("#dEnv"); await D.pg.waitForSelector("text=Denúncia enviada");
        if (i === 1) ok(!!(await D.pg.$("#meuCartao .ft img")), "denúncia: com 2 denúncias a foto continua");
        todosErros.push(...D.erros); await D.ctx.close();
      }
      const D4 = await pagina(browser, null); IP = 64;
      await D4.pg.goto(BASE + "/aura/#a-" + cod); await D4.pg.waitForSelector("#meuCartao");
      ok(!(await D4.pg.$("#meuCartao .ft img")) && /AL/.test(await D4.pg.textContent("#meuCartao .ft")), "denúncia: com 3 denúncias a foto some (ficam as iniciais)");
      todosErros.push(...D4.erros); await D4.ctx.close();
      await pa.reload(); await pa.waitForSelector("text=Sua foto está em revisão");
      ok(true, "denúncia: a dona vê que a foto está em revisão");
      const G = await pagina(browser, ADM, { email: "equipe@nervia.test", viewport: { width: 1200, height: 900 } });
      await G.pg.goto(BASE + "/apps/aura/"); await G.pg.waitForSelector("#irDen");
      ok((await G.pg.textContent(".aba[data-v=alertas] .n")).trim() === "1", "gestão: aviso de denúncia aberta e número na aba Alertas");
      await G.pg.click("#irDen"); await G.pg.waitForSelector("[data-dman]");
      const at = await G.pg.textContent("#tela");
      ok(/3 de foto/.test(at) && /foto imprópria/.test(at) && /foto escondida/.test(at), "gestão: 3 denúncias de foto, o texto e a foto escondida");
      await G.pg.screenshot({ path: path.join(SAIDA, "11-gestao-denuncias.png"), fullPage: true });
      await G.pg.click("[data-dman]"); await G.pg.click("#dSim"); await G.pg.waitForSelector("text=Nenhuma denúncia aberta");
      ok(!!(await um(pool, "select 1 from auditoria where acao = 'aura_denuncia_resolvida'")), "gestão: manter resolve a denúncia, com auditoria");
      todosErros.push(...G.erros); await G.ctx.close();
      await pa.reload(); await pa.waitForSelector("#meuCartao .ft img");
      ok(!/Sua foto está em revisão/.test(await pa.textContent("main")), "manter: a foto volta para o cartão");
    }

    // ---------- trocar o QR invalida o antigo
    await pa.click('#nav [data-aba="conta"]'); await pa.click("#bTroca"); await pa.click("#cSim"); await pa.waitForSelector("text=QR novo pronto");
    const V2 = await pagina(browser, null); IP = 40;
    await V2.pg.goto(BASE + "/aura/#a-" + cod); await V2.pg.waitForSelector("text=Cartão não encontrado");
    ok(true, "QR novo: o antigo (e o impresso) param de funcionar");
    todosErros.push(...V2.erros); await V2.ctx.close();

    // ---------- sair e entrar pela chave
    await pa.click("#bSair"); await pa.click("#cSim"); await pa.waitForSelector("#fChave");
    await pa.fill("#eChave", chave.toLowerCase().replace(/-/g, " ")); await pa.click("#bChave");
    await pa.waitForSelector("#meuCartao");
    ok(/Ana Lima/.test(await pa.textContent("#meuCartao")), "entrar de novo pela chave (aceita minúsculas e espaços)");
    ok(await semRolagem(pa), "sem rolagem lateral");

    // ---------- apagar
    await pa.click('#nav [data-aba="conta"]'); await pa.click("#bApaga"); await pa.click("#cSim"); await pa.waitForSelector("text=Monte o seu cartão");
    ok(!(await um(pool, "select 1 from aur_cartoes where nome = 'Ana Lima'")) && !(await um(pool, "select 1 from aur_notas")), "apagar: cartão e notas saem; a conta continua");
    todosErros.push(...A.erros);
    ok(todosErros.length === 0, "nenhum erro de script nas páginas" + (todosErros.length ? ": " + todosErros.join(" | ") : ""));
  } catch (e) { falhas++; console.log("FALHOU  " + (e.stack || e)); }
  finally { await browser.close(); srv.close(); await pool.end(); }
  console.log(`\n${oks} ok, ${falhas} falha(s). Prints em ${SAIDA}`);
  process.exit(falhas ? 1 : 0);
})();
