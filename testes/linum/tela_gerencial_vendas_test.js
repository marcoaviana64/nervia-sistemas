// Teste de tela do Gerencial — Vendas Rede e Análise de vendas (Sistema Linum 2.37), Playwright do Node, Supabase IMITADO.
// Dados FICTÍCIOS. Confere: KPIs (bruto, taxas, líquido, ticket), tabelas por loja/bandeira/parcelas/horário, mês a mês,
// Análise (outras vendas só nos totais, melhor dia, datas comemorativas, top 15), CSV da Rede (";" e vírgula decimal, hora
// 12 h → +12, cancelada fora, NSU repetido pulado, terminal → loja), Pix do mês, outras vendas, terminais, celular.
// Uso: node testes/linum/tela_gerencial_vendas_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8835;
const DADOS = { papel: 'dono', minha_loja: null, comissao_pct: 0, lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }], produtos: [], estoque: [] };
let ID = 0;
const V = (data, hora, term, loja, modal, tipo, parc, band, bruto, txp, nsu) => ({ id: ++ID, data, hora, terminal: term, loja, modalidade: modal, tipo, parcelas: parc, bandeira: band,
  bruto, mdr_pct: txp, mdr_val: +(bruto * txp / 100).toFixed(2), ant_pct: 0, ant_val: 0, tx_pct: txp, tx_val: +(bruto * txp / 100).toFixed(2), liquido: +(bruto * (1 - txp / 100)).toFixed(2),
  prazo: '', nsu, chave: [data, hora, term, bruto.toFixed(2)].join('|') + '|1', importacao_id: 1, criado_em: '2026-11-06T03:00:00Z', criado_nome: 'Carga (Nervia)' });
const REDE = [
  V('2026-05-10', '15:00:00', 'T1', 'Ipanema', 'crédito', 'parcelado sem juros', 3, 'Visa', 1000, 4, '1'),
  V('2026-05-10', '16:30:00', 'T2', 'Gávea', 'débito', 'à vista', 1, 'Mastercard', 500, 1, '2'),
  V('2026-10-01', '11:20:00', 'T1', 'Ipanema', 'crédito', 'à vista', 1, 'Visa', 300, 3, '3'),
  V('2026-10-02', '18:05:00', 'T2', 'Gávea', 'crédito', 'parcelado sem juros', 6, 'Elo', 1200, 6, '4'),
  V('2026-09-30', null, 'PIX-QR', 'Não identificada', 'Pix', 'à vista', 1, 'Pix', 400, 0, null),
];
const OUTRAS = [{ id: 1, data: '2026-10-31', loja: 'Ipanema', valor: 1000, descricao: 'Venda no caderno', criado_em: '2026-11-06T03:00:00Z', criado_nome: 'Carga' }];
const TERM = [{ terminal: 'T1', loja: 'Ipanema', observacao: '' }, { terminal: 'T2', loja: 'Gávea', observacao: '' }];

