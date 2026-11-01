// Teste de tela da aba Etiquetas do Sistema Linum (site/apps/linum/etiquetas.js) com o Playwright do Node e um Supabase
// IMITADO no navegador (só o que a aba usa: lin_estoque_ler, horário e permissões). Produtos FICTÍCIOS.
// Confere a tela (busca, leitor de código, peça especial, digitação à mão, lista guardada) e o PDF de verdade, gerado pelo
// jsPDF: texto, número de folhas e a leitura de TODOS os códigos de barras com o zbar (pyzbar) a 300 dpi.
// Precisa de: Playwright, jsPDF 2.5.1 (JSPDF=caminho do jspdf.umd.min.js; sem ele usa o CDN), pdftoppm/pdftotext e
// python3 com pyzbar + libzbar. Uso: node testes/linum/tela_etiquetas_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8832;

const DADOS = {
  papel: 'vendedora', minha_loja: 'l-gav', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [
    { id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', categoria: 'Vestido', preco_venda: 489, codigo_barras: '20260000101', tecido: '100% Linho',
      variantes: [{ id: 'v1', cor: 'Azul', tamanho: 'P', edicao: '', preco_venda: null, codigo_barras: null },
                  { id: 'v2', cor: 'Azul', tamanho: 'M', edicao: '', preco_venda: null, codigo_barras: null },
                  { id: 'v3', cor: 'Off White', tamanho: 'M', edicao: '', preco_venda: null, codigo_barras: null },
                  { id: 'v4', cor: 'Azul', tamanho: 'G', edicao: '', preco_venda: null, codigo_barras: null }] },
    { id: 'p2', referencia: 'CAL-ARE', descricao: 'Calça Areia', categoria: 'Calça', preco_venda: 1359, codigo_barras: '20260000102', tecido: null,
      variantes: [{ id: 'v5', cor: 'Cru', tamanho: '38', edicao: '', preco_venda: null, codigo_barras: null },
                  { id: 'v8', cor: 'Cru', tamanho: '40', edicao: 'Bordada', preco_venda: 1590, codigo_barras: '20260000318' }] },
    { id: 'p3', referencia: 'CAM-BRI', descricao: 'Camisa Brisa', categoria: 'Camisa', preco_venda: 299, codigo_barras: '20260000103', tecido: 'Linho 100% ou Gaze de linho',
      variantes: [] }],
  estoque: [['v1', 'l-gav', 3], ['v2', 'l-gav', 1], ['v4', 'l-gav', 2], ['v5', 'l-gav', 4], ['v8', 'l-gav', 1], ['v2', 'l-ipa', 5]],
};
const FALSO = `(() => {
  const D = ${JSON.stringify(DADOS)};
  const ok = data => Promise.resolve({ data, error: null });
  const consulta = () => { const q = { select: () => q, eq: () => q, order: () => q, maybeSingle: () => ok({ admin: false }), then: (r, j) => ok([]).then(r, j) }; return q; };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-vend' } } } }) },
    from: () => consulta(),
    rpc: async fn => fn === 'lin_estoque_ler' ? { data: JSON.parse(JSON.stringify(D)), error: null }
      : fn === 'lin_meu_horario' ? { data: { liberado: true }, error: null }
      : fn === 'lin_minhas_permissoes' ? { data: { producao: false, producao_valores: false }, error: null }
      : { data: null, error: null } }) };
})();`;

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/config.js') { res.end('window.NERVIA_CONFIG={SUPABASE_URL:"http://x",SUPABASE_ANON_KEY:"anon"};'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(RAIZ, 'site', p);
    if (!f.startsWith(path.join(RAIZ, 'site')) || !fs.existsSync(f)) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  }).listen(PORTA);
}

let falhas = 0, oks = 0;
function ok(cond, nome) { if (cond) { oks++; console.log('ok  ' + nome); } else { falhas++; console.log('FALHOU  ' + nome); } }

