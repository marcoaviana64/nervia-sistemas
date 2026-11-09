// Teste de ponta a ponta do app Contratos (site/apps/contratos/) com a TELA real e o BANCO real: Postgres com todas as
// migrações e uma ponte mínima no lugar do PostgREST/Storage (este arquivo), que roda cada pedido do supabase-js como o
// papel "authenticated" com o usuário do token — as regras de acesso (RLS, grants, funções ctr_*) valem de verdade.
// Dados FICTÍCIOS: a planilha, o modelo do Word e o extrato OFX são montados aqui.
//
// Precisa de: Postgres (PGHOST/PGPORT/PGUSER/PGPASSWORD, por TCP), o pacote "pg" do npm e uma cópia local do supabase-js
// 2.117.2 (umd) — sem internet para o CDN: SUPABASE_JS=caminho do supabase.js. NODE_PATH deve achar o "pg".
// Uso: PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=… SUPABASE_JS=… NODE_PATH=… node testes/contratos/tela_contratos_test.js [pasta_prints]
// Opcional: PLANILHA=caminho do ContratoDados.xlsx real → só confere a leitura e a conferência com a aba Resumo (não grava).
const path = require("path"), fs = require("fs"), http = require("http"), os = require("os"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { Pool } = require("pg");
const ARQ = require("../../site/apps/contratos/arquivos.js");
const RAIZ = path.resolve(__dirname, "..", ".."), SITE = path.join(RAIZ, "site");
const SAIDA = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "contratos-"));
const PORTA = 8843, DB = "teste_contratos";
const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENTE = "00000000-0000-0000-0000-0000000000c1";
const PGC = { host: process.env.PGHOST || "127.0.0.1", port: +(process.env.PGPORT || 5432), user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD };

let falhas = 0, oks = 0;
const ok = (c, nome) => { if (c) { oks++; console.log("ok  " + nome); } else { falhas++; console.log("FALHOU  " + nome); } };

