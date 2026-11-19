// Teste de tela do painel de uso do NVPlayer (site/apps/nvplayer/), com o Supabase falso (testes/supabase_falso.js)
// acrescido das tabelas nv_ e das rpcs (as regras em si estão no teste SQL).
// Uso: node testes/nvplayer/tela_nvplayer_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const PRINTS = process.argv[2];
let FALSO = fs.readFileSync(path.join(RAIZ, 'testes', 'supabase_falso.js'), 'utf8');
const TABELAS = `const H = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const diaMenos = (n) => { const d = new Date(H + "T12:00:00"); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const min = (m) => new Date(Date.now() - m * 60000).toISOString();
  const db = {
    nv_aparelhos: [
      { id: "a1", apelido: "TV da sala", modelo: "Amazon AFTKM", android: "11", versao_app: "2.12", versao_codigo: 14, ip: "200.1.2.3", pais: "BR",
        lista_tipo: "xtream", lista_servidor: "p.exemplo.gy", lista_usuario: "marco", lista_status: "Active",
        lista_validade: new Date(Date.now() + 2 * 864e5).toISOString(), lista_telas: "2", lista_telas_uso: "1", canais: 1500, filmes: 8000, series: 900,
        assistindo: "Globo RJ FHD", assistindo_tipo: "vivo", assistindo_grupo: "Abertos", assistindo_desde: min(50), problemas: ["19/11 10:00  SporTV: a imagem parou; reconectado sozinho"],
        primeiro_sinal: min(5000), ultimo_sinal: min(5), sinais: 40 },
      { id: "a2", apelido: "", modelo: "TCL Smart TV", android: "14", versao_app: "2.11", versao_codigo: 13, ip: "189.9.9.9", pais: "BR",
        lista_tipo: "xtream", lista_servidor: "p.exemplo.gy", lista_usuario: "joana", lista_status: "Active",
        lista_validade: new Date(Date.now() + 40 * 864e5).toISOString(), canais: 1500, filmes: 8000, series: 900,
        assistindo: null, problemas: [], primeiro_sinal: min(9000), ultimo_sinal: min(300), sinais: 10 }],
    nv_assistido: [
      { aparelho_id: "a1", dia: diaMenos(0), tipo: "vivo", nome: "Globo RJ FHD", grupo: "Abertos", segundos: 7200, vezes: 3 },
      { aparelho_id: "a2", dia: diaMenos(1), tipo: "vivo", nome: "Globo RJ FHD", grupo: "Abertos", segundos: 1800, vezes: 1 },
      { aparelho_id: "a1", dia: diaMenos(1), tipo: "vivo", nome: "SporTV FHD", grupo: "Esportes", segundos: 3600, vezes: 2 },
      { aparelho_id: "a2", dia: diaMenos(2), tipo: "filme", nome: "Corrida Final", grupo: "Ação", segundos: 6000, vezes: 1 },
      { aparelho_id: "a1", dia: diaMenos(3), tipo: "serie", nome: "A Família", grupo: "Drama", segundos: 5400, vezes: 4 },
      { aparelho_id: "a1", dia: diaMenos(40), tipo: "vivo", nome: "Canal Antigo", grupo: "Abertos", segundos: 9999, vezes: 1 }],`;
const RPC = `
  window.__rpc = async (nome, args) => {
    window.__chamadas.push(["rpc:" + nome, args]);
    if (papel !== "admin") return { data: null, error: { message: "Somente a equipe Nervia." } };
    if (nome === "nv_aparelho_apelido") { db.nv_aparelhos.find((a) => a.id === args.p_id).apelido = args.p_apelido; return { data: null, error: null }; }
    if (nome === "nv_aparelho_excluir") { db.nv_aparelhos = db.nv_aparelhos.filter((a) => a.id !== args.p_id); db.nv_assistido = db.nv_assistido.filter((a) => a.aparelho_id !== args.p_id); return { data: null, error: null }; }
    return { data: null, error: { message: "rpc desconhecida " + nome } };
  };`;
for (const t of ['const db = {', 'from: consulta,', 'window.__chamadas = [];', 'tel_arquivos: () => papel === "admin" };'])
  if (!FALSO.includes(t)) throw new Error('supabase_falso.js mudou: ' + t);