const FALSO = `(() => {
  const D = ${JSON.stringify(DADOS)};
  const db = window.__db = { lin_ger_rede: ${JSON.stringify(REDE)}, lin_ger_outras_vendas: ${JSON.stringify(OUTRAS)}, lin_ger_terminais: ${JSON.stringify(TERM)},
    lin_ger_importacoes: [], lin_ger_lancamentos: [], lin_ger_regras: [], lin_ger_consideracoes: [] };
  window.__rpc = [];
  const ok = data => Promise.resolve({ data, error: null });
  const consulta = tab => { const q = { select: () => q, eq: () => q, neq: () => q, in: () => q, or: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q,
    range: (a, b) => ok(JSON.parse(JSON.stringify((db[tab] || []).slice(a, b + 1)))),
    maybeSingle: () => ok({ admin: false }), then: (r, j) => ok(JSON.parse(JSON.stringify(db[tab] || []))).then(r, j) }; return q; };
  let seq = 100;
  const fn = {
    lin_estoque_ler: () => JSON.parse(JSON.stringify(D)),
    lin_meu_horario: () => ({ liberado: true }),
    lin_minhas_permissoes: () => ({ producao: false, producao_valores: false }),
    lin_ger_rede_importar: a => { const p = a.p; let novas = 0, rep = 0, sem = 0;
      p.vendas.forEach(v => { if (db.lin_ger_rede.some(x => x.chave === v.chave || (v.nsu && x.nsu === v.nsu))) { rep++; return; }
        const loja = v.loja || (db.lin_ger_terminais.find(t => t.terminal === v.terminal) || {}).loja || 'Não identificada'; if (loja === 'Não identificada') sem++;
        db.lin_ger_rede.push({ id: ++seq, mdr_pct: 0, mdr_val: 0, ant_pct: 0, ant_val: 0, tx_pct: 0, tx_val: 0, prazo: '', tipo: '', bandeira: '', parcelas: 1, ...v, loja, liquido: v.liquido ?? v.bruto }); novas++; });
      db.lin_ger_importacoes.unshift({ id: ++seq, conta: 'rede', arquivo: p.arquivo, novos: novas, repetidos: rep, criado_em: new Date().toISOString(), criado_nome: 'Gorette' });
      return { novas, repetidas: rep, sem_loja: sem }; },
    lin_ger_rede_excluir: a => { if ((a.p_motivo || '').length < 5) throw new Error('Escreva o motivo da exclusão (ao menos 5 letras)'); db.lin_ger_rede = db.lin_ger_rede.filter(r => r.id !== a.p_id); },
    lin_ger_outra_venda_salvar: a => { db.lin_ger_outras_vendas.push({ id: ++seq, ...a.p, valor: Number(a.p.valor) }); return seq; },
    lin_ger_outra_venda_excluir: a => { db.lin_ger_outras_vendas = db.lin_ger_outras_vendas.filter(o => o.id !== a.p_id); },
    lin_ger_terminal_salvar: a => { if (!a.p_terminal) throw new Error('Informe o código do terminal'); db.lin_ger_terminais = db.lin_ger_terminais.filter(t => t.terminal !== a.p_terminal).concat([{ terminal: a.p_terminal, loja: a.p_loja, observacao: a.p_observacao }]); },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-dono' } } } }) },
    from: tab => consulta(tab),
    rpc: async (nome, args) => { window.__rpc.push([nome, JSON.parse(JSON.stringify(args || {}))]);
      try { return { data: fn[nome] ? fn[nome](args || {}) : null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } } }) };
})();`;
const CHART = 'window.__graficos = 0; window.Chart = class { constructor(el, cfg) { window.__graficos++; this.cfg = cfg; } destroy() {} };';
// CSV fictício no formato do portal: ";" e vírgula decimal; hora 12 h sem AM/PM; uma cancelada; NSU 3 já importado; terminal novo T9
const CSV = ['Relatório de vendas', 'data da venda;hora da venda;status da venda;valor da venda original;modalidade;tipo;número de parcelas;bandeira;taxa MDR;valor MDR;taxa de antecipação;valor da antecipação;valor líquido;NSU/CV;número do terminal',
  '03/11/2026;03:15:00;aprovada;1.250,00;crédito;parcelado sem juros;5;Visa;2,60%;32,50;2,00%;25,00;1.192,50;000777;T1',
  '03/11/2026;10:40:00;aprovada;180,00;débito;à vista;1;Elo;1,10%;1,98;0,00%;0,00;178,02;000778;T9',
  '04/11/2026;05:00:00;cancelada;99,00;crédito;à vista;1;Visa;3,00%;2,97;0,00%;0,00;96,03;000779;T2',
  '01/10/2026;11:20:00;aprovada;300,00;crédito;à vista;1;Visa;3,00%;9,00;0,00%;0,00;291,00;000003;T1'].join('\r\n');

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
  pg.on('dialog', d => d.accept(pg.__resposta || ''));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('"papel":"dono"', `"papel":"${papel}"`), contentType: 'text/javascript' }));
  await pg.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: CHART, contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const kpis = pg => pg.locator('.kpis .kpi b').allInnerTexts();