// ---------------------------------------------------------------- banco
async function prepararBanco() {
  const adm = new Pool({ ...PGC, database: "postgres" });
  await adm.query(`drop database if exists ${DB}`); await adm.query(`create database ${DB}`); await adm.end();
  const sql = fs.readFileSync(path.join(RAIZ, "testes", "stubs_supabase.sql"), "utf8") + "\n" +
    fs.readdirSync(path.join(RAIZ, "supabase", "migrations")).filter(f => f.endsWith(".sql")).sort()
      .map(f => fs.readFileSync(path.join(RAIZ, "supabase", "migrations", f), "utf8").split("\n").filter(l => !l.startsWith("create extension")).join("\n")).join("\n");
  const tmp = path.join(SAIDA, "_migracoes.sql"); fs.writeFileSync(tmp, sql);
  execFileSync("psql", ["-h", PGC.host, "-p", String(PGC.port), "-U", PGC.user, "-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp],
    { env: { ...process.env, PGPASSWORD: PGC.password }, stdio: ["ignore", "ignore", "pipe"] });
  fs.unlinkSync(tmp);
  const pool = new Pool({ ...PGC, database: DB });
  await pool.query(`insert into auth.users (id, email) values ($1, 'marco@nervia.com.br'), ($2, 'financeiro@cliente.com.br')`, [ADMIN, CLIENTE]);
  await pool.query(`update perfis set admin = true, nome = 'Marco' where user_id = $1`, [ADMIN]);
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
        const meta = (await pool.query(`select p.proargnames as nomes, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos, format_type(p.prorettype, null) as ret
          from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, [fn])).rows[0];
        if (!meta) return json(404, { message: "Could not find the function " + fn });
        const vals = [], partes = [];
        meta.nomes.slice(0, meta.tipos.length).forEach((n, i) => {
          if (!(n in args)) return;
          const t = meta.tipos[i]; vals.push(t === "jsonb" ? JSON.stringify(args[n]) : args[n] === "" && t !== "text" ? null : args[n]);
          partes.push(`${n} => $${vals.length}::${t}`);
        });
        const q = meta.ret === "void" ? `select public.${fn}(${partes.join(", ")}) is null as r` : `select to_jsonb(public.${fn}(${partes.join(", ")})) as r`;
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
        const lim = parseInt(url.searchParams.get("limit") || "0"), off = parseInt(url.searchParams.get("offset") || "0");
        const q = `select coalesce(json_agg(t), '[]') as r from (select ${cols.join(", ")} from public.${tab}${where.length ? " where " + where.join(" and ") : ""}` +
          `${ord.length ? " order by " + ord.join(", ") : ""}${lim ? " limit " + lim : ""}${off ? " offset " + off : ""}) t`;
        const r = await comoUsuario(sub, c => c.query(q, vals));
        return json(200, r.rows[0].r);
      }
      if (url.pathname.startsWith("/storage/v1/object/")) {
        let resto = decodeURIComponent(url.pathname.slice(19)), assinado = false;
        if (resto.startsWith("sign/")) { resto = resto.slice(5); assinado = true; }
        const admin = sub && (await comoUsuario(sub, c => c.query("select public.eh_admin() as a"))).rows[0].a;
        if (!resto.startsWith("ctr-arquivos/") || (!admin && !(assinado && req.method === "GET" && url.searchParams.get("token") === "t"))) return json(403, { message: "new row violates row-level security policy", statusCode: "403" });
        if (assinado && req.method === "POST") return json(200, { signedURL: "/object/sign/" + resto + "?token=t" });
        if (req.method === "POST") {
          if (ARQUIVOS.has(resto)) return json(409, { message: "The resource already exists" });
          // o supabase-js manda o arquivo como multipart/form-data (parte sem nome); o Storage guarda só o conteúdo
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
          if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mime.trim())) return json(400, { message: "mime type " + mime + " is not supported", statusCode: "415" });
          ARQUIVOS.set(resto, dados); return json(200, { Key: resto, Id: resto });
        }
        if (!ARQUIVOS.has(resto)) return json(404, { message: "Object not found" });
        res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(ARQUIVOS.get(resto));
      }
      // site
      if (url.pathname === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(`window.NERVIA_CONFIG={SUPABASE_URL:"http://127.0.0.1:${PORTA}",SUPABASE_ANON_KEY:"anon"};`); }
      let f = path.join(SITE, path.normalize(url.pathname)); if (!f.startsWith(SITE)) return json(403, {});
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nao achado"); }
      res.writeHead(200, { "content-type": tipos[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
    } catch (e) { json(400, { code: e.code || "", message: e.message, details: e.detail || null, hint: e.hint || null }); }
  });
}

// ---------------------------------------------------------------- arquivos fictícios
// planilha no formato do ContratoDados.xlsx (mesmas abas e cabeçalhos), feita com o openpyxl
function planilhaFicticia(destino) {
  const py = `
import sys, datetime as d, openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Clientes'
ws.append([]); ws.append([]); ws.append([]); ws.append([])
ws.append([None, 'CHAVE CONFERÊNCIA', 'NOME DO SHOPPING', 'RAZÃO SOCIAL PARA FATURAMENTO', 'CNPJ'])
ws.append([None, 'Alfa Center 1-91', 'Alfa Center', 'CONDOMINIO ALFA CENTER', '11.222.333/0001-91'])
ws.append([None, 'Beta  Mall', 'Beta  Mall', 'FUNDO BETA MALL', '44.555.666/0001-72'])
dd = wb.create_sheet('Dados'); dd.append([]); dd.append([])
cab = ['CTT-NOME','CTT-CNPJ','CTT-END','CTRA-NOME','CTRA-CNPJ','CTRA-END','CTRA-JUNTA','RESP-FINAN','CTRA-SERVICOSESP','CTRA-PRESTACAO','CTRA-OBJ','CTRA-INI','CTRA-FIM','CTRA-HONORARIOS','CTT-EMAIL','CTRA-EMAIL','TESTE1','TESTE1DOC','TESTE2','TESTE2DOC','LOCALDATAASSINATURA','Enviado','Assinado']
dd.append([None] + cab)
base = ['NERVIA TESTE CONSULTORIA', '99.888.777/0001-66', 'Rua Fictícia, 10 - Rio de Janeiro', 'Rio de Janeiro sob o número 00-0000/000000-0']
dd.append([None, 'CONDOMÍNIO ALFA CENTER', '11.222.333/0001-91', 'Av. Alfa, 100 - Niterói'] + base + ['Shopping Alfa Center', 'de Tecnologia da Informação', 'de consultoria de TI', '=K4', d.datetime(2026,1,1), d.datetime(2026,12,31), 'R$ 1.500,00 (mil e quinhentos reais)', 'diretor@alfa.example', 'contato@nervia.example', 'Ana Teste', 'RG: 11', 'Bruno Teste', 'CPF: 22', 'Niterói, 01 de janeiro de 2026'])
dd.append([None, 'FUNDO BETA MALL', '44.555.666/0001-72', 'Rua Beta, 2 - Rio'] + base + ['Beta Mall', 'de Tecnologia da Informação', 'de consultoria de TI', '=K5', d.datetime(2026,11,1), d.datetime(2026,12,31), 'R$ 2.000,00 (dois mil reais)', 'adm@beta.example', 'contato@nervia.example', None, None, None, None, 'Rio de Janeiro, 01 de novembro de 2026'])
cv = wb.create_sheet('clentesevalores'); cv.append([]); cv.append([])
cv.append([None, 'ALF', 'CONDOMINIO ALFA CENTER', 'pagar@alfa.example', 'Alfa Center 1-91', -1500])
cv.append([None, 'BET', 'FUNDO BETA MALL', 'pagar@beta.example', 'Beta  Mall', -2000])
rc = wb.create_sheet('RecebimentosControle'); rc.append([])
rc.append([None, 'Pago', 0]); rc.append([None, 'PG Em Atraso', 0]); rc.append([None, 'Devendo', 0]); rc.append([None, 'Diferença', 0])
rc.append([None, 'Imposto1', 0.165]); rc.append([None, 'Imposto2', 0.06])
for _ in range(11): rc.append([])
rc.append([None, 'MesRef','DataLimPagto','Shopping','Valor','DataPag','ValorPago','Imposto16_5','Liquido','Recebido OK','NF'])
linhas = [('2025/11','Alfa Center 1-91',-1400,d.datetime(2025,11,28),1400),('2025/11','Beta  Mall',-1900,d.datetime(2025,11,28),1900),('2025/11','Gama Antigo 1-10',-500.004,d.datetime(2025,12,3),500),
          ('2025/12','Alfa Center 1-91',-1400,d.datetime(2025,12,29),1400),('2025/12','Beta  Mall',-1900,None,None),('2025/13','Alfa Center 1-91',-1400,d.datetime(2025,12,29),1350),
          ('2026/01','Alfa Center 1-91',-1500,d.datetime(2026,1,28),1500),('2026/01','Alfa Center 1-91',-50,d.datetime(2026,1,28),50),('2026/01','Beta  Mall',-1900,d.datetime(2026,1,30),1900),
          ('2026/02','Alfa Center 1-91',-1500,None,None),('2026/02','Beta  Mall',-1900,None,None),('2026/02','Projeto Delta',-7000,d.datetime(2026,2,20),7000)]
for comp, s, v, dp, vp in linhas:
    y, m = int(comp[:4]), min(int(comp[5:]), 12)
    rc.append([None, comp, d.datetime(y, m, 28), s, v, dp, vp, None, None, None, 'ok' if comp == '2026/02' and s == 'Alfa Center 1-91' else None])
rs = wb.create_sheet('Resumo'); rs.append([]); rs.append([]); rs.append([])
rs.append([None, 'Ano/Mês', 'Cobrado', 'Pago'])
tot = {}
for comp, s, v, dp, vp in linhas: c = tot.setdefault(comp, [0, 0]); c[0] += v; c[1] += vp or 0
for comp in sorted(tot): rs.append([None, comp, tot[comp][0], tot[comp][1]])
wb.save(sys.argv[1])
`;
  execFileSync("python3", ["-I", "-c", py, destino]);
}
// modelo do Word com campos de mala direta (campo complexo, campo simples e instrução partida em dois runs) e o vínculo
// com a planilha nas configurações, como o modelo de verdade
async function modeloFicticio() {
  const campo = n => `<w:r><w:rPr><w:b/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> MERGEFIELD </w:instrText></w:r><w:r><w:instrText>${n} \\* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>«${n}»</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const p = (...xs) => `<w:p>${xs.map(x => x.startsWith("<") ? x : `<w:r><w:t xml:space="preserve">${x}</w:t></w:r>`).join("")}</w:p>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    p("CONTRATO entre ", campo("CTTNOME"), ", CNPJ ", campo("CTTCNPJ"), ", sede ", campo("CTTEND"), ", e ", campo("CTRANOME"), " (", campo("CTRACNPJ"), "), ", campo("CTRAEND"), ", Junta ", campo("CTRAJUNTA"), ".") +
    p("Responsável: ", campo("RESPFINAN"), ". Serviços ", campo("CTRASERVICOSESP"), "; prestação ", campo("CTRAPRESTACAO"), ".") +
    p("Vigência de ", campo("CTRAINI"), " a ", campo("CTRAFIM"), ". Honorários: ", campo("CTRAHONORARIOS"), ".") +
    p("Assinam ", campo("CTTEMAIL"), " e ", campo("CTRAEMAIL"), ". ", `<w:fldSimple w:instr=" MERGEFIELD LOCALDATAASSINATURA "><w:r><w:t>«LOCALDATAASSINATURA»</w:t></w:r></w:fldSimple>`) +
    p("Testemunhas: ", campo("TESTE1"), " ", campo("TESTE1DOC"), " / ", campo("TESTE2"), " ", campo("TESTE2DOC")) + `</w:body></w:document>`;
  return ARQ.gravarZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/recipientData.xml" ContentType="application/vnd.ms-word.mailMergeRecipientData+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`],
    ["word/document.xml", doc],
    ["word/settings.xml", `<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:mailMerge><w:mainDocumentType w:val="formLetters"/><w:dataSource r:id="rId1"/></w:mailMerge></w:settings>`],
    ["word/_rels/settings.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/recipientData" Target="recipientData.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/mailMergeSource" Target="file:///C:\\Planilha.xlsx" TargetMode="External"/></Relationships>`],
    ["word/recipientData.xml", `<?xml version="1.0"?><w:recipients xmlns:w="http://schemas.microsoft.com/office/word/2006/wordml"><w:recipientData><w:active w:val="1"/></w:recipientData></w:recipients>`]]);
}
function ofx(linhas) {
  return `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n` + linhas.map(([d, v, memo, id]) =>
    `<STMTTRN>\n<TRNTYPE>${v > 0 ? "CREDIT" : "DEBIT"}\n<DTPOSTED>${d.replace(/-/g, "")}000000[-3:BRT]\n<TRNAMT>${v.toFixed(2)}\n<FITID>${id}\n<MEMO>${memo}\n</STMTTRN>`).join("\n") +
    `\n</BANKTRANLIST><LEDGERBAL><BALAMT>99999.99\n<DTASOF>20260301</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
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

(async () => {
  if (process.env.PLANILHA) return conferirPlanilhaReal();
  const pool = await prepararBanco(), srv = servidor(pool).listen(PORTA);
  const browser = await chromium.launch();
  try {
    // ---------- quem não é da equipe
    { const { pg, ctx } = await pagina(browser, CLIENTE);
      await pg.goto(`http://127.0.0.1:${PORTA}/apps/contratos/`); await pg.waitForFunction(() => !document.querySelector("#aviso").textContent.includes("Carregando"));
      ok((await pg.textContent("#aviso")).includes("uso interno"), "login de cliente não usa o app");
      await ctx.close(); }

    const { pg, erros } = await pagina(browser, ADMIN);
    await pg.goto(`http://127.0.0.1:${PORTA}/apps/contratos/`);
    await pg.waitForSelector("#app:not([hidden])");
    ok(await pg.isVisible("text=Carga da planilha ContratoDados.xlsx"), "app vazio abre na Configuração com a carga da planilha");

    // ---------- carga da planilha (fictícia)
    const xlsx = path.join(SAIDA, "ContratoDados-ficticio.xlsx"); planilhaFicticia(xlsx);
    await pg.setInputFiles('input[accept=".xlsx"]', xlsx);
    await pg.click("text=Ler planilha");
    await pg.waitForSelector("text=Todos os meses batem com a aba Resumo.");
    const prev = await pg.textContent("#conteudo"); if (process.env.DEPURAR) console.log(prev.slice(0, 900));
    ok(prev.includes("4 clientes") && prev.includes("2 ativos") && prev.includes("2 da aba Dados") && prev.includes("12 cobranças"), "carga: prévia com clientes, contratos e cobranças");
    await pg.click("text=Carregar no sistema");
    await pg.waitForFunction(() => window.__alerta);
    const cg = await um(pool, `select (select count(*) from ctr_clientes)::int cli, (select count(*) from ctr_contratos)::int k, (select count(*) from ctr_contratos where historico)::int h,
      (select count(*) from ctr_cobrancas)::int cob, (select count(*) from ctr_cobrancas where contrato_id is null)::int av, (select sum(valor) from ctr_cobrancas)::float cobrado,
      (select pct from ctr_impostos)::float pct, (select contratada_nome from ctr_config) cnome,
      (select apelido from ctr_clientes where cnpj = '44555666000172') beta, (select ativo from ctr_clientes where apelido = 'Gama Antigo') gama`);
    if (process.env.DEPURAR) console.log(cg);
    ok(cg.cli === 4 && cg.k === 4 && cg.h === 2 && cg.cob === 12 && cg.av === 2, "carga: 4 clientes, 2 contratos da aba Dados + 2 anteriores, 12 cobranças (2 avulsas: cobrança única sem contrato)");
    ok(Math.abs(cg.cobrado - 22350) < 0.01 && cg.pct === 16.5 && cg.cnome === "NERVIA TESTE CONSULTORIA", "carga: total cobrado, imposto da planilha e dados da Nervia");
    ok(cg.beta === "Beta Mall" && cg.gama === false, "carga: nomes limpos (espaço duplo) e cliente antigo inativo");
    const kb = await um(pool, `select k.inicio::text, k.fim::text, (select count(*) from ctr_cobrancas c where c.contrato_id = k.id)::int n from ctr_contratos k join ctr_clientes c on c.id = k.cliente_id where c.apelido = 'Beta Mall' and k.historico`);
    ok(kb && kb.inicio === "2025-11-01" && kb.fim === "2026-10-31" && kb.n === 4, "carga: cobranças antes do contrato novo vão para o contrato anterior (até a véspera do início)");
    ok(!(await pg.isVisible("text=Ler planilha")), "carga: o painel some depois da carga");

    // ---------- modelo do Word
    await aba(pg, "config");
    await pg.setInputFiles('input[accept=".docx"]', { name: "Modelo contrato.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(await modeloFicticio()) });
    await pg.click("text=Enviar modelo");
    await pg.waitForSelector("text=Em uso: Modelo contrato.docx");
    ok((await um(pool, "select array_length(campos, 1) n from ctr_modelos where padrao")).n === 20, "modelo: guardado com os 20 campos");

    // ---------- contrato: gerar Word, enviado, assinado, cobranças
    await aba(pg, "contratos");
    await pg.click("tr.clica:has-text('Alfa Center')");
    await pg.waitForSelector("#dlg[open] >> text=Gerar Word");
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#dlg >> text=Gerar Word")]);
    ok(dl.suggestedFilename() === "Contrato Alfa Center 2026.docx", "Word: nome do arquivo");
    const z = await ARQ.lerZip(fs.readFileSync(await dl.path())), doc = new TextDecoder().decode(z.get("word/document.xml"));
    ok(doc.includes("CONDOMÍNIO ALFA CENTER") && doc.includes("11.222.333/0001-91") && doc.includes("R$ 1.500,00 (mil e quinhentos reais)") && doc.includes("01/01/2026")
      && doc.includes("31/12/2026") && doc.includes("Niterói, 01 de janeiro de 2026") && doc.includes("99.888.777/0001-66") && doc.includes("Ana Teste"), "Word: campos preenchidos (razão, CNPJ, valor por extenso, datas, local)");
    ok(!doc.includes("MERGEFIELD") && !doc.includes("fldChar") && !z.has("word/recipientData.xml") && !new TextDecoder().decode(z.get("word/settings.xml")).includes("mailMerge")
      && !new TextDecoder().decode(z.get("word/_rels/settings.xml.rels")).includes("mailMergeSource"), "Word: sem campos e sem o vínculo com a planilha");
    await pg.waitForSelector("#dlg[open] .etapas .atual:has-text('Gerado')");
    await pg.click("#dlg >> text=Marcar enviado"); await pg.click("#dlg2 >> text=Confirmar");
    await pg.waitForSelector("#dlg[open] .etapas .atual:has-text('Enviado')");
    await pg.click("#dlg >> text=Marcar assinado"); await pg.fill("#dlg2 input[type=date]", "2026-01-05"); await pg.click("#dlg2 >> text=Confirmar");
    await pg.waitForSelector("#dlg[open] .etapas .atual:has-text('Assinado')");
    const ka = await um(pool, `select k.id, k.situacao, k.assinado_em::text a from ctr_contratos k join ctr_clientes c on c.id = k.cliente_id where c.apelido = 'Alfa Center' and not k.historico`);
    ok(ka.situacao === "assinado" && ka.a === "2026-01-05", "etapas: enviado e assinado com a data");
    await pg.setInputFiles("#dlg input[type=file]", { name: "assinado.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 teste") });
    await pg.waitForSelector("#dlg >> text=Abrir PDF");
    await pg.click("#dlg >> text=Abrir PDF"); await pg.waitForFunction(() => window.__abertos.length > 0);
    ok((await um(pool, "select documento from ctr_contratos where id = $1", [ka.id])).documento.startsWith(`contratos/${ka.id}/`) && (await pg.evaluate(() => window.__abertos[0])).includes("token="),
      "PDF assinado guardado e aberto por link temporário");
    await pg.click("#dlg >> text=Criar cobranças");
    await pg.waitForSelector("#toast:not([hidden])"); await pg.waitForSelector("#dlg h3:has-text('Cobranças (14)')");
    const nc = await um(pool, `select count(*)::int n, sum(valor)::float s from ctr_cobrancas where contrato_id = $1`, [ka.id]);
    ok(nc.n === 13 + 2 - 1 && Math.abs(nc.s - (1500 * 13 + 50 + 1500 - 1500)) < 0.01, "cobranças criadas sem repetir os meses que vieram da planilha (12 meses + extra, com o complemento de jan)");
    // valor depois de assinado exige motivo
    await pg.fill("#dlg .form input[type=number][step='0.01']", "1600");
    await pg.click("#dlg >> text=Salvar dados");
    await pg.waitForSelector("#dlg2[open] >> text=Contrato já assinado");
    await pg.fill("#dlg2 textarea", "Aditivo assinado em 01/03/2026"); await pg.click("#dlg2 >> text=Confirmar");
    await pg.waitForSelector("#dlg[open] >> text=Alterado depois da assinatura");
    ok((await um(pool, "select valor_mensal::float v from ctr_contratos where id = $1", [ka.id])).v === 1600, "alterar valor depois de assinado pede o motivo e grava");
    await pg.keyboard.press("Escape");

    // ---------- renovação
    await pg.click("tr.clica:has-text('Alfa Center')");
    await pg.click("#dlg >> text=Renovar");
    await pg.click("#dlg2 >> text=Criar renovação");
    await pg.waitForSelector("#dlg[open] .etapas .atual:has-text('Rascunho')");
    ok((await um(pool, "select count(*)::int n from ctr_contratos where anterior_id = $1 and inicio = '2027-01-01' and fim = '2027-12-31'", [ka.id])).n === 1, "renovação cria o contrato de 2027 em rascunho");
    await pg.keyboard.press("Escape");

    // ---------- cobranças: NF em lote, baixa manual com diferença
    await aba(pg, "cobrancas");
    await pg.selectOption("select >> nth=0", "2026"); await pg.selectOption("select >> nth=1", "03");
    await pg.waitForSelector("tbody tr:has-text('Alfa Center')");
    await pg.check("thead input[type=checkbox]");
    await pg.click("text=Marcar NF emitida (1)");
    await pg.fill("#dlg2 input[type=date]", "2026-03-04"); await pg.fill("#dlg2 input[placeholder=opcional]", "77");
    await pg.click("#dlg2 >> text=Marcar como emitida");
    await pg.waitForTimeout(400);
    ok((await um(pool, `select nf_emitida, nf_numero, nf_data::text d from ctr_cobrancas where contrato_id = $1 and competencia = '2026/03'`, [ka.id])).nf_numero === "77", "NF marcada com número e data");
    await pg.selectOption("select >> nth=1", "02");
    await pg.click("tbody tr:has-text('Alfa Center')");
    await pg.waitForSelector("#dlg[open] >> text=Dar baixa (sem o extrato)");
    ok(await pg.isVisible("#dlg >> text=cláusula 3.4"), "cobrança atrasada mostra multa e juros da cláusula 3.4");
    await pg.fill("#dlg .form >> nth=0 >> input[type=number]", "1400");
    await pg.click("#dlg >> text=Registrar recebimento");
    await pg.waitForSelector("#dlg .msg.erro:has-text('explique a diferença')");
    ok(true, "baixa com diferença sem observação é recusada pelo banco");
    await pg.fill("#dlg .form >> nth=0 >> input[placeholder^=obrigat]", "retenção de ISS");
    await pg.click("#dlg >> text=Registrar recebimento");
    await pg.waitForTimeout(500);
    ok((await um(pool, `select situacao from ctr_cobrancas_v where contrato_id = $1 and competencia = '2026/02'`, [ka.id])).situacao === "diferenca", "baixa manual com diferença registrada");
    await pg.keyboard.press("Escape");

    // ---------- extrato: sugestão pelo CNPJ e um Pix pagando duas cobranças
    await aba(pg, "extrato");
    const arqOfx = path.join(SAIDA, "nubank.ofx");
    fs.writeFileSync(arqOfx, ofx([["2026-03-27", 1500, "Transferencia recebida pelo Pix - CONDOMINIO ALFA CENTER - 11.222.333/0001-91", "N1"],
      ["2026-03-28", 3800, "Pix recebido FUNDO BETA MALL", "N2"], ["2026-03-28", -120.5, "Pagamento de boleto", "N3"], ["2026-03-29", 0.42, "Rendimento", "N4"]]));
    await pg.setInputFiles('input[accept=".ofx,.OFX"]', arqOfx);
    await pg.click("button:text-is(\"Importar\")");
    await pg.waitForSelector("#toast:has-text('3 crédito(s) novo(s)')");
    ok((await um(pool, "select count(*)::int n from ctr_extrato")).n === 3, "extrato: só os créditos entram");
    await pg.setInputFiles('input[accept=".ofx,.OFX"]', arqOfx); await pg.click("button:text-is(\"Importar\")");
    await pg.waitForSelector("#toast:has-text('3 já importado(s)')");
    ok((await um(pool, "select count(*)::int n from ctr_extrato")).n === 3, "extrato: importar de novo não duplica");
    const linhaAlfa = pg.locator("tbody tr:has-text('11.222.333/0001-91')");
    ok((await linhaAlfa.textContent()).includes("Alfa Center") && (await linhaAlfa.textContent()).includes("sugestão"), "extrato: sugere a cobrança pelo CNPJ");
    await linhaAlfa.locator("text=ligar").click();
    await pg.waitForTimeout(500);
    const pg1 = await um(pool, `select c.competencia, c.pago_em::text from ctr_cobrancas c join ctr_extrato e on e.id = c.extrato_id where e.fitid = 'N1'`);
    ok(pg1 && pg1.pago_em === "2026-03-27", "extrato: crédito ligado dá a baixa na data do Pix");
    await pg.locator("tbody tr:has-text('BETA MALL')").locator("text=escolher…").click();
    await pg.fill("#dlg input[type=search]", "beta");
    const caixas = pg.locator("#dlg .escolha label:has-text('Beta Mall')");
    const nBeta = await caixas.count();
    await caixas.nth(0).locator("input").check(); await caixas.nth(1).locator("input").check();
    await pg.waitForSelector("#dlg >> text=bate com o crédito");
    await pg.click("#dlg >> text=Ligar às cobranças marcadas");
    await pg.waitForTimeout(500);
    ok(nBeta >= 2 && (await um(pool, "select count(*)::int n from ctr_cobrancas c join ctr_extrato e on e.id = c.extrato_id where e.fitid = 'N2'")).n === 2, "extrato: um Pix paga duas cobranças (soma bate)");
    await pg.locator("tbody tr:has-text('Rendimento')").locator("text=não é de contrato").click();
    await pg.fill("#dlg2 textarea", "rendimento da conta"); await pg.click("#dlg2 >> text=Confirmar");
    await pg.waitForTimeout(400);
    ok((await pg.textContent("#conteudo")).includes("Nenhum crédito a conferir."), "extrato: nada mais a conferir");

    // ---------- painel
    await aba(pg, "painel");
    const painel = await pg.textContent("#conteudo");
    ok(painel.includes("Pendências") && painel.includes("Resumo por mês de") && painel.includes("Por cliente em"), "painel: pendências, resumo por mês e por cliente");
    await pg.screenshot({ path: path.join(SAIDA, "contratos-painel.png"), fullPage: true });

    // ---------- auditoria
    const au = await um(pool, `select count(*)::int n, count(distinct acao)::int d from auditoria where acao like 'contratos_%'`);
    ok(au.d >= 10, `auditoria: ${au.n} registros, ${au.d} tipos de ação`);
    ok(erros.length === 0, "sem erros de JavaScript" + (erros.length ? ": " + erros.join(" | ") : ""));

    // ---------- celular
    { const c = await pagina(browser, ADMIN, 390);
      await c.pg.goto(`http://127.0.0.1:${PORTA}/apps/contratos/`); await c.pg.waitForSelector("#app:not([hidden])");
      await aba(c.pg, "cobrancas"); await c.pg.waitForTimeout(300);
      const larg = await c.pg.evaluate(() => document.documentElement.scrollWidth);
      ok(larg <= 392, "celular: sem rolagem lateral na página (" + larg + " px)");
      await c.pg.screenshot({ path: path.join(SAIDA, "contratos-celular.png") });
      await c.ctx.close(); }
  } catch (e) { falhas++; console.log("ERRO  " + (e.stack || e)); }
  await browser.close(); srv.close(); await pool.end();
  console.log(`\n${oks} ok, ${falhas} falha(s). Prints em ${SAIDA}`);
  process.exit(falhas ? 1 : 0);
})();

// lê a planilha real só no navegador (sem banco) e mostra a conferência com a aba Resumo; nada é gravado
async function conferirPlanilhaReal() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(`window.NERVIA_CONFIG={SUPABASE_URL:"http://127.0.0.1:${PORTA}",SUPABASE_ANON_KEY:"anon"};`); }
    if (u.pathname.startsWith("/rest/v1/perfis")) { res.writeHead(200, { "content-type": "application/json" }); return res.end('[{"admin":true}]'); }
    if (u.pathname.startsWith("/rest/v1/ctr_config")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("[{}]"); }
    if (u.pathname.startsWith("/rest/v1/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("[]"); }
    let f = path.join(SITE, u.pathname); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    res.writeHead(fs.existsSync(f) ? 200 : 404, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" }); res.end(fs.existsSync(f) ? fs.readFileSync(f) : "");
  }).listen(PORTA);
  const browser = await chromium.launch(), { pg } = await pagina(browser, ADMIN);
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/contratos/`); await pg.waitForSelector("#app:not([hidden])");
  await pg.setInputFiles('input[accept=".xlsx"]', process.env.PLANILHA); await pg.click("text=Ler planilha");
  await pg.waitForSelector(".aviso, .msg:has-text('batem'), .msg.erro");
  console.log((await pg.textContent("#conteudo")).replace(/\s+/g, " ").slice(0, 6000));
  await pg.screenshot({ path: path.join(SAIDA, "carga-real.png"), fullPage: true });
  await browser.close(); srv.close();
}
