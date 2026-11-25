// Teste de ponta a ponta do Financeiro Nervia (site/apps/financeiro/) com a TELA real e o BANCO real: Postgres com todas as
// migrações e uma ponte mínima no lugar do PostgREST/Storage, que roda cada pedido do supabase-js como o papel
// "authenticated" com o usuário do token — RLS, grants e funções fin_* valem de verdade. Dados FICTÍCIOS.
//
// Precisa de: Postgres (PGHOST/PGPORT/PGUSER/PGPASSWORD, por TCP), o pacote "pg" do npm e uma cópia local do supabase-js
// 2.117.2 (umd) quando o CDN estiver bloqueado: SUPABASE_JS=caminho do supabase.js. NODE_PATH deve achar o "pg".
// Uso: PGHOST=127.0.0.1 PGUSER=postgres SUPABASE_JS=… NODE_PATH=… node testes/financeiro/tela_financeiro_test.js [pasta_prints]
const path = require("path"), fs = require("fs"), http = require("http"), os = require("os"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { Pool } = require("pg");
const RAIZ = path.resolve(__dirname, "..", ".."), SITE = path.join(RAIZ, "site");
const SAIDA = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "financeiro-"));
const PORTA = 8851, DB = "teste_financeiro";
const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENTE = "00000000-0000-0000-0000-0000000000c1";
const PGC = { host: process.env.PGHOST || "127.0.0.1", port: +(process.env.PGPORT || 5432), user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD };
const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dias = n => { const d = new Date(HOJE + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let falhas = 0, oks = 0;
const ok = (c, nome) => { if (c) { oks++; console.log("ok  " + nome); } else { falhas++; console.log("FALHOU  " + nome); } };

// ---------------------------------------------------------------- banco
async function prepararBanco() {
  const adm = new Pool({ ...PGC, database: "postgres" });
  await adm.query(`drop database if exists ${DB}`); await adm.query(`create database ${DB}`); await adm.end();
  const migs = fs.readdirSync(path.join(RAIZ, "supabase", "migrations")).filter(f => f.endsWith(".sql")).sort();
  const sql = fs.readFileSync(path.join(RAIZ, "testes", "stubs_supabase.sql"), "utf8") + "\n" +
    migs.map(f => fs.readFileSync(path.join(RAIZ, "supabase", "migrations", f), "utf8").split("\n").filter(x => !x.startsWith("create extension")).join("\n")).join("\n");
  const tmp = path.join(SAIDA, "_migracoes.sql"); fs.writeFileSync(tmp, sql);
  execFileSync("psql", ["-h", PGC.host, "-p", String(PGC.port), "-U", PGC.user, "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp],
    { env: { ...process.env, PGPASSWORD: PGC.password }, stdio: ["ignore", "ignore", "pipe"] }); fs.unlinkSync(tmp);
  const pool = new Pool({ ...PGC, database: DB });
  await pool.query(`insert into auth.users (id, email) values ($1, 'marco@nervia.com.br'), ($2, 'financeiro@cliente.com.br')`, [ADMIN, CLIENTE]);
  await pool.query(`update perfis set admin = true, nome = 'Marco' where user_id = $1`, [ADMIN]);
  await pool.query(`insert into app_acessos values ($1, 'financeiro')`, [CLIENTE]);   // mesmo com o app liberado, cliente não vê nada
  await pool.query(`insert into nf_empresas (cnpj, nome) values ('11111111000111', 'Empresa A'), ('22222222000122', 'Empresa B'), ('33333333000133', 'Empresa C');
    update nf_empresas set ativo = false where cnpj = '33333333000133';`);
  // Contratos da Nervia: uma cobrança recebida há 2 dias e uma a vencer em 10 dias (fictícias)
  await pool.query(`insert into ctr_clientes (empresa_id, apelido, razao_social) values ((select min(id) from ctr_empresas), 'Cliente Alfa', 'CLIENTE ALFA LTDA')`);
  await pool.query(`insert into ctr_cobrancas (empresa_id, cliente_id, competencia, vencimento, valor, pago_em, valor_pago)
      select min(e.id), (select id from ctr_clientes), $1, $2::date, 1500, $2::date, 1500 from ctr_empresas e
      union all select min(e.id), (select id from ctr_clientes), $3, $4::date, 1500, null, null from ctr_empresas e`,
    ['2026/11', dias(-2), '2026/12', dias(10)]);
  await pool.query(`update fin_contas set saldo_inicial_em = $1`, [dias(-30)]);
  return pool;
}

// ---------------------------------------------------------------- ponte: PostgREST + Storage mínimos
const ID = /^[a-z_][a-z0-9_]*$/;
const ARQUIVOS = new Map();
function servidor(pool) {
  const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
  async function comoUsuario(sub, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin"); await c.query(sub ? "set local role authenticated" : "set local role anon");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub || ""]);
      const r = await fn(c); await c.query("commit"); return r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }
  return http.createServer(async (req, res) => {
    const corpo = await new Promise(r => { const p = []; req.on("data", d => p.push(d)); req.on("end", () => r(Buffer.concat(p))); });
    const url = new URL(req.url, "http://x");
    const json = (st, o) => { res.writeHead(st, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(o === undefined ? "" : JSON.stringify(o)); };
    try {
      let sub = null; try { sub = JSON.parse(Buffer.from((req.headers.authorization || "").split(" ")[1].split(".")[1], "base64url")).sub; } catch {}
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.slice(13); if (!ID.test(fn)) return json(404, { message: "função" });
        const args = corpo.length ? JSON.parse(corpo) : {};
        const meta = (await pool.query(`select p.proargnames as nomes, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos, format_type(p.prorettype, null) as ret, p.proretset as conj
          from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn])).rows[0];
        if (!meta) return json(404, { message: "Could not find the function " + fn });
        const vals = [], partes = [];
        (meta.nomes || []).slice(0, meta.tipos.length).forEach((n, i) => {
          if (!(n in args)) return;
          const t = meta.tipos[i]; vals.push(t === "jsonb" ? JSON.stringify(args[n]) : (args[n] === "" || args[n] === null) && t !== "text" ? null : args[n]);
          partes.push(`${n} => $${vals.length}::${t}`);
        });
        const chamada = `public.${fn}(${partes.join(", ")})`;
        const q = meta.conj ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as r from ${chamada} t`
          : meta.ret === "void" ? `select ${chamada} is null as r` : `select to_jsonb(${chamada}) as r`;
        const r = await comoUsuario(sub, c => c.query(q, vals));
        return meta.ret === "void" ? json(204) : json(200, r.rows[0].r);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const tab = url.pathname.slice(9); if (!ID.test(tab)) return json(404, { message: "tabela" });
        if (req.method !== "GET") return json(405, { message: "a ponte do teste só lê tabelas" });
        const cols = (url.searchParams.get("select") || "*").split(",").map(s => s.trim()).filter(Boolean);
        if (!cols.every(c => c === "*" || ID.test(c))) return json(400, { message: "select" });
        const where = [], vals = [];
        for (const [k, v] of url.searchParams) {
          if (["select", "order", "limit", "offset"].includes(k)) continue;
          if (!ID.test(k) || !v.startsWith("eq.")) return json(400, { message: "filtro " + k });
          vals.push(v.slice(3)); where.push(`${k}::text = $${vals.length}`);
        }
        const ord = (url.searchParams.get("order") || "").split(",").filter(Boolean).map(o => { const [c, d] = o.split("."); if (!ID.test(c)) throw new Error("order"); return `${c} ${d === "desc" ? "desc" : "asc"}`; });
        const q = `select coalesce(json_agg(t), '[]') as r from (select ${cols.join(", ")} from public.${tab}${where.length ? " where " + where.join(" and ") : ""}` +
          `${ord.length ? " order by " + ord.join(", ") : ""}) t`;
        const r = await comoUsuario(sub, c => c.query(q, vals));
        return json(200, r.rows[0].r);
      }
      if (url.pathname.startsWith("/storage/v1/object/")) {
        let resto = decodeURIComponent(url.pathname.slice(19)), assinado = false;
        if (resto.startsWith("sign/")) { resto = resto.slice(5); assinado = true; }
        if (!resto.startsWith("fin-arquivos/")) return json(403, { message: "bucket" });
        const nome = resto.slice(13), negado = () => json(403, { message: "new row violates row-level security policy", statusCode: "403" });
        const podeLer = async () => sub && (await comoUsuario(sub, c => c.query("select count(*)::int n from storage.objects where bucket_id = 'fin-arquivos' and name = $1", [nome]))).rows[0].n > 0;
        if (assinado && req.method === "POST") { if (!(await podeLer())) return json(400, { message: "Object not found", statusCode: "404" }); return json(200, { signedURL: "/object/sign/" + resto + "?token=t" }); }
        if (req.method === "POST") {
          const tipo = req.headers["content-type"] || "", bd = (tipo.match(/boundary=(.+)$/) || [])[1];
          let dados = corpo, mime = tipo;
          if (bd) {
            const sep = Buffer.from("--" + bd);
            for (let i = corpo.indexOf(sep); i >= 0; ) {
              const j = corpo.indexOf(sep, i + sep.length); if (j < 0) break;
              const parte = corpo.subarray(i + sep.length + 2, j - 2), fimCab = parte.indexOf("\r\n\r\n"), cab = parte.subarray(0, fimCab).toString();
              if (/name=""/.test(cab)) { dados = Buffer.from(parte.subarray(fimCab + 4)); mime = (cab.match(/Content-Type: (.+)/i) || [])[1] || ""; }
              i = j;
            }
          }
          if (!["application/pdf", "image/jpeg", "image/png"].includes(mime.trim())) return json(400, { message: "mime type " + mime + " is not supported", statusCode: "415" });
          try { await comoUsuario(sub, c => c.query("insert into storage.objects (bucket_id, name) values ('fin-arquivos', $1)", [nome])); } catch { return negado(); }
          ARQUIVOS.set(resto, dados); return json(200, { Key: resto, Id: resto });
        }
        return json(404, { message: "Object not found" });
      }
      if (url.pathname === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(`window.NERVIA_CONFIG={SUPABASE_URL:"http://127.0.0.1:${PORTA}",SUPABASE_ANON_KEY:"anon"};`); }
      let f = path.join(SITE, path.normalize(url.pathname)); if (!f.startsWith(SITE)) return json(403, {});
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nao achado"); }
      res.writeHead(200, { "content-type": tipos[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
    } catch (e) { json(400, { code: e.code || "", message: e.message, details: e.detail || null, hint: e.hint || null }); }
  });
}

// ---------------------------------------------------------------- tela
function token(uid) {
  const b = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  return b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: uid, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".x";
}
async function pagina(browser, uid, largura = 1300) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 900 }, acceptDownloads: true });
  if (uid) {
    const s = { access_token: token(uid), refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, aud: "authenticated", role: "authenticated" } };
    await ctx.addInitScript(`localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(s))});`);
  }
  await ctx.addInitScript("window.__abertos = []; window.open = u => { window.__abertos.push(u); return null; }; window.alert = m => { window.__alerta = m; };");
  const pg = await ctx.newPage(), erros = [];
  pg.on("pageerror", e => erros.push(String(e)));
  if (process.env.SUPABASE_JS) await pg.route("**/supabase-js@*/**", r => r.fulfill({ path: process.env.SUPABASE_JS, contentType: "text/javascript" }));
  return { pg, erros, ctx };
}
const um = async (pool, q, v) => (await pool.query(q, v)).rows[0];
const aba = (pg, v) => pg.click(`.orelhas .aba[data-v="${v}"]`);
const texto = (pg, s) => pg.$eval(s, e => e.textContent);
const preencher = async (pg, s, v) => { await pg.fill(s, ""); await pg.fill(s, v); };
const BR = d => d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);

(async () => {
  const pool = await prepararBanco();
  const srv = servidor(pool); await new Promise(r => srv.listen(PORTA, "127.0.0.1", r));
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------ cliente (mesmo com o app liberado) não vê nada
    {
      const { pg, ctx } = await pagina(browser, CLIENTE);
      await pg.goto(`http://127.0.0.1:${PORTA}/apps/financeiro/`); await pg.waitForFunction(() => !document.querySelector("#aviso").textContent.includes("Carregando"));
      ok((await texto(pg, "#aviso")).includes("só da equipe Nervia") && await pg.$eval("#app", e => e.hidden), "cliente: tela recusa (só a equipe Nervia)");
      await ctx.close();
    }
    const { pg, erros, ctx } = await pagina(browser, ADMIN);
    await pg.goto(`http://127.0.0.1:${PORTA}/apps/financeiro/`); await pg.waitForSelector("#app:not([hidden])");
    // ------------------------------------------------ painel inicial
    const kp = async () => pg.$$eval(".kpi", k => Object.fromEntries(k.map(x => [x.querySelector(".l").textContent, x.querySelector(".v").textContent])));
    let k = await kp();
    ok(k["Nubank PJ"] === "R$ 1.500,00", "painel: saldo do Nubank = recebimento do Contratos (" + k["Nubank PJ"] + ")");
    ok(k["Cartão pessoal do Marco"] === "R$ 0,00" && k["A receber"] === "R$ 1.500,00", "painel: cartão sem dívida; a receber em 30 dias vem do Contratos");
    ok(k["CNPJs ativos"] === "2", "painel: CNPJs ativos do Buscador (2 de 3)");
    ok(await pg.$eval("#conteudo", e => e.textContent.includes("Margem dos apps")), "painel: quadro da margem dos apps (tabela de preços)");
    // ------------------------------------------------ custos: um em dólar (mensal) e o domínio (anual)
    await aba(pg, "custos"); await pg.click("#novoCusto");
    await pg.fill("#cNome", "Supabase Pro"); await pg.fill("#cForn", "Supabase"); await pg.selectOption("#cMoeda", "USD");
    await pg.fill("#cValor", "25"); await pg.fill("#cCambio", "5,50"); await pg.fill("#cDesde", "2026-10-13"); await pg.click("#cSalvar");
    await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    await pg.click("#novoCusto"); await pg.fill("#cNome", "Domínio nvaura.com.br"); await pg.fill("#cValor", "40,00"); await pg.selectOption("#cPer", "anual");
    await pg.fill("#cDesde", "2026-11-25"); await pg.click("#cSalvar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    await pg.click("#novoCusto"); await pg.fill("#cNome", "Contador"); await pg.fill("#cGrupo", "Administrativo"); await pg.fill("#cValor", "300"); await pg.fill("#cDesde", "2026-01-01");
    await pg.click("#cSalvar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    k = await kp();
    ok(k["Plataforma"] === "R$ 140,83" && k["Administrativo"] === "R$ 300,00", "custos: equivalente mensal por grupo (US$ × câmbio; anual ÷ 12) — " + k["Plataforma"]);
    // alterar o câmbio com motivo → histórico
    await pg.click("#tab-custos tbody tr:has-text('Supabase Pro')"); await preencher(pg, "#cCambio", "5,80"); await pg.fill("#cMotivo", "câmbio de novembro");
    await pg.click("#cSalvar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    await pg.click("#tab-custos tbody tr:has-text('Supabase Pro')");
    ok((await texto(pg, "#cHist")).includes("câmbio de novembro") && (await texto(pg, "#cHist")).includes("5.5"), "custos: histórico mostra a mudança e o motivo");
    // gerar a conta a pagar do Supabase (mensal)
    await pg.fill("#cVenc", dias(5)); await pg.click("#cGerar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    const l1 = await um(pool, "select * from fin_lancamentos where descricao = 'Supabase Pro'");
    ok(l1 && Number(l1.valor) === 145 && l1.recorrencia === "mensal" && l1.vencimento.toISOString ? true : !!l1, "custos: conta a pagar criada com o valor em reais e a recorrência do custo");
    ok(Number(l1.valor) === 145 && l1.recorrencia === "mensal", "custos: valor 25 × 5,80 = R$ 145,00, todo mês");
    // ------------------------------------------------ contas a pagar
    await aba(pg, "pagar");
    ok(await pg.$eval("#tab-pagar", t => t.textContent.includes("Supabase Pro")), "a pagar: conta do custo aparece em aberto");
    await pg.click("#novaPagar"); await pg.fill("#lDesc", "DAS"); await pg.fill("#lQuem", "Receita Federal"); await pg.fill("#lVenc", dias(-3));
    await pg.fill("#lValor", "1,234"); await pg.click("#lSalvar");
    ok((await texto(pg, "#dlg .msg")).includes("Confira o valor"), "a pagar: valor em formato duvidoso é recusado na tela");
    await preencher(pg, "#lValor", "1.250,40"); await pg.selectOption("#lCat", { label: "Impostos" }); await pg.selectOption("#lConta", { label: "Nubank PJ" });
    await pg.selectOption("#lRec", "mensal"); await pg.click("#lSalvar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    await pg.selectOption("#fSit", "atrasadas");
    ok(await pg.$eval("#tab-pagar", t => t.textContent.includes("DAS") && t.textContent.includes("Atrasada")), "a pagar: DAS vencido aparece em Atrasadas");
    // pagar
    await pg.click("#tab-pagar tbody tr:has-text('DAS')"); await pg.click("#baixar"); await preencher(pg, "#bValor", "1.262,90"); await pg.fill("#bObs", "com multa");
    await pg.click("#bOk"); await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    const das = (await pool.query("select * from fin_lancamentos where descricao = 'DAS' order by vencimento")).rows;
    ok(das.length === 2 && das[0].pago_em && Number(das[0].valor_pago) === 1262.9 && !das[1].pago_em && Number(das[1].valor) === 1250.4, "a pagar: baixa grava o valor pago e cria a próxima do mês seguinte");
    // desfazer com motivo e pagar de novo
    await pg.selectOption("#fSit", "pagas"); await pg.click("#tab-pagar tbody tr:has-text('DAS')"); await pg.click("#desfazer");
    await pg.click("#motivoOk"); ok(await pg.waitForFunction(() => document.querySelector("#dlg2 .msg").textContent.includes("motivo")).then(() => true, () => false), "a pagar: desfazer baixa sem motivo é recusado");
    await pg.fill("#motivo", "valor digitado errado"); await pg.click("#motivoOk"); await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    ok(!(await um(pool, "select pago_em from fin_lancamentos where id = $1", [das[0].id])).pago_em, "a pagar: baixa desfeita");
    await pg.selectOption("#fSit", "atrasadas"); await pg.click("#tab-pagar tbody tr:has-text('DAS')"); await pg.click("#baixar"); await preencher(pg, "#bValor", "1.262,90");
    await pg.click("#bOk"); await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    ok((await um(pool, "select count(*)::int n from fin_lancamentos where descricao = 'DAS'")).n === 2, "a pagar: pagar de novo não duplica a próxima");
    // anexo
    await pg.selectOption("#fSit", "pagas"); await pg.click("#tab-pagar tbody tr:has-text('DAS')");
    const pdf = path.join(SAIDA, "guia.pdf"); fs.writeFileSync(pdf, "%PDF-1.4 guia fictícia");
    await pg.setInputFiles("#anexo", pdf); await pg.waitForSelector("#verAnexo");
    const an = (await um(pool, "select anexo from fin_lancamentos where id = $1", [das[0].id])).anexo;
    ok(an.startsWith("lancamentos/" + das[0].id + "/") && [...ARQUIVOS.keys()].some(x => x.endsWith(an)), "a pagar: anexo guardado no bucket privado");
    await pg.click("#verAnexo"); await pg.waitForFunction(() => window.__abertos.length > 0);
    ok((await pg.evaluate(() => window.__abertos[0])).includes("token="), "a pagar: anexo abre por link temporário");
    await pg.keyboard.press("Escape");
    // despesa já paga no cartão pessoal
    await pg.click("#jaPaga"); await pg.fill("#lDesc", "Google Workspace"); await pg.fill("#lVenc", dias(-1)); await pg.fill("#lValor", "120");
    ok(await pg.$eval("#lConta", s => s.options[s.selectedIndex].text === "Cartão pessoal do Marco"), "despesa já paga: o cartão pessoal vem escolhido");
    await pg.click("#lSalvar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    await aba(pg, "painel"); k = await kp();
    ok(k["Cartão pessoal do Marco"] === "R$ 120,00" && (await texto(pg, ".kpis")).includes("a Nervia deve ao Marco"), "painel: o cartão pessoal mostra quanto a Nervia deve ao Marco");
    ok(k["Nubank PJ"] === "R$ 237,10", "painel: saldo do Nubank = 1.500 − 1.262,90 (" + k["Nubank PJ"] + ")");
    ok(k["Saiu"] === "R$ 1.382,90" && k["Entrou"] === "R$ 1.500,00", "painel: resultado do mês com o que entrou e saiu de fato");
    // ------------------------------------------------ contas: reembolso e acerto
    await aba(pg, "contas"); await pg.click("#transferir"); await pg.fill("#tValor", "120"); await pg.fill("#tDesc", "Reembolso ao Marco");
    await pg.click("#tOk"); await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    k = await kp();
    ok(k["Cartão pessoal do Marco"] === "R$ 0,00" && k["Nubank PJ"] === "R$ 117,10", "contas: reembolso zera o cartão e sai do Nubank");
    await pg.click(".kpi:has-text('Nubank PJ')"); await pg.click("#acertar"); await pg.fill("#aSaldo", "100"); await pg.click("#aOk");
    await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    ok((await texto(pg, "#saldoHoje")) === "R$ 100,00" && (await texto(pg, "#tab-movs")).includes("Acerto"), "contas: acerto com o banco ajusta o saldo e aparece nos movimentos");
    ok((await texto(pg, "#tab-movs")).includes("Cliente Alfa"), "contas: recebimento do Contratos aparece no extrato da conta");
    // ------------------------------------------------ a receber
    await aba(pg, "receber");
    ok(await pg.$eval("#tab-contratos", t => t.textContent.includes("Cliente Alfa") && t.textContent.includes("A vencer")), "a receber: cobrança do Contratos em aberto (só leitura)");
    await pg.click("#novoReceber"); await pg.fill("#lDesc", "Consultoria avulsa"); await pg.fill("#lQuem", "Empresa Beta"); await pg.fill("#lVenc", dias(-1)); await pg.fill("#lValor", "800");
    await pg.click("#lSalvar"); await pg.waitForFunction(() => !document.querySelector("#dlg").open);
    await pg.click("#tab-receber tbody tr:has-text('Consultoria')"); await pg.click("#cancelar"); await pg.fill("#motivo", "cliente desistiu"); await pg.click("#motivoOk");
    await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    ok((await um(pool, "select cancelado_motivo from fin_lancamentos where descricao = 'Consultoria avulsa'")).cancelado_motivo === "cliente desistiu", "a receber: avulso cancelado com motivo (não se apaga)");
    // ------------------------------------------------ configuração: categoria nova
    await aba(pg, "config"); await pg.click("#novaCat"); await pg.fill("#kcNome", "Viagens"); await pg.click("#kcOk"); await pg.waitForFunction(() => !document.querySelector("#dlg2").open);
    ok(await pg.$eval("#tab-cats", t => t.textContent.includes("Viagens")), "configuração: categoria nova");
    // ------------------------------------------------ auditoria e erros
    const aud = (await pool.query("select distinct acao from auditoria where acao like 'financeiro_%' order by 1")).rows.map(r => r.acao);
    ok(["financeiro_custo_criado", "financeiro_custo_alterado", "financeiro_conta_pagar_criada", "financeiro_pagamento_baixado", "financeiro_baixa_desfeita",
      "financeiro_recorrencia_gerada", "financeiro_anexo", "financeiro_transferencia", "financeiro_saldo_acertado", "financeiro_lancamento_cancelado", "financeiro_categoria_criada"].every(a => aud.includes(a)),
      "auditoria: todas as ações gravadas (" + aud.length + " tipos)");
    await pg.screenshot({ path: path.join(SAIDA, "financeiro-config.png") });
    await aba(pg, "painel"); await pg.screenshot({ path: path.join(SAIDA, "financeiro-painel.png"), fullPage: true });
    // celular
    const cel = await pagina(browser, ADMIN, 390);
    await cel.pg.goto(`http://127.0.0.1:${PORTA}/apps/financeiro/`); await cel.pg.waitForSelector("#app:not([hidden])");
    ok(await cel.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: sem rolagem lateral");
    await cel.pg.screenshot({ path: path.join(SAIDA, "financeiro-celular.png"), fullPage: true }); await cel.ctx.close();
    // ajuda
    for (const a of ["cartao", "manual"]) {
      const r = await pg.goto(`http://127.0.0.1:${PORTA}/apps/financeiro/ajuda/${a}.html`);
      ok(r.status() === 200 && (await pg.content()).includes("marca-dagua.js"), "ajuda: " + a + " existe, com marca d'água");
    }
    ok(erros.length === 0, "sem erro de JavaScript na página " + (erros.length ? erros.join(" | ") : ""));
    await ctx.close();
  } catch (e) { falhas++; console.log("FALHOU  exceção: " + (e.stack || e)); try { for (const p of browser.contexts().flatMap(c => c.pages())) console.log("TELA:", (await p.textContent("body")).slice(0, 400)); } catch {} }
  finally { await browser.close(); srv.close(); await pool.end(); }
  console.log(`\n${oks} ok, ${falhas} falha(s). Prints em ${SAIDA}`);
  process.exit(falhas ? 1 : 0);
})();
