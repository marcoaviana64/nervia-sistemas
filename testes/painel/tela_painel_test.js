// Teste de tela do Painel de Notas 1.2 (visões Compras, Vendas e Compras × Vendas) e dos avisos por e-mail do
// Buscador 1.9, nas páginas da demonstração (dados fictícios no navegador, sem rede).
// Uso: CHARTJS=<caminho do chart.umd.js 4.4.1> node testes/painel/tela_painel_test.js [pasta_prints]
// Sem CHARTJS, o cdnjs é bloqueado e o painel mostra "Gráfico indisponível" (o resto é conferido igual).
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const PRINTS = process.argv[2];
const CHART = process.env.CHARTJS;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, res) => {
  let f = path.join(RAIZ, 'site', decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
const falhas = [];
const ok = (c, nome) => { console.log((c ? 'ok  ' : 'FALHOU ') + nome); if (!c) falhas.push(nome); };
const reais = (t) => Number(String(t).replace(/[^\d,-]/g, '').replace(',', '.'));

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch();
  const pg = await nav.newPage({ viewport: { width: 1360, height: 900 } });
  const erros = []; pg.on('pageerror', (e) => erros.push(e.message));
  // a última rota registrada vale primeiro: o bloqueio geral vem antes, o Chart.js local depois
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await pg.route(/cdnjs\.cloudflare\.com/, (r) => CHART ? r.fulfill({ body: fs.readFileSync(CHART), contentType: 'text/javascript' }) : r.abort());

  // ------------------------------------------------------------ Painel
  await pg.goto(base + '/demo/apps/painel-nf/');
  await pg.waitForSelector('#painel:not(.oculto)');
  ok(await pg.isVisible('#fPapel'), 'painel: seletor de visão aparece');
  ok((await pg.$$eval('#fPapel button', (b) => b.map((x) => x.textContent))).join('|') === 'Compras|Vendas|Compras × Vendas', 'painel: três visões');
  ok((await pg.textContent('#titulo')) === 'Compras por fornecedor', 'painel: abre em Compras');
  const totalCompras = reais(await pg.textContent('#kpis .kpi:first-child .kpi-val'));
  ok(totalCompras > 0, 'painel: total comprado');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'painel-compras.png'), fullPage: true });

  await pg.click('#fPapel button[data-v="emitida"]');
  ok((await pg.textContent('#titulo')) === 'Vendas por cliente', 'vendas: título');
  ok((await pg.textContent('#aviso')).includes('NFS-e (serviços) emitidas'), 'vendas: aviso de que só NFS-e emitidas aparecem');
  ok((await pg.textContent('#hForn')) === 'Cliente', 'vendas: tabela por cliente');
  const totalVendas = reais(await pg.textContent('#kpis .kpi:first-child .kpi-val'));
  ok(totalVendas > 0, 'vendas: total vendido');
  ok((await pg.textContent('#kpis')).includes('0 NF-e'), 'vendas: nenhuma NF-e emitida');
  ok(await pg.isVisible('#vPapel') && !(await pg.isVisible('#vRes')), 'vendas: cartões de fornecedor/cliente à vista');
  await pg.selectOption('#fTipo', 'NFE');
  ok((await pg.textContent('#aviso')).includes('Com o filtro NF-e, a visão fica vazia'), 'vendas: filtro NF-e explica a visão vazia');
  await pg.selectOption('#fTipo', '');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'painel-vendas.png'), fullPage: true });

  await pg.click('#fPapel button[data-v="resultado"]');
  ok((await pg.textContent('#titulo')) === 'Compras × Vendas', 'resultado: título');
  ok(await pg.isVisible('#vRes') && !(await pg.isVisible('#vPapel')), 'resultado: mostra a comparação e esconde as tabelas por fornecedor');
  ok(await pg.isDisabled('#fForn'), 'resultado: campo de fornecedor desligado');
  const kv = await pg.$$eval('#kpis .kpi-val', (k) => k.map((x) => x.textContent));
  ok(Math.abs(reais(kv[0]) - totalVendas) < 0.01 && Math.abs(reais(kv[1]) - totalCompras) < 0.01, 'resultado: totais iguais aos das visões Vendas e Compras');
  ok(Math.abs(reais(kv[2]) - (totalVendas - totalCompras)) < 0.02, 'resultado: diferença = vendas − compras');
  const linhas = await pg.$$eval('#tbRes tr', (t) => t.map((r) => [...r.cells].map((c) => c.textContent)));
  ok(linhas.length >= 12 && linhas.at(-1)[0] === 'Total', 'resultado: tabela mês a mês com total');
  const somaMeses = linhas.slice(0, -1).reduce((s, l) => s + reais(l[1]), 0);
  ok(Math.abs(somaMeses - totalVendas) < 0.05, 'resultado: soma dos meses = total vendido');
  if (CHART) ok(await pg.evaluate(() => !!Chart.getChart(document.getElementById('gRes'))), 'resultado: gráfico de compras e vendas desenhado');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'painel-resultado.png'), fullPage: true });
  const mes = linhas[1][0];
  await pg.click('#tbRes tr:nth-child(2)');
  ok((await pg.textContent('#chips')).includes(mes.split('/')[0]), 'resultado: clicar no mês filtra o mês');
  ok((await pg.$$('#tbRes tr')).length === 2, 'resultado: com o mês filtrado, uma linha + total');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('text=Exportar CSV')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename() === 'painel-notas-compras-x-vendas.csv' && csv.includes('Diferença (vendas − compras)'), 'resultado: CSV mês a mês');
  await pg.click('#fPapel button[data-v="recebida"]');
  ok(!(await pg.isDisabled('#fForn')) && (await pg.textContent('#titulo')) === 'Compras por fornecedor', 'volta para Compras');

  await pg.setViewportSize({ width: 390, height: 840 });
  await pg.click('#fPapel button[data-v="resultado"]');
  await pg.waitForTimeout(400);   // o Chart.js redimensiona o gráfico depois do resize
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral na comparação');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'painel-celular.png'), fullPage: true });
  await pg.setViewportSize({ width: 1360, height: 900 });

  // ------------------------------------------------------------ Buscador: avisos por e-mail
  await pg.goto(base + '/demo/apps/notas/');
  await pg.waitForSelector('#avisosBox');
  ok(!(await pg.isChecked('#avResumo')) && await pg.isChecked('#avCert'), 'avisos: padrão = resumo desligado, certificado ligado');
  ok((await pg.textContent('#avPara')).includes('demo@exemplo.com.br'), 'avisos: diz para qual e-mail vai');
  ok(!(await pg.isVisible('#avisosBox button')), 'avisos: cliente não vê "Quem recebe avisos"');
  await pg.check('#avResumo');
  await pg.waitForFunction(() => document.getElementById('msgAv').textContent === 'Avisos atualizados.');
  ok(true, 'avisos: ligar o resumo grava');
  if (PRINTS) await pg.locator('#avisosBox').screenshot({ path: path.join(PRINTS, 'buscador-avisos.png') });

  ok(!erros.length, 'sem erro de JavaScript' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await nav.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTODOS OK');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
