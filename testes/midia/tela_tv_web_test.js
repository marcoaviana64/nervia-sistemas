// Teste do reprodutor web do Mídia Indoor (site/tv/) com o Playwright do Node: servidor local da pasta site/,
// função midia-tv e Google Drive IMITADOS (page.route), vídeo e imagem reais gerados pelo ffmpeg.
// Confere: código → vínculo → baixa e guarda → passa vídeo e imagem em loop → sinal de vida → posição da TV →
// tela de espera → abre e passa SEM internet (service worker + mídias guardadas) → desvinculada volta ao código.
// Uso: node testes/midia/tela_tv_web_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8842;
const URL_SB = /functions\/v1\/midia-tv/;

let falhas = 0, oks = 0;
const ok = (c, m) => { if (c) { oks++; console.log('ok ', m); } else { falhas++; console.log('FALHOU', m); } };

// mídias de verdade (o Chromium do Playwright toca H.264)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tvweb-'));
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(tmp, 'v.mp4')]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=640x360', '-frames:v', '1', path.join(tmp, 'i.png')]);
const VIDEO = fs.readFileSync(path.join(tmp, 'v.mp4')), IMAGEM = fs.readFileSync(path.join(tmp, 'i.png'));

// servidor da pasta site/
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(RAIZ, 'site', p);
  if (!f.startsWith(path.join(RAIZ, 'site')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nao achei'); }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(PORTA);

// "servidor" imitado
const S = { aguardou: 0, vinculado: false, desvinculada: false, rotacao: 0, playlist: 'Hall', itens: 'dois', sinais: [], downloads: [] };
const itensDe = () => S.itens === 'nenhum' ? [] : [
  { id: 'F1', nome: '01_promo.mp4', tipo: 'video', md5: 'aaa111', tamanho: VIDEO.length, tempo_s: null, url: 'https://www.googleapis.com/drive/v3/files/F1?alt=media&supportsAllDrives=true', chave_recurso: null },
  { id: 'F2', nome: '02_horario.png', tipo: 'imagem', md5: 'bbb222', tamanho: IMAGEM.length, tempo_s: 3, url: 'https://www.googleapis.com/drive/v3/files/F2?alt=media&supportsAllDrives=true', chave_recurso: 'rk-1' },
];
async function funcao(route) {
  const c = route.request().postDataJSON();
  const j = (st, corpo) => route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(corpo), headers: { 'Access-Control-Allow-Origin': '*' } });
  if (c.acao === 'codigo') return j(200, { ok: true, codigo: 'ABC234' });
  if (c.acao === 'aguardar') { S.aguardou++; return j(200, S.aguardou >= 2 ? (S.vinculado = true, { ok: true, situacao: 'vinculado', token: 'TOK-1', tela: 'Recepção' }) : { ok: true, situacao: 'aguardando' }); }
  if (S.desvinculada || c.token !== 'TOK-1') return j(401, { ok: false, situacao: 'desvinculada' });
  if (c.acao === 'playlist') {
    const itens = itensDe();
    return j(200, { ok: true, tela: 'Recepção', playlist: S.itens === 'nenhum' ? '' : S.playlist, itens, conteudo: 'c-' + itens.length, chave_api: 'CHAVE-TESTE', rotacao: S.rotacao, intervalo_playlist_s: 20, intervalo_sinal_s: 60 });
  }
  if (c.acao === 'sinal') { S.sinais.push(c); return j(200, { ok: true }); }
  return j(400, { ok: false, mensagem: 'ação?' });
}
async function drive(route) {
  const u = new URL(route.request().url());
  S.downloads.push({ id: u.pathname.split('/').pop(), chave: u.searchParams.get('key'), rk: route.request().headers()['x-goog-drive-resource-keys'] || '' });
  const id = u.pathname.split('/').pop();
  return route.fulfill({ status: 200, body: id === 'F1' ? VIDEO : IMAGEM, contentType: id === 'F1' ? 'video/mp4' : 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } });
}