FALSO = FALSO.replace('const db = {', TABELAS).replace('window.__chamadas = [];', 'window.__chamadas = [];' + RPC)
  .replace('from: consulta,', 'from: consulta, rpc: (n, a) => window.__rpc(n, a),')
  .replace('tel_arquivos: () => papel === "admin" };', 'tel_arquivos: () => papel === "admin", nv_aparelhos: () => papel === "admin", nv_assistido: () => papel === "admin" };')
  .replace('const t = db[tabela];', 'const t = db[tabela] || [];');
const CONFIG = 'window.NERVIA_CONFIG={SUPABASE_URL:"https://teste.supabase.co",SUPABASE_ANON_KEY:"x"};';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let f = path.join(RAIZ, 'site', decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});

const falhas = [];
const ok = (c, nome) => { console.log((c ? 'ok  ' : 'FALHOU ') + nome); if (!c) falhas.push(nome); };

(async () => {
  await new Promise(r => srv.listen(8831, '127.0.0.1', r));
  const nav = await chromium.launch();
  const pg = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = []; pg.on('pageerror', e => erros.push(String(e)));
  pg.on('dialog', d => d.type() === 'prompt' ? d.accept('TV do quarto') : d.accept());
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await pg.route('**/config.js', r => r.fulfill({ body: CONFIG, contentType: 'text/javascript' }));

  await pg.goto('http://127.0.0.1:8831/apps/nvplayer/?papel=admin');
  await pg.waitForSelector('#tela table');
  let t = await pg.innerText('#tela');
  ok(t.includes('TV da sala') && t.includes('Globo RJ FHD') && t.includes('Abertos'), 'aparelho com o que está passando agora');
  ok(t.includes('marco') && t.includes('p.exemplo.gy') && t.includes('1 em uso de 2'), 'lista: usuário, servidor e telas');
  ok(/vence \d\d\/\d\d\/\d{4}/.test(t), 'validade perto de vencer em destaque');
  ok((t.match(/desatualizado/g) || []).length >= 2 && t.includes('fechado'), 'app desatualizado (versão publicada) e aparelho fechado');
  ok(/1\s+listas vencendo/.test(t) && /1\s+assistindo agora/.test(t), 'números do topo');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'nvplayer-aparelhos.png'), fullPage: true });

  await pg.click('.aba[data-v="mais"]');
  t = await pg.innerText('#tela');
  const iGlobo = t.indexOf('Globo RJ FHD'), iSport = t.indexOf('SporTV FHD');
  ok(iGlobo > 0 && iSport > iGlobo && t.includes('2 h 30 min'), 'canais mais assistidos em ordem, somando os aparelhos');
  ok(t.includes('Corrida Final') && t.includes('A Família') && !t.includes('Canal Antigo'), 'filmes, séries e só o período escolhido');
  await pg.selectOption('#selAp', 'a2');
  t = await pg.innerText('#tela');
  ok(t.includes('30 min') && !t.includes('SporTV FHD'), 'filtro por aparelho');
  await pg.selectOption('#selAp', '');
  await pg.selectOption('#selPer', '90');
  await pg.waitForFunction(() => document.querySelector('#tela').innerText.includes('Canal Antigo'));
  ok(true, 'período de 90 dias traz o histórico mais antigo');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'nvplayer-mais.png'), fullPage: true });

  await pg.click('.aba[data-v="problemas"]');
  t = await pg.innerText('#tela');
  ok(t.includes('a imagem parou; reconectado sozinho'), 'problemas de vídeo por aparelho');

  await pg.click('.aba[data-v="aparelhos"]');
  await pg.click('button[data-ren="a2"]');
  await pg.waitForFunction(() => document.querySelector('#tela').innerText.includes('TV do quarto'));
  ok(true, 'apelido do aparelho');
  await pg.click('button[data-exc="a2"]');
  await pg.waitForFunction(() => !document.querySelector('#tela').innerText.includes('TV do quarto'));
  ok(true, 'excluir aparelho');

  // cliente: não vê o painel
  const pc = await nav.newPage();
  await pc.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await pc.route('**/config.js', r => r.fulfill({ body: CONFIG, contentType: 'text/javascript' }));
  await pc.goto('http://127.0.0.1:8831/apps/nvplayer/?papel=cliente');
  await pc.waitForFunction(() => /equipe Nervia/.test(document.querySelector('#aviso').innerText));
  ok(true, 'cliente não vê o painel');

  // celular: sem rolagem lateral da página
  await pg.setViewportSize({ width: 390, height: 800 });
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 392), 'celular sem rolagem lateral');

  ok(!erros.length, 'sem erro de JavaScript ' + erros.join(' | '));
  await nav.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTODOS OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
