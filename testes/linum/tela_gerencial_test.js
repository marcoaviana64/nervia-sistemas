// Teste de tela do Gerencial do Sistema Linum (versão 2.36) com o Playwright do Node e um Supabase IMITADO no navegador
// (lin_ger_* e as funções lin_ger_*). Dados FICTÍCIOS. Chart.js imitado (conta os gráficos desenhados).
// Confere: só Dono vê o grupo; Visão geral com as contas do painel antigo (neutras fora; conta da sócia); Categorias com
// classificações; Lançamentos (a classificar, classificar com regra, CSV, fora do banco); Importar OFX do Itaú (SALDO fora,
// já importado pela chave, "talvez" pela data e valor, regra, mesmo CPF, conferência do saldo) e CSV do Nubank;
// Considerações com o HTML limpo (sem script); celular.
// Uso: node testes/linum/tela_gerencial_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8834;

const DADOS = { papel: 'dono', minha_loja: null, comissao_pct: 0, lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }], produtos: [], estoque: [] };
let ID = 0;
const L = (conta, data, desc, v, classe, clas, extra = {}) => ({ id: ++ID, conta, data, descricao: desc, credito: v > 0 ? v : 0, debito: v < 0 ? -v : 0, classe, classificacao: clas,
  revisar: classe === 'A classificar', chave: `${conta}|${data}|${v.toFixed(2)}|${desc.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}|1`, fitid: null,
  importacao_id: 1, regra_id: null, observacao: '', criado_em: '2026-10-12T15:00:00Z', criado_nome: 'Carga (Nervia)', alterado_em: null, alterado_nome: '', ...extra });
const LANC = [
  L('itau', '2026-09-05', 'RECEBIMENTO REDE', 30000, 'Receitas', 'Receitas'),
  L('itau', '2026-09-06', 'BOLETO PAGO TECIDOS FICTICIOS LTDA', -8000, 'Insumos', 'Insumo'),
  L('itau', '2026-09-10', 'PIX ENVIADO IMOBILIARIA EXEMPLO', -5000, 'Aluguel', 'Aluguel Ipanema'),
  L('nubank', '2026-09-12', 'Transferência enviada pelo Pix - FULANA COSTURA - •••.111.222-••', -400, 'Insumos', 'Costureira'),
  L('itau', '2026-09-15', 'PIX ENVIADO SOCIA EXEMPLO', -3000, 'Retiradas', 'Retirada Sócia'),
  L('nubank', '2026-09-15', 'Transferência recebida pelo Pix - SOCIA EXEMPLO', 3000, 'Transferência Interna', 'Pix Sócia'),
  L('itau', '2026-09-20', 'DARF SIMPLES', -1200, 'Impostos', 'Tributos e Impostos'),
  L('itau', '2026-10-07', 'RECEBIMENTO REDE', 1500, 'Receitas', 'Receitas'),
  L('itau', '2026-10-08', 'BOLETO PAGO BOTOES EXEMPLO', -286.71, 'A classificar', ''),
  L('socia', '2026-08-17', 'Aporte não-bancário da sócia', 10610, 'Aportes', 'Aporte (mútuo)', { importacao_id: null, chave: 'manual|1' }),
];
const REGRAS = [{ id: 1, padrao: 'RECEBIMENTO REDE', conta: '', tipo: 'credito', classe: 'Receitas', classificacao: 'Receitas', prioridade: 10, ativo: true, observacao: '' }];
const IMPS = [{ id: 1, conta: 'itau', arquivo: 'dashboard_gerencial.html (painel antigo)', de: '2026-09-05', ate: '2026-10-08', novos: 8, repetidos: 0, saldo_final: 1000, saldo_data: '2026-10-06',
  criado_em: '2026-11-06T03:00:00Z', criado_nome: 'Carga (Nervia)' }];
const CONS = [
  { mes: '2026-09', titulo: 'Setembro / 2026', nota: 'B', nota_texto: 'Bom', metricas: [{ rot: 'Receita total', val: 'R$ 30.000', cor: 'pos' }, { rot: 'Despesas', val: 'R$ 14.600', cor: 'neg' }],
    corpo: '<div class="cons-section"><h4>Visão geral</h4><p>Mês <strong>bom</strong>.<script>window.__xss=1</script><img src=x onerror="window.__xss=2"></p><p onclick="window.__xss=3" style="color:red">Clique</p></div><div class="cons-alert">Atenção ao caixa.</div>',
    atualizado_em: '2026-10-07T23:30:00Z', atualizado_nome: 'Nervia (painel antigo)' },
  { mes: 'final', titulo: 'Avaliação executiva final', nota: '', nota_texto: '', metricas: [], corpo: '<p>Resumo do período.</p><a href="javascript:alert(1)">link</a>', atualizado_em: '2026-11-06T00:00:00Z', atualizado_nome: 'Nervia' },
];