const TIT = { ger_rede: 'Vendas Rede', ger_analise: 'Análise de vendas', ger_geral: 'Visão geral', ger_cat: 'Categorias', ger_lanc: 'Lançamentos', ger_cons: 'Considerações', ger_imp: 'Importar extratos' };
const aba = async (pg, v) => { await pg.click('#grp_gerencial'); await pg.click(`.aba[data-v="${v}"]`); await pg.waitForSelector(`.cabtela h2:has-text("${TIT[v]}")`); };
const rpc = (pg, nome) => pg.evaluate(n => window.__rpc.filter(x => x[0] === n).map(x => x[1]), nome);
const brl = t => t.replace(/\s/g, ' ');

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const v = await pagina(ctx, 'vendedora');
    ok(!(await v.pg.locator('.aba[data-v="ger_rede"]').isVisible()), 'vendedora não vê Vendas Rede');
    await v.pg.close();
    const { pg, erros } = await pagina(ctx, 'dono');
    await aba(pg, 'ger_rede');
    ok(await pg.locator('#tela canvas').count() === 4, '4 gráficos em Vendas Rede');
    await pg.selectOption('#gvano', '');
    let k = (await kpis(pg)).map(brl);
    // bruto 1000+500+300+1200+400 = 3400; taxas 40+5+9+72 = 126; líquido 3274; ticket 680
    ok(k[0] === 'R$ 3.400,00' && k[1] === 'R$ 126,00' && k[2] === 'R$ 3.274,00' && k[3] === 'R$ 680,00', 'KPIs: bruto, taxas, líquido e ticket ' + k.join(' | '));
    const lojas = await pg.locator('.card:has(> h2:text-is("Por loja"))').innerText();
    ok(lojas.includes('Gávea') && lojas.includes('1.700,00') && lojas.includes('Não identificada'), 'tabela por loja');
    ok((await pg.locator('.card:has(> h2:text-is("Por número de parcelas"))').innerText()).includes('6x'), 'por parcelas');
    ok((await pg.locator('.card:has(> h2:text-is("Mês a mês por ano"))').innerText()).includes('1.500'), 'mês a mês por ano (maio: 1.500)');
    await pg.selectOption('#gvloja', 'Gávea');
    k = (await kpis(pg)).map(brl);
    ok(k[0] === 'R$ 1.700,00', 'filtro de loja');
    await pg.selectOption('#gvloja', '');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#gvcsv')]);
    ok(fs.readFileSync(await dl.path(), 'utf8').split('\r\n').length === 6, 'CSV do detalhamento');
    await print(pg, 'gv_rede');
    // importar CSV
    await pg.setInputFiles('#gvarq', { name: 'Rede_Rel_Vendas_11_2026.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await pg.waitForSelector('#gvok');
    const conf = await pg.locator('.card', { hasText: 'Confira' }).innerText();
    ok(conf.includes('1 cancelada(s)/negada(s) fora') && conf.includes('15:15') && conf.includes('10:40'), 'CSV: cancelada fora; hora 03 vira 15h, 10 fica');
    ok(conf.includes('sem loja') && conf.includes('já importada'), 'terminal sem cadastro e NSU já importado');
    await pg.click('#gvok');
    await pg.waitForFunction(() => !document.querySelector('#gvok'));
    const im = (await rpc(pg, 'lin_ger_rede_importar'))[0].p.vendas.sort((x, y) => y.bruto - x.bruto);
    ok(im.length === 2 && im[0].bruto === 1250 && im[0].tx_val === 57.5 && im[0].liquido === 1192.5 && im[0].nsu === '777' && im[0].hora === '15:15:00' && im[0].loja === 'Ipanema'
      && im[0].chave === '2026-11-03|15:15:00|T1|1250.00|1' && im[1].loja === null, 'vendas enviadas com taxas, NSU sem zeros, chave e loja pelo terminal ' + JSON.stringify(im[0]));
    ok((await pg.locator('.msg.ok').innerText()).includes('1 sem loja'), 'aviso de venda sem loja');
    // Pix do mês e outras vendas
    await pg.click('#gvpix');
    await pg.fill('#gvfm', '2026-10'); await pg.fill('#gvfv', '5.167,00'); await pg.click('#gvfok');
    await pg.waitForFunction(() => !document.querySelector('#dlg[open]'));
    const px = (await rpc(pg, 'lin_ger_rede_importar'))[1].p.vendas[0];
    ok(px.chave === 'pix|2026-10' && px.data === '2026-10-31' && px.bruto === 5167 && px.terminal === 'PIX-QR', 'Pix do mês no último dia do mês');
    await pg.click('#gvout');
    await pg.fill('#gvfm', '2026-02'); await pg.selectOption('#gvfl', 'Gávea'); await pg.fill('#gvfv', '2.000'); await pg.click('#gvfok');
    await pg.waitForFunction(() => !document.querySelector('#dlg[open]'));
    const ov = (await rpc(pg, 'lin_ger_outra_venda_salvar'))[0].p;
    ok(ov.data === '2026-02-28' && ov.loja === 'Gávea' && ov.valor === 2000, 'outra venda no último dia de fevereiro');
    // terminais
    await pg.click('#gvter');
    await pg.fill('#gvtt', 'T9'); await pg.selectOption('#gvtl', 'Gávea'); await pg.click('#gvtok');
    await pg.waitForSelector('#dlg[open] td:has-text("T9")');
    ok((await rpc(pg, 'lin_ger_terminal_salvar'))[0].p_loja === 'Gávea', 'cadastrar terminal');
    await pg.click('#gvtx');
    // Análise de vendas
    await aba(pg, 'ger_analise');
    await pg.selectOption('#gvano', '2026'); await pg.selectOption('#gvmes', '10');
    k = (await kpis(pg)).map(brl);
    // out/26: maquininha 300 + 1200 + Pix 5167 (31/10) = 6667; outras 1000 → 7667; 3 dias
    ok(k[0] === 'R$ 7.667,00' && k[1] === '3' && k[3] === '31/10/2026', 'Análise: total com outras vendas, dias com venda e melhor dia ' + k.join(' | '));
    await pg.selectOption('#gvmes', '05');
    const comem = await pg.locator('.card', { hasText: 'Datas comemorativas' }).innerText();
    ok(comem.includes('Dia das Mães') && comem.includes('10/05/2026'), 'Dia das Mães calculado (2º domingo de maio)');
    ok((await pg.locator('.card', { hasText: 'Top 15' }).innerText()).includes('Dia das Mães'), 'top 15 com a data comemorativa');
    ok(await pg.locator('#tela canvas').count() === 4, '4 gráficos na Análise');
    await print(pg, 'gv_analise');
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await pagina(cel, 'dono');
    await aba(c.pg, 'ger_rede');
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral (Vendas Rede)');
    await aba(c.pg, 'ger_analise');
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral (Análise)');
    await print(c.pg, 'gv_celular');
    ok(erros.length === 0 && c.erros.length === 0, 'sem erro de JavaScript ' + erros.concat(c.erros).join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
