// Teste de tela da aba Giro do estoque do Sistema Linum (versão 2.52) com o Playwright do Node e um Supabase IMITADO no
// navegador (lin_estoque_ler, lin_produtos, lin_variantes, lin_movimentos, lin_lucro_itens). Dados FICTÍCIOS.
// Confere: só a Dona vê a aba; contagem inicial conta desde 27/10 com "≥"; peça nova conta da data real; malinha e
// transferência não zeram o tempo; estoque médio (conferido por um cálculo dia a dia independente), giro, retorno;
// agrupar por loja/cor; detalhe da peça; CSV; celular.
// Uso: node testes/linum/tela_giro_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8834;

const H = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dia = (d, k) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const entre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const INICIO = '2026-10-27';
const INI = dia(H, -89) < INICIO ? INICIO : dia(H, -89);
const N = entre(INI, H) + 1;

const DADOS = {
  papel: 'dono', minha_loja: null, comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [
    { id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', categoria: 'Vestido', preco_venda: 300,
      variantes: [{ id: 'v1', cor: 'Azul', tamanho: 'P', edicao: '' }, { id: 'v2', cor: 'Azul', tamanho: 'M', edicao: '' }] },
    { id: 'p2', referencia: 'CAL-ARE', descricao: 'Calça Areia', categoria: 'Calça', preco_venda: 500,
      variantes: [{ id: 'v5', cor: 'Cru', tamanho: '38', edicao: '' }] }],
  estoque: [['v1', 'l-ipa', 3], ['v2', 'l-ipa', 1], ['v2', 'l-gav', 2], ['v5', 'l-gav', 1]],
};
const PRODS = [{ id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', categoria: 'Vestido', tecido: 'Linho', preco_venda: 300, preco_custo: 100 },
  { id: 'p2', referencia: 'CAL-ARE', descricao: 'Calça Areia', categoria: 'Calça', tecido: 'Linho', preco_venda: 500, preco_custo: 200 }];
const VARS = [{ id: 'v1', produto_id: 'p1', cor: 'Azul', tamanho: 'P', edicao: '', ativo: true }, { id: 'v2', produto_id: 'p1', cor: 'Azul', tamanho: 'M', edicao: '', ativo: true },
  { id: 'v5', produto_id: 'p2', cor: 'Cru', tamanho: '38', edicao: '', ativo: true }];
const m = (id, v, tipo, q, loja, data, obs, extra = {}) => ({ id, variante_id: v, tipo, quantidade: q, antes: null, depois: null, loja_id: loja, loja_destino_id: null,
  data, observacao: obs, transferencia_id: null, beneficiamento_id: null, brinde_id: null, condicional_id: null, criado_em: data + 'T15:00:00Z', ...extra });
const MOVS = [
  m(1, 'v1', 'entrada', 4, 'l-ipa', '2026-10-28', 'Primeira contagem de estoque.'),
  m(2, 'v2', 'entrada', 3, 'l-ipa', '2026-10-30', 'Adicionando quantidades que estão na loja.'),
  m(3, 'v5', 'entrada', 2, 'l-gav', dia(H, -5), 'Peça nova'),
  m(4, 'v2', 'transf_envio', 2, 'l-ipa', dia(H, -3), 'Transferência nº 9', { transferencia_id: 9 }),
  m(5, 'v2', 'transf_recebida', 2, 'l-gav', dia(H, -2), 'Transferência nº 9', { transferencia_id: 9 }),
  m(6, 'v5', 'cond_saida', 1, 'l-gav', dia(H, -2), 'Malinha nº 7', { condicional_id: 7 }),
  m(7, 'v5', 'cond_volta', 1, 'l-gav', dia(H, -1), 'Malinha nº 7', { condicional_id: 7 }),
  m(8, 'v5', 'venda', 1, 'l-gav', dia(H, -1), 'Venda nº 2'),
  m(9, 'v1', 'venda', 1, 'l-ipa', H, 'Venda nº 3'),
];
const ITENS = [
  { venda_id: 2, data: dia(H, -1), loja_id: 'l-gav', vendedora_id: 'u1', vendedora_nome: 'Ana', produto_id: 'p2', variante_id: 'v5', referencia: 'CAL-ARE', descricao: 'Calça Areia', cor: 'Cru', tamanho: '38', edicao: '', quantidade: 1, tabela: 500, vendido: 450, custo_unitario: 200, custo: 200 },
  { venda_id: 3, data: H, loja_id: 'l-ipa', vendedora_id: 'u1', vendedora_nome: 'Ana', produto_id: 'p1', variante_id: 'v1', referencia: 'VES-MAR', descricao: 'Vestido Mar', cor: 'Azul', tamanho: 'P', edicao: '', quantidade: 1, tabela: 300, vendido: 280, custo_unitario: 100, custo: 100 },
];
// estoque médio por um caminho independente: estoque de cada dia = estoque de hoje − efeitos das movimentações depois dele
const efeito = x => ['venda', 'transf_envio', 'cond_saida'].includes(x.tipo) ? -x.quantidade : x.quantidade;
function medio(v, l, hoje) {
  let s = 0;
  for (let k = 0; k < N; k++) { const D = dia(INI, k); s += hoje - MOVS.filter(x => x.variante_id === v && x.loja_id === l && x.data > D).reduce((t, x) => t + efeito(x), 0); }
  return s / N;
}

const FALSO = `(() => {
  const D = ${JSON.stringify(DADOS)}, P = ${JSON.stringify(PRODS)}, V = ${JSON.stringify(VARS)}, MV = ${JSON.stringify(MOVS)}, IT = ${JSON.stringify(ITENS)};
  window.__rpc = [];
  const ok = data => Promise.resolve({ data, error: null });
  const consulta = tab => { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, gte: () => q, lte: () => q, in: () => q,
    range: (a, b) => ok((tab === 'lin_movimentos' ? MV : tab === 'lin_produtos' ? P : tab === 'lin_variantes' ? V : []).slice(a, b + 1)),
    maybeSingle: () => ok({ admin: false }), then: (r, j) => ok([]).then(r, j) }; return q; };
  const rpc = (fn, a) => { window.__rpc.push([fn, a]);
    const r = fn === 'lin_estoque_ler' ? JSON.parse(JSON.stringify(D))
      : fn === 'lin_lucro_itens' ? IT.filter(i => i.data >= a.p_de && i.data <= a.p_ate)
      : fn === 'lin_meu_horario' ? { liberado: true }
      : fn === 'lin_minhas_permissoes' ? { producao: false, producao_valores: false } : null;
    const res = { data: r, error: null };
    const p = Promise.resolve(res); p.range = (x, y) => ok(Array.isArray(r) ? r.slice(x, y + 1) : r); return p; };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-dono' } } } }) },
    from: tab => consulta(tab), rpc }) };
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
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('"papel":"dono"', `"papel":"${papel}"`), contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const abrir = async pg => { await pg.click('#grp_gestao'); await pg.click('#abaGiro'); await pg.waitForSelector('#gitab'); };
const linha = (pg, txt) => pg.locator('#gitab tbody tr', { hasText: txt }).innerText();
const celulas = async (pg, txt) => (await pg.locator('#gitab tbody tr', { hasText: txt }).locator('td').allInnerTexts()).map(s => s.trim());
const br = (x, k) => x.toFixed(k).replace('.', ',');

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    for (const papel of ['vendedora', 'estoque']) {
      const v = await pagina(ctx, papel);
      ok(await v.pg.locator('#abaGiro').evaluate(e => e.classList.contains('oculto')), `${papel} não vê a aba Giro do estoque`);
      await v.pg.close();
    }
    const { pg, erros } = await pagina(ctx, 'dono');
    await abrir(pg);
    ok(true, 'a Dona abre a aba Giro do estoque (grupo Gestão)');
    const lucro = (await pg.evaluate(() => window.__rpc.filter(r => r[0] === 'lin_lucro_itens').pop()[1]));
    ok(lucro.p_de === INI && lucro.p_ate === H, `período começa em ${INI} (nunca antes de 27/10) e vai até hoje`);
    const k = await pg.locator('.kpis .kpi b').allInnerTexts();
    ok(k[0] === '7 peças' && k[1] === '2 peças', 'estoque hoje 7 peças; vendidas 2');
    ok((await pg.locator('#tela').innerText()).includes('contagem inicial'), 'aviso da contagem inicial e de poucos dados');
    // Calça: peça nova (tempo real), passou pela malinha sem zerar: entrou H−5, vendeu H−1 → 4 dias
    let c = await celulas(pg, 'Calça Areia');
    ok(c[7] === '4 dias', 'Calça (peça nova): tempo até vender = 4 dias, sem "≥" (malinha não zera o tempo) — ' + c[7]);
    ok(c[6] === '5 dias', 'Calça: a peça que ficou está há 5 dias no estoque — ' + c[6]);
    const mC = medio('v5', 'l-gav', 1);
    ok(c[4] === br(1 / mC, 2), `Calça: giro = 1 ÷ estoque médio (${mC.toFixed(3)}) = ${br(1 / mC, 2)} — ${c[4]}`);
    ok(c[10] === (250 / (mC * 200)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 'Calça: retorno = lucro 250 ÷ custo do estoque médio — ' + c[10]);
    // Vestido: contagem inicial → "≥"
    c = await celulas(pg, 'Vestido Mar');
    ok(c[2] === '6' && c[3] === '1', 'Vestido: 6 em estoque (3 + 1 + 2), 1 vendida');
    ok(c[7] === `≥ ${entre(INICIO, H)} dias` || c[7] === `≥ ${entre(INICIO, H)} dia`, 'Vestido: tempo até vender com "≥" desde 27/10 — ' + c[7]);
    const mV = medio('v1', 'l-ipa', 3) + medio('v2', 'l-ipa', 1) + medio('v2', 'l-gav', 2);
    ok(c[4] === br(1 / mV, 2), `Vestido: giro = 1 ÷ estoque médio somado das cores/lojas (${mV.toFixed(3)}) — ${c[4]}`);
    await print(pg, 'giro_peca');
    // detalhe: Azul M na Gávea veio por transferência e continua com o tempo da contagem inicial
    await pg.locator('#gitab tbody tr', { hasText: 'Vestido Mar' }).click();
    await pg.waitForSelector('#gidet');
    const det = await pg.locator('#gidet tbody tr', { hasText: 'Gávea' }).locator('td').allInnerTexts();
    ok(det[0].includes('Azul M') && det[6].trim() === `≥ ${entre(INICIO, H)}`, 'transferência não zera o tempo: Azul M na Gávea ≥ ' + entre(INICIO, H) + ' dias — ' + det.join('|'));
    ok(det[2].includes('Sem venda'), 'Azul M na Gávea: situação Sem venda');
    await print(pg, 'giro_detalhe');
    await pg.click('#gidx');
    // por loja
    await pg.selectOption('#gipor', 'loja'); await pg.waitForFunction(() => document.querySelector('#gitab th').textContent === 'Loja');
    c = await celulas(pg, 'Gávea');
    ok(c[2] === '3' && c[3] === '1', 'por loja: Gávea 3 em estoque, 1 vendida');
    // por cor + filtro de loja
    await pg.selectOption('#gipor', 'cor'); await pg.waitForFunction(() => document.querySelector('#gitab th').textContent === 'Cor');
    ok((await linha(pg, 'Azul')).includes('Azul') && (await linha(pg, 'Cru')).includes('Cru'), 'por cor: Azul e Cru');
    await pg.selectOption('#giloja', 'l-ipa'); await pg.waitForFunction(() => !document.querySelector('#gitab').innerText.includes('Cru'));
    ok((await pg.locator('.kpis .kpi b').first().innerText()) === '4 peças', 'só Ipanema: 4 peças em estoque');
    await pg.selectOption('#giloja', '');
    // ordenar por dinheiro parado: o que não vendeu vem primeiro
    await pg.selectOption('#gipor', 'peca'); await pg.waitForSelector('#gitab .girow');
    // CSV
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#gicsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.includes('"Retorno por R$ 1"') && csv.includes('"CAL-ARE Calça Areia"') && csv.split('\r\n').length === 3, 'CSV com as peças e o retorno');
    ok(erros.length === 0, 'sem erro de JavaScript ' + erros.join(' | '));
    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const cc = await pagina(cel, 'dono');
    await abrir(cc.pg);
    ok(await cc.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral');
    await print(cc.pg, 'giro_celular');
    ok(cc.erros.length === 0, 'celular sem erro de JavaScript ' + cc.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
