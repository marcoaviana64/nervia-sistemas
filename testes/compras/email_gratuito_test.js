// E-mail de domínio gratuito do fornecedor (pedido do Marco em 04/11/2026): −1 na nota de qualidade da matriz,
// etiqueta no mapa, aviso no cadastro e no convite (comprador), linha na mensagem do convite, aviso na página da
// cotação e no cadastro de fornecedores (/fornecedores/). Roda contra a demonstração (sem rede, sem Supabase).
// Uso: node testes/compras/email_gratuito_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http'), vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const PRINTS = process.argv[2];
const falhas = [];
const ok = (c, nome) => { console.log((c ? 'ok  ' : 'FALHOU ') + nome); if (!c) falhas.push(nome); };

// 1) a lista de domínios
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(RAIZ, 'site', 'email-gratuito.js'), 'utf8'), ctx);
const G = ctx.window.NERVIA_EMAIL.gratuito;
ok(G('fulano@gmail.com') && G(' Vendas@Hotmail.com.br ') && G('x@uol.com.br') && G('x@icloud.com') && G('x@outlook.com'), 'reconhece domínios gratuitos (maiúsculas e espaços)');
ok(!G('vendas@empresa.com.br') && !G('x@gmail.com.empresa.com') && !G('x@mailgmail.com') && !G('') && !G(null) && !G('gmail.com'), 'domínio próprio e texto sem @ não contam');

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, res) => {
  let f = path.join(RAIZ, 'site', decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => srv.listen(8826, '127.0.0.1', r));
  const nav = await chromium.launch();
  const pg = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = []; pg.on('pageerror', e => erros.push(String(e)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());   // nada sai para a rede

  // 2) Orçamentos de Compras (demonstração)
  await pg.goto('http://127.0.0.1:8826/demo/compras/'); await pg.evaluate(() => localStorage.clear()); await pg.reload();
  await pg.waitForSelector('#app:not(.oculto)');
  ok(await pg.evaluate(() => notaMatriz({ nota: 4, email: 'a@gmail.com' }) === 3 && notaMatriz({ nota: 1, email: 'a@gmail.com' }) === 1
    && notaMatriz({ nota: null, email: 'a@gmail.com' }) === 2 && notaMatriz({ nota: 4, email: 'a@empresa.com.br' }) === 4 && notaMatriz({ nota: null, email: '' }) === 3),
    'nota de qualidade da matriz: −1 com e-mail gratuito (mínimo 1; sem avaliação 3 → 2)');
  await pg.click('[data-v=reqs]'); await pg.click("tr[data-req='1008']"); await pg.waitForTimeout(300);
  const antes = await pg.evaluate(() => { const r = REQS.find(x => x.id === 1008);
    const props = DET.props.filter(p => !ehInternet(p)); const sc = pontuar(r, DET.props);
    const i = DET.props.findIndex(p => !ehInternet(p) && !emailGratis(fornecedor(p.fornecedor_id)));
    return { forn: DET.props[i].fornecedor_id, nome: fornecedor(DET.props[i].fornecedor_id).nome, total: sc[i].total, n: props.length }; });
  ok(antes.n >= 2 && !(await pg.innerText('#tela')).includes('e-mail gratuito'), 'mapa sem etiqueta com e-mails de domínio próprio');
  // troca o e-mail do fornecedor para um gratuito pela tela de Fornecedores
  await pg.click('[data-v=forn]'); await pg.waitForTimeout(300);
  await pg.locator('tr', { hasText: antes.nome }).locator('[data-acao=editForn]').click();
  const email = pg.locator('dialog input[name=email]');
  await email.fill('compras.teste@gmail.com');
  ok(await pg.isVisible('dialog .aviso-email') && (await pg.innerText('dialog .aviso-email')).includes('perde 1 ponto'), 'cadastro do fornecedor avisa o comprador');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'compras-cadastro-email.png') });
  await email.fill('compras@empresa-teste.com.br');
  ok(!(await pg.isVisible('dialog .aviso-email')), 'aviso some com domínio próprio');
  await email.fill('compras.teste@gmail.com');
  await pg.click('dialog [value=ok]'); await pg.waitForTimeout(400);
  await pg.click('[data-v=reqs]'); await pg.click("tr[data-req='1008']"); await pg.waitForTimeout(300);
  const t = await pg.innerText('#tela');
  ok(t.includes('e-mail gratuito · −1 na qualidade'), 'mapa mostra a etiqueta do e-mail gratuito');
  const depois = await pg.evaluate((id) => { const sc = pontuar(REQS.find(x => x.id === 1008), DET.props); const i = DET.props.findIndex(p => p.fornecedor_id === id); return sc[i].total; }, antes.forn);
  const peso = await pg.evaluate(() => unidade().pesos.qualidade);
  ok(Math.abs((antes.total - depois) - peso / 5) < 0.01, `nota na matriz cai ${peso / 5} ponto(s) (1 de 5 na qualidade × peso ${peso}%)`);
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'compras-mapa-email.png'), fullPage: true });
  // mensagem do convite
  const msgs = await pg.evaluate((id) => {
    const r = REQS.find(x => x.id === 1008), c = { fornecedor_id: id, prazo: '2026-12-01', codigo: 'x' };
    return [textoConvite(c, r), textoConvite({ ...c, fornecedor_id: null, contato_nome: 'Fulano', email: 'f@empresa.com.br' }, r),
            textoConvite({ ...c, fornecedor_id: null, contato_nome: 'Fulano', email: '' }, r)];
  }, antes.forn);
  ok(msgs[0].includes('reduz a pontuação') && !msgs[1].includes('reduz a pontuação') && msgs[2].includes('reduz a pontuação'), 'mensagem do convite avisa (e-mail gratuito ou sem e-mail), não avisa com domínio próprio');

  // 3) página da cotação (demo, convite de exemplo de contato sem cadastro)
  const cot = await nav.newPage();
  await cot.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await cot.goto('http://127.0.0.1:8826/demo/cotacao/'); await cot.waitForSelector('#pagina:not(.oculto)');
  if (await cot.isVisible('#email')) {
    await cot.fill('#email', 'vendas@hotmail.com');
    ok(await cot.isVisible('.aviso-email') && (await cot.innerText('.aviso-email')).includes('reduz a sua pontuação'), 'cotação: aviso ao fornecedor com e-mail gratuito');
    await cot.fill('#email', 'vendas@empresa.com.br');
    ok(!(await cot.isVisible('.aviso-email')), 'cotação: sem aviso com domínio próprio');
  } else ok(await cot.evaluate(() => !!document.querySelector('.aviso-email')), 'cotação: aviso ligado ao campo de e-mail (fornecedor da base não digita e-mail)');

  // 4) cadastro de fornecedores (página pública; sem Supabase o carregamento falha, o aviso continua)
  const forn = await nav.newPage();
  await forn.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await forn.goto('http://127.0.0.1:8826/fornecedores/'); await forn.waitForSelector('#email');
  await forn.fill('#email', 'contato@yahoo.com.br');
  ok(await forn.isVisible('.aviso-email'), 'cadastro de fornecedores: aviso com e-mail gratuito');
  await forn.fill('#email', 'contato@empresa.com.br');
  ok(!(await forn.isVisible('.aviso-email')), 'cadastro de fornecedores: sem aviso com domínio próprio');

  ok(erros.length === 0, 'sem erro de JavaScript' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await nav.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTODOS OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