const espera = async (fn, ms = 20000, passo = 200) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, passo)); } return false; };

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route(URL_SB, funcao);
  await ctx.route(/googleapis\.com\/drive/, drive);
  const pg = await ctx.newPage();
  const errosJs = []; pg.on('pageerror', e => errosJs.push(e.message));
  const vis = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
  const estado = () => pg.evaluate(() => window.__miTeste.estado());
  const print = async (n) => { if (SAIDA) { fs.mkdirSync(SAIDA, { recursive: true }); await pg.screenshot({ path: path.join(SAIDA, n + '.png') }); } };

  await pg.goto(`http://localhost:${PORTA}/tv/`);
  ok(await espera(async () => (await pg.textContent('#pCodigo')) === 'ABC234'), 'mostra o código de vínculo');
  ok((await pg.textContent('#pTitulo')).includes('web 1.0'), 'versão na tela do código');
  await print('1-codigo');

  ok(await espera(async () => S.vinculado && (await estado()).token === 'TOK-1', 15000), 'vinculou e guardou o token');
  ok(await espera(async () => S.downloads.length >= 2, 15000), 'baixou os dois arquivos do Drive');
  ok(S.downloads.every(d => d.chave === 'CHAVE-TESTE'), 'download com a chave da API');
  ok(S.downloads.find(d => d.id === 'F2')?.rk === 'F2/rk-1', 'resource key no cabeçalho X-Goog-Drive-Resource-Keys');
  const guardados = await pg.evaluate(async () => (await (await caches.open('mi-midias-v1')).keys()).map(k => new URL(k.url).pathname));
  ok(guardados.length === 2 && guardados.some(g => g.includes('F1_aaa111.mp4')), 'mídias guardadas no navegador: ' + guardados.join(', '));

  ok(await espera(() => vis('video.on')), 'passando o vídeo');
  ok(await espera(() => pg.evaluate(() => { const v = document.getElementById('video'); return v.currentTime > 0.3 && !v.paused; })), 'vídeo andando');
  await print('2-video');
  ok(await espera(() => vis('#imagem.on'), 8000), 'depois do vídeo, a imagem');
  ok(await espera(() => vis('video.on'), 8000), 'loop: volta ao vídeo depois do tempo da imagem');
  ok(!(await vis('#vitrine.on')) && !(await vis('#painel.on')), 'sem tela de espera nem painel enquanto passa');

  ok(await espera(() => S.sinais.length >= 1), 'mandou o sinal de vida');
  const s0 = S.sinais[S.sinais.length - 1] || {};
  ok(s0.versao_app === 'web 1.0' && /^Computador · Chrome \d+/.test(s0.modelo) && s0.android === '', 'sinal com versão e navegador: ' + s0.modelo);
  ok(typeof s0.espaco_livre_mb === 'number' && s0.espaco_livre_mb > 100, 'sinal com espaço livre (' + s0.espaco_livre_mb + ' MB)');

  // posição da TV: em pé
  S.rotacao = 90;
  await pg.reload();
  ok(await espera(async () => (await estado()).rotacao === 90), 'posição da TV recebida (90°)');
  const caixa = await pg.evaluate(() => { const r = document.getElementById('palco').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  ok(caixa[0] === 1280 && caixa[1] === 720, 'palco girado ocupa a tela inteira (' + caixa + ')');
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('palco')).transform !== 'none'), 'palco girado');
  ok(await espera(() => vis('video.on') || vis('#imagem.on')), 'continua passando depois de recarregar (mídias guardadas)');
  await print('3-em-pe');

  // tela de espera (sem playlist), deitada e em pé
  S.itens = 'nenhum'; S.rotacao = 0;
  await pg.reload();
  ok(await espera(() => vis('#vitrine.on')), 'sem playlist: tela de espera');
  ok(await espera(async () => (await pg.textContent('#vSituacao')).includes('nenhuma playlist escolhida para esta TV')), 'pé da tela de espera com o motivo');
  ok((await pg.textContent('#vSituacao')).includes('web 1.0') && (await pg.textContent('#vSituacao')).includes('Recepção'), 'pé com o nome da TV e a versão');
  ok(await pg.evaluate(() => [...document.querySelectorAll('#vitrine img')].every(i => i.complete && i.naturalWidth > 0)), 'logo e QR code carregados');
  ok(await espera(async () => (await pg.evaluate(() => (caches.open('mi-midias-v1').then(c => c.keys()).then(k => k.length)))) === 0), 'playlist vazia: mídias apagadas do navegador');
  await print('4-espera-deitada');
  S.rotacao = 90;
  await pg.reload();
  ok(await espera(async () => (await estado()).rotacao === 90 && await pg.evaluate(() => document.getElementById('palco').classList.contains('alto'))), 'tela de espera em pé: empilhada');
  await print('5-espera-em-pe');

  // sem internet: volta a playlist, baixa, e depois abre sem rede
  S.itens = 'dois'; S.rotacao = 0;
  await pg.reload();
  ok(await espera(async () => (await pg.evaluate(() => caches.open('mi-midias-v1').then(c => c.keys()).then(k => k.length))) === 2, 15000), 'baixou de novo');
  ok(await espera(() => pg.evaluate(() => !!navigator.serviceWorker.controller), 10000), 'service worker controlando a página');
  await ctx.setOffline(true);
  await pg.reload();
  ok(await espera(() => vis('video.on') || vis('#imagem.on'), 15000), 'SEM INTERNET: a página abre e passa o que está guardado');
  await print('6-sem-internet');
  await ctx.setOffline(false);

  // desvinculada no painel: volta ao código e apaga as mídias
  S.desvinculada = true; S.aguardou = -1000;
  await pg.reload();
  ok(await espera(async () => (await pg.textContent('#pCodigo')) === 'ABC234', 20000), 'desvinculada: volta à tela do código');
  ok(await espera(async () => (await pg.evaluate(() => caches.open('mi-midias-v1').then(c => c.keys()).then(k => k.length))) === 0), 'desvinculada: mídias apagadas');
  ok((await estado()).token === null, 'desvinculada: token apagado');

  ok(errosJs.length === 0, 'sem erro de JavaScript' + (errosJs.length ? ': ' + errosJs.join(' | ') : ''));
  await navegador.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
