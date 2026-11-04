// Teste de tela dos avisos por e-mail do Monitor de Links (Administração → Avisos por e-mail),
// com o Supabase falso (testes/supabase_falso.js) acrescido das tabelas mon_.
// Uso: node testes/monitor/tela_avisos_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const PRINTS = process.argv[2];
let FALSO = fs.readFileSync(path.join(RAIZ, 'testes', 'supabase_falso.js'), 'utf8');
const MON = `const db = {
    mon_locais: [{ id: "L1", nome: "Taquara Recepção", cliente: "Iguardei", obs: "", ativo: true }, { id: "L2", nome: "Vogue Datacenter", cliente: "Iguardei", obs: "", ativo: true }],
    mon_equipamentos: [], mon_links: [], mon_quedas: [], mon_acessos: [], mon_amostras: [],
    mon_avisos_destinos: [{ id: 1, email: "noc@nervia.com.br", local_id: null }],`;
if (!FALSO.includes('const db = {') || !FALSO.includes('email_envios: [{')) throw new Error('supabase_falso.js mudou');
FALSO = FALSO.replace('const db = {', MON).replace('email_envios: [{',
  'email_envios: [{ id: 9, em: "2026-11-04T01:06:00-03:00", tipo: "monitor_aviso", para: "noc@nervia.com.br", assunto: "🔴 Caiu: Link via VPN Vogue — Taquara Recepção", ok: true, erro: null }, {');
const CONFIG = 'window.NERVIA_CONFIG={SUPABASE_URL:"https://teste.supabase.co",SUPABASE_ANON_KEY:"x"};';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let f = path.join(RAIZ, 'site', decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});

const falhas = [];
const ok = (c, nome) => { console.log((c ? 'ok  ' : 'FALHOU ') + nome); if (!c) falhas.push(nome); };

(async () => {
  await new Promise(r => srv.listen(8823, '127.0.0.1', r));
  const nav = await chromium.launch();
  const pg = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = []; pg.on('pageerror', e => erros.push(String(e)));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await pg.route('**/config.js', r => r.fulfill({ body: CONFIG, contentType: 'text/javascript' }));
  await pg.goto('http://127.0.0.1:8823/apps/monitor/?papel=admin');
  await pg.click('#abaAdmin');
  await pg.waitForSelector('#avisosCard table');
  const txt = () => pg.innerText('#avisosCard');
  let t = await txt();
  ok(t.includes('noc@nervia.com.br') && t.includes('Todos os locais'), 'lista quem recebe (todos os locais)');
  ok(t.includes('Caiu: Link via VPN Vogue') && t.includes('enviado'), 'mostra o último aviso enviado');
  ok(!t.includes('Teste de e-mail'), 'só os envios do Monitor');
  // incluir destinatário de um local
  await pg.click('[data-acao=novoDestino]');
  await pg.fill('#dlg input[name=email]', 'TI@Cliente.com');
  await pg.selectOption('#dlg select[name=local]', 'L1');
  await pg.click('#dlg button[value=ok]');
  await pg.waitForFunction(() => document.querySelector('#avisosCard').innerText.includes('ti@cliente.com'));
  ok((await txt()).includes('Taquara Recepção'), 'incluído com o local, e-mail em minúsculas');
  // e-mail inválido
  await pg.click('[data-acao=novoDestino]');
  await pg.evaluate(() => { document.querySelector('#dlg input[name=email]').type = 'text'; });
  await pg.fill('#dlg input[name=email]', 'x@y');
  await pg.click('#dlg button[value=ok]');
  await pg.waitForTimeout(300);
  ok((await pg.innerText('#msg')).includes('E-mail inválido'), 'e-mail inválido recusado');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'monitor_avisos.png'), fullPage: true });
  // retirar
  pg.once('dialog', d => d.accept());
  await pg.click("[data-acao=tiraDestino][data-id='1']");
  await pg.waitForFunction(() => !document.querySelector('#avisosCard table').innerText.includes('noc@nervia.com.br'));
  ok(true, 'retirar destinatário');
  // celular sem rolagem lateral
  await pg.setViewportSize({ width: 390, height: 800 });
  await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'celular sem rolagem lateral');
  ok(!erros.length, 'sem erro de JavaScript ' + erros.join('; '));
  await nav.close(); srv.close();
  console.log(falhas.length ? `${falhas.length} FALHA(S)` : 'TODOS OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
