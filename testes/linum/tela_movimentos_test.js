// Teste de tela da aba Movimentações do Sistema Linum (versão 2.29) com o Playwright do Node e um Supabase IMITADO no
// navegador (lin_estoque_ler, lin_catalogo, lin_movimentos). Dados FICTÍCIOS.
// Confere: só Dono e Estoque veem a aba; filtro de período no servidor; resumo "Por descrição" junta um levantamento;
// clicar na descrição filtra; efeito por loja (transferência sai de uma e entra na outra); busca sem acento; CSV; celular.
// Uso: node testes/linum/tela_movimentos_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8833;

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const LEV = 'O levantamento do estoque Gávea feito pela Silvana';
const DADOS = {
  papel: 'estoque', minha_loja: 'l-gav', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [
    { id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', categoria: 'Vestido', preco_venda: 489,
      variantes: [{ id: 'v1', cor: 'Azul', tamanho: 'P', edicao: '' }, { id: 'v2', cor: 'Azul', tamanho: 'M', edicao: '' }] },
    { id: 'p2', referencia: 'CAL-ARE', descricao: 'Calça Areia', categoria: 'Calça', preco_venda: 1359,
      variantes: [{ id: 'v5', cor: 'Cru', tamanho: '38', edicao: '' }] }],
  estoque: [['v1', 'l-gav', 3], ['v2', 'l-gav', 6], ['v5', 'l-gav', 4], ['v2', 'l-ipa', 5]],
};
// v9 = variação desativada (não vem no lin_estoque_ler, só no catálogo)
const CATALOGO = {
  produtos: [{ id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar' }, { id: 'p2', referencia: 'CAL-ARE', descricao: 'Calça Areia' }],
  variantes: [{ id: 'v1', produto_id: 'p1', cor: 'Azul', tamanho: 'P', edicao: '' }, { id: 'v2', produto_id: 'p1', cor: 'Azul', tamanho: 'M', edicao: '' },
              { id: 'v5', produto_id: 'p2', cor: 'Cru', tamanho: '38', edicao: '' }, { id: 'v9', produto_id: 'p2', cor: 'Cru', tamanho: '42', edicao: '', ativo: false }],
};
const m = (id, v, tipo, q, loja, data, obs, extra = {}) => ({ id, variante_id: v, tipo, quantidade: q, antes: null, depois: null, loja_id: loja, loja_destino_id: null,
  data, observacao: obs, criado_nome: 'Beatriz', criado_em: data + 'T15:00:00Z', ...extra });
const MOVS = [
  m(1, 'v1', 'ajuste', 3, 'l-gav', hoje, LEV, { antes: 0, depois: 3, criado_nome: 'Correção no banco (Nervia)' }),
  m(2, 'v2', 'ajuste', 2, 'l-gav', hoje, LEV, { antes: 8, depois: 6, criado_nome: 'Correção no banco (Nervia)' }),
  m(3, 'v5', 'ajuste', 4, 'l-gav', hoje, LEV, { antes: 0, depois: 4, criado_nome: 'Correção no banco (Nervia)' }),
  m(4, 'v2', 'transferencia', 2, 'l-ipa', hoje, 'para a vitrine', { loja_destino_id: 'l-gav' }),
  m(5, 'v2', 'venda', 1, 'l-ipa', hoje, 'Venda nº 12'),
  m(6, 'v9', 'entrada', 5, 'l-ipa', hoje, ''),
  m(7, 'v1', 'entrada', 9, 'l-ipa', '2020-01-10', 'antiga'),
];
const FALSO = `(() => {
  const D = ${JSON.stringify(DADOS)}, C = ${JSON.stringify(CATALOGO)}, MV = ${JSON.stringify(MOVS)};
  window.__consultas = [];
  const ok = data => Promise.resolve({ data, error: null });
  const consulta = tab => { const f = []; const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
    gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; },
    range: (a, b) => { window.__consultas.push(tab); return ok(tab === 'lin_movimentos' ? MV.filter(x => f.every(g => g(x))).slice(a, b + 1) : []); },
    maybeSingle: () => ok({ admin: false }), then: (r, j) => ok([]).then(r, j) }; return q; };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-est' } } } }) },
    from: tab => consulta(tab),
    rpc: async fn => fn === 'lin_estoque_ler' ? { data: JSON.parse(JSON.stringify(D)), error: null }
      : fn === 'lin_catalogo' ? { data: C, error: null }
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
    res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  }).listen(PORTA);
}

let falhas = 0, oks = 0;
function ok(cond, nome) { if (cond) { oks++; console.log('ok  ' + nome); } else { falhas++; console.log('FALHOU  ' + nome); } }

async function pagina(ctx, papel) {
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push(String(e)));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('"papel":"estoque"', `"papel":"${papel}"`), contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const kpis = pg => pg.locator('.kpis .kpi b').allInnerTexts();
const nlinhas = pg => pg.locator('#mvlista tbody tr').count();

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    // vendedora não vê
    const v = await pagina(ctx, 'vendedora');
    ok(!(await v.pg.locator('#abaMovimentos').isVisible()), 'vendedora não vê a aba Movimentações');
    await v.pg.close();

    const { pg, erros } = await pagina(ctx, 'estoque');
    ok(await pg.locator('#abaMovimentos').isVisible(), 'Estoque vê a aba Movimentações');
    await pg.click('#abaMovimentos');
    await pg.waitForSelector('#mvlista');
    ok(await nlinhas(pg) === 6, 'últimos 7 dias: 6 movimentações (a antiga fica de fora, filtrada no servidor)');
    ok(await pg.evaluate(() => window.__consultas.includes('lin_movimentos')), 'lê lin_movimentos');
    const txt = await pg.locator('#mvlista').innerText();
    ok(txt.includes('CAL-ARE') && txt.includes('Cru 42'), 'variação desativada aparece com o nome (pelo catálogo)');
    ok(!/custo/i.test(await pg.locator('#tela').innerText()), 'nada de custo na tela');
    let k = await kpis(pg);
    ok(k.join('|') === '6|+12|-3|+9', 'todas as lojas: entraram 12 (3 + 4 + 5), saíram 3 (ajuste −2 e venda), transferência não conta');
    // por descrição
    const gr = await pg.locator('#mvgrupos tbody tr').first().innerText();
    ok(gr.includes(LEV) && gr.includes('3') && gr.includes('+5'), 'o levantamento aparece numa linha: 3 movimentações, resultado +5');
    await print(pg, 'mov_todas');
    await pg.locator('#mvgrupos tbody tr', { hasText: LEV }).click();
    await pg.waitForSelector('#mvtodas');
    ok(await nlinhas(pg) === 3 && (await pg.locator('#mvlista').innerText()).includes('8 → 6'), 'clicar na descrição mostra só as 3 do levantamento, com antes → depois');
    k = await kpis(pg);
    ok(k.join('|') === '3|+7|-2|+5', 'KPIs do levantamento: +7 −2 = +5');
    await print(pg, 'mov_levantamento');
    // CSV
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#mvcsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.split('\r\n').length === 4 && csv.includes('"Efeito no estoque"') && csv.includes('"-2"') && /movimentacoes-linum-.*\.csv/.test(dl.suggestedFilename()),
      'CSV com as linhas filtradas e o efeito no estoque');
    await pg.click('#mvtodas');
    await pg.waitForSelector('#mvlista');
    ok(await nlinhas(pg) === 6, '"Ver todas" volta a mostrar tudo');
    // loja: transferência entra na Gávea
    await pg.selectOption('#mvloja', 'l-gav');
    await pg.waitForFunction(() => document.querySelectorAll('#mvlista tbody tr').length === 4);
    k = await kpis(pg);
    ok(k.join('|') === '4|+9|-2|+7', 'Gávea: levantamento (+7 −2) + transferência recebida (+2)');
    await pg.selectOption('#mvloja', 'l-ipa');
    await pg.waitForFunction(() => document.querySelectorAll('#mvlista tbody tr').length === 3);
    k = await kpis(pg);
    ok(k.join('|') === '3|+5|-3|+2', 'Ipanema: entrada 5, transferência enviada −2, venda −1');
    await pg.selectOption('#mvloja', '');
    // tipo
    await pg.selectOption('#mvtipo', 'venda');
    await pg.waitForFunction(() => document.querySelectorAll('#mvlista tbody tr').length === 1);
    ok((await pg.locator('#mvlista').innerText()).includes('Venda nº 12'), 'filtro por tipo: venda');
    await pg.selectOption('#mvtipo', '');
    // busca sem acento
    await pg.fill('#mvq', 'calca');
    await pg.waitForFunction(() => document.querySelectorAll('#mvlista tbody tr').length === 2);
    ok(true, 'busca "calca" acha as 2 da Calça Areia (sem acento)');
    ok(await pg.inputValue('#mvq') === 'calca', 'a busca continua no campo depois de redesenhar');
    await pg.fill('#mvq', '');
    // período antigo
    await pg.fill('#mvde', '2020-01-01'); await pg.dispatchEvent('#mvde', 'change');
    await pg.waitForFunction(() => document.querySelectorAll('#mvlista tbody tr').length === 7);
    ok(true, 'período maior traz a movimentação antiga');
    // Dono também vê
    const d = await pagina(ctx, 'dono');
    ok(await d.pg.locator('#abaMovimentos').isVisible(), 'Dono vê a aba Movimentações');
    await d.pg.close();
    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await pagina(cel, 'estoque');
    await c.pg.click('#abaMovimentos'); await c.pg.waitForSelector('#mvlista');
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral');
    await print(c.pg, 'mov_celular');
    ok(erros.length === 0 && c.erros.length === 0, 'sem erro de JavaScript ' + erros.concat(c.erros).join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