const FALSO = `(() => {
  const D = ${JSON.stringify(DADOS)};
  const db = window.__db = { lin_ger_lancamentos: ${JSON.stringify(LANC)}, lin_ger_regras: ${JSON.stringify(REGRAS)}, lin_ger_importacoes: ${JSON.stringify(IMPS)}, lin_ger_consideracoes: ${JSON.stringify(CONS)} };
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
    lin_ger_classificar: a => { const p = a.p; if (!p.classe) throw new Error('Escolha a classe (ex.: Insumos, Salários, Receitas)');
      db.lin_ger_lancamentos.filter(l => p.ids.includes(l.id)).forEach(l => { l.classe = p.classe; l.classificacao = p.classificacao || ''; l.revisar = false; if ('observacao' in p) l.observacao = p.observacao || ''; }); return p.ids.length; },
    lin_ger_regra_salvar: a => { const p = a.p; if ((p.padrao || '').length < 3) throw new Error('O trecho da descrição precisa de ao menos 3 letras');
      if (p.id) Object.assign(db.lin_ger_regras.find(r => r.id === p.id), p); else db.lin_ger_regras.push({ id: ++seq, conta: '', tipo: '', prioridade: 100, ativo: true, observacao: '', classificacao: '', ...p }); return seq; },
    lin_ger_regra_excluir: a => { db.lin_ger_regras = db.lin_ger_regras.filter(r => r.id !== a.p_id); },
    lin_ger_lancamento_excluir: a => { if ((a.p_motivo || '').trim().length < 5) throw new Error('Escreva o motivo da exclusão (ao menos 5 letras)'); db.lin_ger_lancamentos = db.lin_ger_lancamentos.filter(l => l.id !== a.p_id); },
    lin_ger_lancamento_incluir: a => { const p = a.p, v = Number(p.valor); if ((p.observacao || '').length < 5) throw new Error('Escreva por que o lançamento não está no extrato (ao menos 5 letras)');
      db.lin_ger_lancamentos.push({ id: ++seq, conta: 'socia', data: p.data, descricao: p.descricao, credito: v > 0 ? v : 0, debito: v < 0 ? -v : 0, classe: p.classe, classificacao: p.classificacao,
        revisar: false, chave: 'manual|' + seq, observacao: p.observacao, criado_em: new Date().toISOString(), criado_nome: 'Gorette' }); return seq; },
    lin_ger_importar: a => { const p = a.p, imp = ++seq; let novos = 0, rep = 0, rev = 0;
      p.lancamentos.forEach(l => { if (db.lin_ger_lancamentos.some(x => x.chave === l.chave || (l.fitid && x.conta === p.conta && x.fitid === l.fitid))) { rep++; return; }
        novos++; if (!l.classe) rev++;
        db.lin_ger_lancamentos.push({ id: ++seq, conta: p.conta, data: l.data, descricao: l.descricao, credito: l.credito, debito: l.debito, classe: l.classe || 'A classificar',
          classificacao: l.classificacao || '', revisar: !l.classe, chave: l.chave, fitid: l.fitid, importacao_id: imp, regra_id: l.regra_id, observacao: '', criado_em: new Date().toISOString(), criado_nome: 'Gorette' }); });
      db.lin_ger_importacoes.unshift({ id: imp, conta: p.conta, arquivo: p.arquivo, novos, repetidos: rep, saldo_final: p.saldo_final, saldo_data: p.saldo_data, criado_em: new Date().toISOString(), criado_nome: 'Gorette' });
      return { importacao_id: imp, novos, repetidos: rep, a_classificar: rev }; },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-dono' } } } }) },
    from: tab => consulta(tab),
    rpc: async (nome, args) => { window.__rpc.push([nome, JSON.parse(JSON.stringify(args || {}))]);
      try { return { data: fn[nome] ? fn[nome](args || {}) : null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } } }) };
})();`;
// Chart.js imitado: conta os gráficos
const CHART = 'window.__graficos = 0; window.Chart = class { constructor(el, cfg) { window.__graficos++; this.cfg = cfg; } destroy() {} };';

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261007120000[-3:BRT]<TRNAMT>1500.00<FITID>A1<MEMO>RECEBIMENTO REDE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261008<TRNAMT>-286.71<FITID>A2<MEMO>PAGAMENTO BOLETO BOTOES EXEMPLO LTDA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010<TRNAMT>2000.00<FITID>A3<MEMO>RECEBIMENTO REDE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261011<TRNAMT>-126.00<FITID>A4<MEMO>PIX ENVIADO FULANA COSTURA DA SILVA •••.111.222-••</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261011<TRNAMT>-55.00<FITID>A5<MEMO>PIX ENVIADO PESSOA NOVA</STMTTRN>
<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20261011<TRNAMT>4087.29<FITID>A6<MEMO>SALDO TOTAL DISPONÍVEL DIA</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>4032.29<DTASOF>20261011</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
// 1000 (06/10) + 1500 − 286,71 (no banco) + 2000 − 126 − 55 (novos) = 4032,29
const CSV_NU = 'Data,Valor,Identificador,Descrição\n12/10/2026,-35.50,abc-1,"Compra no débito - Padaria, Exemplo"\n13/10/2026,800.00,abc-2,Transferência recebida pelo Pix - CLIENTE EXEMPLO\n';

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
const TIT = { ger_geral: 'Visão geral', ger_cat: 'Categorias', ger_lanc: 'Lançamentos', ger_cons: 'Considerações', ger_imp: 'Importar extratos' };
const aba = async (pg, v) => { await pg.click('#grp_gerencial'); await pg.click(`.aba[data-v="${v}"]`); await pg.waitForSelector(`.cabtela h2:has-text("${TIT[v]}")`); };
const rpc = (pg, nome) => pg.evaluate(n => window.__rpc.filter(x => x[0] === n).map(x => x[1]), nome);
const brl = t => t.replace(/\s/g, ' ');

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    for (const papel of ['vendedora', 'estoque']) {
      const v = await pagina(ctx, papel);
      ok(!(await v.pg.locator('#grp_gerencial').isVisible()), `${papel} não vê o Gerencial`);
      await v.pg.close();
    }
    const { pg, erros } = await pagina(ctx, 'dono');
    ok(await pg.locator('#grp_gerencial').isVisible(), 'Dono vê o Gerencial');
    await aba(pg, 'ger_geral');
    ok(await pg.locator('#tela canvas').count() === 4 && await pg.evaluate(() => window.__graficos) >= 4, '4 gráficos na Visão geral');
    await pg.selectOption('#gano', '');
    await pg.waitForFunction(() => document.querySelector('.kpis'));
    let k = (await kpis(pg)).map(brl);
    // receita 30.000 + 1.500 = 31.500; despesas 8.000 + 5.000 + 400 + 1.200 + 286,71 = 14.886,71 (sem Retiradas e Transferência Interna)
    ok(k[0] === 'R$ 31.500,00' && k[1] === 'R$ 14.886,71' && k[2] === 'R$ 16.613,29', 'Visão geral: receita, despesas e resultado sem as classes neutras ' + k.slice(0, 3).join(' | '));
    ok(k[3] === 'R$ 8.400,00' && k[4] === 'R$ 5.000,00' && k[5] === 'R$ 1.200,00', 'insumos, aluguel e impostos');
    const box = await pg.locator('.gbox.soc').innerText();
    ok(box.includes('10.610,00') && box.includes('3.000,00') && box.includes('7.610,00') && box.includes('devolver à sócia'), 'conta corrente da sócia: aporte fora do banco − retirada');
    ok((await pg.locator('.gbox').first().innerText()).includes('3.000,00'), 'transferências internas fora do resultado');
    ok((await pg.locator('#msg, .msg.info').first().innerText()).includes('1 lançamento(s) a classificar') || (await pg.locator('.msg.info').innerText()).includes('a classificar'), 'aviso de lançamentos a classificar');
    await print(pg, 'ger_geral');
    // filtro por mês
    await pg.selectOption('#gmes', '10');
    k = (await kpis(pg)).map(brl);
    ok(k[0] === 'R$ 1.500,00' && k[1] === 'R$ 286,71', 'filtro de mês: outubro');
    await pg.selectOption('#gmes', '');
    // clicar na classe abre os lançamentos
    await pg.locator('tr.gcl', { hasText: 'Insumos' }).first().click();
    await pg.waitForSelector('#dlg[open]');
    ok((await pg.locator('#dlg').innerText()).includes('2 lançamento(s)'), 'clicar na classe mostra os lançamentos');
    await pg.click('#glx');
    // Categorias: abre a classe e mostra as classificações
    await aba(pg, 'ger_cat');
    await pg.locator('tr.gcl', { hasText: 'Insumos' }).first().click();
    await pg.waitForSelector('tr.gsub');
    const subs = await pg.locator('tr.gsub').allInnerTexts();
    ok(subs.length === 2 && subs.some(s => s.includes('Costureira')) && subs.some(s => s.includes('Insumo')), 'Categorias: classe aberta mostra as classificações');
    ok(!(await pg.locator('#tela table').innerText()).includes('Transferência Interna'), 'Categorias sem as classes neutras');
    await print(pg, 'ger_categorias');
    // Lançamentos: a classificar → classificar com regra
    await pg.click('#girrev');
    await pg.waitForSelector('#grev:checked');
    ok(await pg.locator('.glin').count() === 1, '"Classificar agora" filtra os a classificar');
    await pg.locator('.gsel').first().check();
    await pg.click('#gclass');
    await pg.waitForSelector('#dlg[open] #gfc');
    await pg.fill('#gfc', 'Insumos'); await pg.fill('#gfs', 'Aviamentos');
    await pg.check('#gfr');
    ok(await pg.inputValue('#gfp') !== '', 'regra: trecho sugerido');
    await pg.fill('#gfp', 'BOTOES EXEMPLO');
    await pg.click('#gfok');
    await pg.waitForFunction(() => !document.querySelector('#dlg[open]'));
    const cl = await rpc(pg, 'lin_ger_classificar'), rg = await rpc(pg, 'lin_ger_regra_salvar');
    ok(cl.length === 1 && cl[0].p.classe === 'Insumos' && cl[0].p.classificacao === 'Aviamentos' && cl[0].p.ids.length === 1, 'classificar chama lin_ger_classificar');
    ok(rg.length === 1 && rg[0].p.padrao === 'BOTOES EXEMPLO' && rg[0].p.tipo === 'debito', 'regra criada junto (só débitos)');
    ok(await pg.locator('.glin').count() === 0 && !(await pg.locator('#girrev').count()), 'nada mais a classificar');
    // busca, CSV
    await pg.uncheck('#grev');
    await pg.fill('#gq', 'boletos');
    await pg.waitForTimeout(500);
    await pg.fill('#gq', 'boleto');
    await pg.waitForFunction(() => document.querySelectorAll('.glin').length === 2);
    ok(true, 'busca na descrição');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#gcsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.split('\r\n').length === 3 && csv.includes('"Aviamentos"') && csv.includes('"-286,71"'), 'CSV dos lançamentos filtrados');
    await pg.fill('#gq', '');
    // fora do banco
    await pg.click('#gman');
    await pg.fill('#gmt', 'Sócia pagou o frete'); await pg.fill('#gmv', '-250,00'); await pg.fill('#gfc', 'Despesas Operação');
    await pg.click('#gfok');
    ok((await pg.locator('#gferr').innerText()).includes('por que'), 'fora do banco exige o motivo');
    await pg.fill('#gmo', 'pagou com o cartão dela');
    await pg.click('#gfok');
    await pg.waitForFunction(() => !document.querySelector('#dlg[open]'));
    const fb = await rpc(pg, 'lin_ger_lancamento_incluir');
    ok(fb.length === 2 && fb[1].p.valor === '-250.00' && fb[1].p.classe === 'Despesas Operação', 'lançamento fora do banco gravado (valor do jeito brasileiro)');
    // excluir com motivo
    await pg.locator('.glin', { hasText: 'frete' }).click();
    await pg.waitForSelector('#gex');
    pg.__resposta = 'lançado errado no teste';
    await pg.click('#gex');
    await pg.waitForFunction(() => !document.querySelector('#dlg[open]'));
    ok((await rpc(pg, 'lin_ger_lancamento_excluir')).length === 1, 'excluir lançamento com motivo');
    // Importar OFX do Itaú
    await aba(pg, 'ger_imp');
    await pg.setInputFiles('#giarq', { name: 'Extrato_Itau_202610.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX.replace(/•/g, '\x95'), 'latin1') });
    ok((await pg.locator('#gierr').innerText()).includes('Escolha antes a conta'), 'importar exige escolher a conta');
    await pg.selectOption('#gicta', 'itau');
    await pg.setInputFiles('#giarq', { name: 'Extrato_Itau_202610.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(OFX.replace(/•/g, '\x95'), 'latin1') });
    await pg.waitForSelector('#giok');
    k = await kpis(pg);
    ok(k.join('|') === '5|3|1|1|3', 'OFX: 5 no arquivo (SALDO fora), 3 novos, 1 talvez, 1 já importado, 3 a importar ' + k.join('|'));
    const tab = await pg.locator('.card', { hasText: '2. Confira' }).innerText();
    ok(tab.includes('regra “RECEBIMENTO REDE”') && tab.includes('mesmo CPF/CNPJ de 12/09/2026'), 'sugestão pela regra e pelo mesmo CPF');
    ok(await pg.inputValue('.gicl >> nth=2') === 'Insumos' && await pg.inputValue('.gics >> nth=2') === 'Costureira', 'mesmo CPF trouxe Insumos · Costureira');
    ok((await pg.locator('.msg.ok', { hasText: 'Saldo informado' }).innerText()).includes('confere'), 'conferência do saldo: confere');
    await print(pg, 'ger_importar');
    // desmarcar um muda a conferência
    await pg.locator('.gimk').nth(2).click();
    await pg.waitForSelector('.msg.err:has-text("Saldo informado")');
    ok((await pg.locator('.msg.err', { hasText: 'Saldo informado' }).innerText()).includes('diferença'), 'desmarcar um lançamento mostra a diferença no saldo');
    await pg.locator('.gimk').nth(2).click();
    await pg.waitForSelector('.msg.ok:has-text("Saldo informado")');
    await pg.click('#giok');
    await pg.waitForSelector('#grev:checked');
    const im = (await rpc(pg, 'lin_ger_importar'))[0].p;
    ok(im.conta === 'itau' && im.lancamentos.length === 3 && im.saldo_final === 4032.29 && im.saldo_data === '2026-10-11', 'lin_ger_importar com 3 lançamentos e o saldo');
    const nova = im.lancamentos.find(l => l.data === '2026-10-11' && l.debito === 55);
    ok(nova && nova.revisar && !nova.classe && /^itau\|2026-10-11\|-55\.00\|pix enviado pessoa nova\|1$/.test(nova.chave) && nova.fitid === 'A5', 'sem sugestão vai "a classificar"; chave e FITID');
    ok(im.lancamentos.find(l => l.data === '2026-10-10').regra_id === 1, 'regra registrada no lançamento');
    ok(await pg.locator('.glin').count() === 1, 'depois de importar abre os a classificar');
    // CSV do Nubank
    await aba(pg, 'ger_imp');
    await pg.selectOption('#gicta', 'nubank');
    await pg.setInputFiles('#giarq', { name: 'NU_123.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV_NU, 'utf8') });
    await pg.waitForSelector('#giok');
    const tnu = await pg.locator('.card', { hasText: '2. Confira' }).innerText();
    ok(tnu.includes('Compra no débito - Padaria, Exemplo') && tnu.includes('800,00'), 'CSV do Nubank (vírgula dentro de aspas)');
    await pg.click('#gicanc');
    // regra nova pela tela
    await pg.click('#ginr');
    await pg.fill('#grp', 'ab'); await pg.fill('#grc', 'Insumos'); await pg.click('#grok');
    ok((await pg.locator('#grerr').innerText()).includes('3 letras'), 'regra com trecho curto: mensagem do servidor');
    await pg.click('#grx');
    // Considerações: HTML limpo
    await aba(pg, 'ger_cons');
    await pg.selectOption('#gano', '');
    const cons = (await pg.locator('#tela').innerText()).replace(/\u00a0/g, ' ');
    ok(cons.indexOf('Avaliação executiva final') < cons.indexOf('Setembro / 2026'), 'avaliação executiva em primeiro');
    ok(cons.includes('B — Bom') && cons.includes('R$ 30.000') && cons.includes('Atenção ao caixa'), 'cartão do mês com nota, números e alerta');
    ok(cons.includes('Hoje, pelos lançamentos do mês: receita R$ 30.000,00'), 'números de hoje pelos lançamentos');
    ok(await pg.evaluate(() => !window.__xss && !document.querySelector('.gcorpo script, .gcorpo img, .gcorpo a, .gcorpo [onclick], .gcorpo [style]')), 'HTML das considerações limpo (sem script, imagem, link, onclick e style)');
    await pg.locator('.gcorpo p', { hasText: 'Clique' }).click();
    ok(await pg.evaluate(() => !window.__xss), 'clicar não executa nada');
    await print(pg, 'ger_consideracoes');
    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await pagina(cel, 'dono');
    await aba(c.pg, 'ger_geral');
    ok((await c.pg.locator('#tela').innerText()).includes('Período: 17/08/2026 a 08/10/2026'), 'período em ordem de data (o lançamento fora do banco é o mais antigo)');
    const largos = await c.pg.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.tw')).slice(0, 4).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)));
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral (Visão geral) ' + largos.join(' | '));
    await print(c.pg, 'ger_celular');
    await aba(c.pg, 'ger_lanc');
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral (Lançamentos)');
    ok(erros.length === 0 && c.erros.length === 0, 'sem erro de JavaScript ' + erros.concat(c.erros).join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