async function pagina(ctx) {
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push(String(e)));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  if (process.env.JSPDF) await pg.route('**/jspdf/2.5.1/**', r => r.fulfill({ body: fs.readFileSync(process.env.JSPDF), contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const linhas = pg => pg.$$eval('#etqlista table tr', trs => trs.slice(1).map(tr => [...tr.querySelectorAll('td')].slice(0, 7).map(td => td.querySelector('input') ? td.querySelector('input').value : td.textContent.trim())));

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const { pg, erros } = await pagina(ctx);
    ok(await pg.locator('#abaEtiquetas').isVisible(), 'vendedora vê a aba Etiquetas');
    await pg.click('#abaEtiquetas');
    ok((await pg.locator('#etqlista').innerText()).includes('Nenhuma etiqueta na lista'), 'lista começa vazia');

    // busca pelo nome, sem acento e em minúsculas
    await pg.fill('#etq', 'calca');
    ok((await pg.locator('#etqres [data-ep]').count()) === 1, 'busca sem acento acha a Calça Areia');
    await pg.fill('#etq', 'vest');
    await pg.click('#etqres [data-ep]');
    ok((await pg.locator('#etqprod [data-eq]').count()) === 4, 'a peça mostra uma linha por variação');
    ok(await pg.inputValue('#ep_tec') === '100% Linho' && await pg.inputValue('#ep_loja') === 'l-gav', 'tecido do cadastro e a loja da vendedora');
    await pg.click('#ep_est');
    ok((await pg.locator('#ep_tot').innerText()) === '6 etiquetas', 'uma por peça em estoque na Gávea: 6');
    await pg.selectOption('#ep_loja', 'l-ipa'); await pg.click('#ep_est');
    ok((await pg.locator('#ep_tot').innerText()) === '5 etiquetas', 'trocando a loja: o estoque de Ipanema (5)');
    await pg.selectOption('#ep_loja', 'l-gav'); await pg.click('#ep_est');
    await print(pg, 'etq_peca');
    await pg.click('#ep_add');
    let l = await linhas(pg);
    ok(l.length === 3 && l.map(x => x[2]).join() === 'P,M,G' && l.every(x => x[4] === 'R$ 489' && x[5] === '20260000101'),
      'entram P, M e G com o preço e o código do produto');
    ok(l.map(x => x[6]).join() === '3,1,2', 'quantidades do estoque');

    // leitor de código de barras (Enter): a peça especial com código, preço e edição próprios
    await pg.fill('#etq', '20260000318'); await pg.press('#etq', 'Enter');
    ok((await pg.locator('#etqprod').innerText()).includes('Calça Areia') && (await pg.locator('#etqprod').innerText()).includes('peça especial'),
      'leitura do código abre a peça (com a peça especial marcada)');
    ok(await pg.inputValue('#ep_tec') === '100% Linho', 'produto sem tecido no cadastro: sugere 100% Linho');
    await pg.fill('#etqprod [data-eq="v8"]', '2');
    await pg.click('#ep_add');
    l = await linhas(pg);
    ok(l.length === 4 && l[3][1] === 'Calça Areia Bordada' && l[3][2] === '40' && l[3][4] === 'R$ 1.590' && l[3][5] === '20260000318',
      'peça especial: descrição com a edição, preço e código próprios');
    // a mesma etiqueta de novo soma a quantidade
    await pg.fill('#etq', 'VES-MAR'); await pg.press('#etq', 'Enter');
    await pg.fill('#etqprod [data-eq="v4"]', '4'); await pg.click('#ep_add');
    l = await linhas(pg);
    ok(l.length === 4 && l[2][6] === '6', 'a mesma etiqueta soma a quantidade (G: 2 + 4)');
    // sem cores e tamanhos
    await pg.fill('#etq', 'brisa'); await pg.click('#etqres [data-ep]');
    ok((await pg.locator('#etqprod').innerText()).includes('ainda não tem cores e tamanhos'), 'peça sem variações: aviso');
    await pg.click('#ep_fechar');

    // à mão
    await pg.click('#em_add');
    ok((await pg.locator('#msg').innerText()).includes('Informe a referência'), 'à mão: referência obrigatória');
    await pg.fill('#em_ref', 'TESTE-1'); await pg.fill('#em_desc', 'Kimono Avulso'); await pg.fill('#em_tam', 'u');
    await pg.fill('#em_val', '1.250,00'); await pg.fill('#em_qtd', '3'); await pg.fill('#em_cod', 'Ação');
    await pg.click('#em_add');
    ok((await pg.locator('#msg').innerText()).includes('código de barras só pode'), 'à mão: código com acento é recusado');
    await pg.fill('#em_cod', ''); await pg.click('#em_add');
    l = await linhas(pg);
    ok(l.length === 5 && l[4][2] === 'U' && l[4][4] === 'R$ 1.250' && l[4][5] === 'sem código', 'à mão: sem código, tamanho em maiúscula, valor arredondado');
    const kp = await pg.locator('#etqlista .kpi b').allInnerTexts();
    ok(kp.join('|') === '15|2|9', 'totais: 15 etiquetas, 2 folhas, 9 espaços vazios');
    await print(pg, 'etq_lista');

    // a lista fica guardada no navegador
    await pg.reload(); await pg.waitForSelector('#app:not(.oculto)'); await pg.click('#abaEtiquetas');
    ok((await linhas(pg)).length === 5, 'a lista continua depois de recarregar a página');

    // PDF de verdade
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('#etq_pdf')]);
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'etq-')), pdf = path.join(pasta, 'etiquetas.pdf');
    await dl.saveAs(pdf);
    ok(/^Etiquetas Linum \d{2}-\d{2}-\d{4}\.pdf$/.test(dl.suggestedFilename()), 'nome do arquivo com a data');
    const info = execFileSync('pdfinfo', [pdf]).toString();
    ok(/Pages:\s+2/.test(info) && /612 x 792/.test(info), 'PDF Carta com 2 folhas');
    const txt = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
    ok(!/Tam\./.test(txt) && txt.includes('Calça Areia Bordada') && txt.includes('R$ 1.590') && txt.includes('Kimono Avulso'),
      'o PDF sai sem o tamanho impresso (só o quadro em branco), a peça especial e a etiqueta digitada');
    ok((txt.match(/Prazo de troca: 30 dias/g) || []).length === 15, 'um cabeçalho por etiqueta (15)');
    execFileSync('pdftoppm', ['-r', '300', '-png', pdf, path.join(pasta, 'p')]);
    const leitura = execFileSync('python3', ['-c', `
import glob, json
from PIL import Image
from pyzbar import pyzbar
k = 300 / 72; r = []
for f in sorted(glob.glob(${JSON.stringify(pasta)} + '/p-*.png')):
    im = Image.open(f).convert('L')
    for pos in range(12):
        ox, oy = (pos % 4) * 136, (pos // 4) * 216.3
        for y0, y1 in ((150, 205), (205, 258)):
            c = im.crop((int((30 + ox) * k), int((y0 + oy) * k), int((171 + ox) * k), int((y1 + oy) * k)))
            d = pyzbar.decode(c, symbols=[pyzbar.ZBarSymbol.CODE128])
            r.append(d[0].data.decode() if d else '')
print(json.dumps(r))`]).toString();
    const cods = JSON.parse(leitura);
    const esperado = [...Array(3).fill('20260000101'), ...Array(1).fill('20260000101'), ...Array(6).fill('20260000101'), ...Array(2).fill('20260000318'), ...Array(3).fill('')]
      .flatMap(c => [c, c]);
    ok(JSON.stringify(cods.slice(0, esperado.length)) === JSON.stringify(esperado), 'todos os 24 códigos de barras são lidos (e a etiqueta sem código sai sem barras)');
    ok(cods.slice(esperado.length).every(c => c === ''), 'espaços vazios da última folha ficam em branco');
    if (SAIDA) fs.copyFileSync(pdf, path.join(SAIDA, 'etq.pdf'));

    await pg.click('#etq_limpar');
    ok((await pg.locator('#etqlista').innerText()).includes('Nenhuma etiqueta na lista'), 'limpar lista');
    ok(!erros.length, 'sem erro de JavaScript ' + erros.join(' | '));

    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel);
    await m.pg.click('#abaEtiquetas');
    await m.pg.fill('#etq', 'vest'); await m.pg.click('#etqres [data-ep]');
    ok(await m.pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'celular: sem rolagem lateral');
    await print(m.pg, 'etq_celular');
  } catch (e) { falhas++; console.log('FALHOU  ' + e.stack); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
