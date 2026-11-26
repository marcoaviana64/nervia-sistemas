// Teste de tela do Gerencial → Contas a pagar do Sistema Linum (versão 2.70) com o Playwright do Node e um Supabase IMITADO
// no navegador (lin_ger_pagar, lin_ger_lancamentos, nf_notas + Storage nf-xml e as funções lin_ger_pagar_*). Dados FICTÍCIOS,
// com datas relativas a hoje.
// Confere: só Dono vê a aba; grade fornecedor × mês com a coluna Vencidas, totais e indicadores; clique no valor abre as
// parcelas; baixa com o lançamento do extrato sugerido (mesmo valor e CNPJ); NF-e do Buscador (duplicatas → parcelas, nota só
// resumo não marca); XML por arquivo (outro CNPJ avisa; sem duplicatas pede o vencimento); contas recorrentes (mensal × várias
// vezes no mês, fixo × estimado pela média dos 3 últimos meses, gerar 12 meses estimados); conta à mão com valor em reais;
// cancelar com motivo; CSV; celular.
// Uso: node testes/linum/tela_gerencial_pagar_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8837;

const HOJE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dia = k => new Date(Date.parse(HOJE + 'T12:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const mes = k => { const [a, m] = HOJE.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + k, 1)).toISOString().slice(0, 7); };
const DOC = '01234567000189';

const DADOS = { papel: 'dono', minha_loja: null, comissao_pct: 0, lojas: [{ id: 'l-ipa', nome: 'Ipanema' }], produtos: [], estoque: [] };
let ID = 0;
const P = (x) => ({ id: ++ID, origem: 'manual', fornecedor_doc: '', documento: '', nfe_chave: '', parcela: '', categoria: '', historico: '', situacao: 'aberta', pago_em: null, valor_pago: null,
  lancamento_id: null, pago_obs: '', cancelado_motivo: '', serie: null, estimado: false, chave: null, criado_em: '2026-11-01T12:00:00Z', criado_nome: 'Gorette', ...x });
const PAGAR = [
  P({ origem: 'nfe', fornecedor: 'Tecidos Fictícios Ltda', fornecedor_doc: DOC, documento: '5501', parcela: '1/2', vencimento: dia(-40), valor: 1345.30, nfe_chave: 'CH-5501', chave: 'nfe|CH-5501|001' }),
  P({ origem: 'nfe', fornecedor: 'Tecidos Fictícios Ltda', fornecedor_doc: DOC, documento: '5501', parcela: '2/2', vencimento: mes(1) + '-10', valor: 1345.30, nfe_chave: 'CH-5501', chave: 'nfe|CH-5501|002' }),
  P({ fornecedor: 'Imobiliária Exemplo', categoria: 'Aluguel', historico: 'Aluguel + condomínio', vencimento: mes(0) + '-28', valor: 6000 }),
  P({ fornecedor: 'Imobiliária Exemplo', categoria: 'Aluguel', historico: 'Aluguel + condomínio', vencimento: mes(1) + '-28', valor: 6000 }),
  P({ origem: 'carga', fornecedor: 'Malharia Antiga SA', documento: '7700', parcela: '1/1', vencimento: mes(-1) + '-15', valor: 900, situacao: 'paga', pago_em: mes(-1) + '-15', valor_pago: 900 }),
];
let LID = 0;
const L = (data, desc, v, classe, clas) => ({ id: ++LID, conta: 'itau', data, descricao: desc, credito: v > 0 ? v : 0, debito: v < 0 ? -v : 0, classe, classificacao: clas, revisar: false,
  chave: 'k' + LID, fitid: null, importacao_id: 1, regra_id: null, observacao: '', criado_em: '2026-11-01T12:00:00Z', criado_nome: 'Carga', alterado_em: null, alterado_nome: '' });
const LANC = [];
const LUZ = [900, 1100, 1000, 1200, 1300, 1500];   // 6 meses: média dos 3 últimos = 1.333,33
for (let k = -6; k <= -1; k++) {
  LANC.push(L(mes(k) + '-05', 'PIX ENVIADO IMOBILIARIA EXEMPLO', -6000, 'Aluguel', 'Aluguel Ipanema'));
  LANC.push(L(mes(k) + '-20', 'PAGAMENTO CONTA LIGHT', -LUZ[k + 6], 'Energia Elétrica', 'Ipanema'));
  for (let s = 0; s < 4; s++) LANC.push(L(mes(k) + '-' + String(3 + s * 7).padStart(2, '0'), 'PIX FULANA COSTURA', -200 - s * 10, 'Insumos', 'Costureira'));
  if (k >= -2) LANC.push(L(mes(k) + '-12', 'NETFLIX', -55.9, 'Sistema', 'Assinatura'));   // só 2 meses: não é recorrente
}
LANC.push(L(dia(-38), 'PIX ENVIADO TECIDOS FICTICIOS LTDA 01.234.567/0001-89', -1345.30, 'Insumos', 'Insumo'));
LANC.push(L(dia(-39), 'PIX ENVIADO OUTRA PESSOA', -1345.30, 'Pix', 'Pix'));
LANC.push(L(dia(-37), 'TRANSFERENCIA PARA NUBANK', -1345.30, 'Transferência Interna', 'Nubank'));

const XML = (chave, nNF, dest, dups) => `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chave}" versao="4.00">
<ide><nNF>${nNF}</nNF><dhEmi>${dia(-3)}T10:00:00-03:00</dhEmi></ide><emit><CNPJ>98765432000110</CNPJ><xNome>Aviamentos Exemplo Ltda</xNome></emit>
<dest><CNPJ>${dest}</CNPJ></dest><total><ICMSTot><vNF>${dups.length ? dups.reduce((a, d) => a + d[2], 0).toFixed(2) : '480.00'}</vNF></ICMSTot></total>
${dups.length ? `<cobr><fat><nFat>${nNF}</nFat></fat>${dups.map(d => `<dup><nDup>${d[0]}</nDup><dVenc>${d[1]}</dVenc><vDup>${d[2].toFixed(2)}</vDup></dup>`).join('')}</cobr>` : ''}
</infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe></infProt></protNFe></nfeProc>`;
const CH1 = '33261198765432000110550010000088881000000001';
const XML1 = XML(CH1, '8888', '46469501000112', [['001', mes(1) + '-05', 300], ['002', mes(2) + '-05', 300], ['003', mes(3) + '-05', 300.5]]);
const NOTAS = [
  { id: 1, chave: CH1, numero: '8888', emit_cnpj: '98765432000110', emit_nome: 'Aviamentos Exemplo Ltda', data_emissao: dia(-3) + 'T13:00:00Z', valor: 900.5, situacao: 'autorizada', completo: true, xml_path: '46469501000112/n1.xml' },
  { id: 2, chave: 'CH-RESUMO', numero: '9999', emit_cnpj: '11111111000111', emit_nome: 'Linhas Resumo SA', data_emissao: dia(-2) + 'T13:00:00Z', valor: 250, situacao: 'autorizada', completo: false, xml_path: null },
  { id: 3, chave: 'CH-5501', numero: '5501', emit_cnpj: DOC, emit_nome: 'Tecidos Fictícios Ltda', data_emissao: dia(-40) + 'T13:00:00Z', valor: 2690.6, situacao: 'autorizada', completo: true, xml_path: 'x' },
  { id: 4, chave: 'CH-7700', numero: '7700', emit_cnpj: '', emit_nome: 'MALHARIA ANTIGA S.A.', data_emissao: dia(-60) + 'T13:00:00Z', valor: 900, situacao: 'autorizada', completo: true, xml_path: 'y' },
];

const FALSO = `(() => {
  const D = ${JSON.stringify(DADOS)};
  const XMLS = { '46469501000112/n1.xml': ${JSON.stringify(XML1)} };
  const db = window.__db = { lin_ger_pagar: ${JSON.stringify(PAGAR)}, lin_ger_lancamentos: ${JSON.stringify(LANC)}, lin_ger_regras: [], lin_ger_importacoes: [], lin_ger_consideracoes: [], nf_notas: ${JSON.stringify(NOTAS)} };
  window.__rpc = [];
  const ok = data => Promise.resolve({ data, error: null });
  const consulta = tab => { const q = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, or: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q,
    range: (a, b) => ok(JSON.parse(JSON.stringify((db[tab] || []).slice(a, b + 1)))),
    maybeSingle: () => ok({ admin: false }), then: (r, j) => ok(JSON.parse(JSON.stringify(db[tab] || []))).then(r, j) }; return q; };
  let seq = 1000;
  const fn = {
    lin_estoque_ler: () => JSON.parse(JSON.stringify(D)),
    lin_meu_horario: () => ({ liberado: true }),
    lin_minhas_permissoes: () => ({ producao: false, producao_valores: false }),
    lin_ger_pagar_importar: a => { let novos = 0, rep = 0;
      a.p.contas.forEach(c => { if (!c.vencimento) throw new Error('Informe o vencimento da parcela de ' + c.fornecedor);
        if (db.lin_ger_pagar.some(x => x.chave === c.chave)) { rep++; return; } novos++;
        db.lin_ger_pagar.push({ id: ++seq, origem: 'nfe', situacao: 'aberta', estimado: false, pago_em: null, valor_pago: null, lancamento_id: null, cancelado_motivo: '', pago_obs: '',
          ...c, fornecedor_doc: (c.fornecedor_doc || '').replace(/\\D/g, ''), valor: Number(c.valor), categoria: c.categoria || '' }); });
      return { novos, repetidos: rep }; },
    lin_ger_pagar_salvar: a => { const p = a.p; if (!p.fornecedor) throw new Error('Informe o fornecedor'); if (!p.vencimento) throw new Error('Informe o vencimento');
      if (!(p.valor > 0)) throw new Error('Informe o valor (maior que zero)');
      if (p.id) { Object.assign(db.lin_ger_pagar.find(c => c.id === p.id), p); return 1; }
      for (let i = 0; i < p.repetir; i++) { const [y, m, d] = p.vencimento.split('-').map(Number); const ult = new Date(Date.UTC(y, m + i, 0)).getUTCDate();
        const v = new Date(Date.UTC(y, m - 1 + i, Math.min(d, ult))).toISOString().slice(0, 10);
        db.lin_ger_pagar.push({ id: ++seq, origem: 'manual', fornecedor: p.fornecedor, fornecedor_doc: (p.fornecedor_doc || '').replace(/\\D/g, ''), documento: p.documento || '', nfe_chave: '',
          parcela: p.repetir > 1 ? (i + 1) + '/' + p.repetir : '', vencimento: v, valor: p.valor, categoria: p.categoria || '', historico: p.historico || '', situacao: 'aberta', estimado: !!p.estimado,
          pago_em: null, valor_pago: null, lancamento_id: null, cancelado_motivo: '', pago_obs: '', chave: null }); }
      return p.repetir; },
    lin_ger_pagar_baixa: a => { const p = a.p; db.lin_ger_pagar.filter(c => p.ids.includes(c.id)).forEach(c => { if (c.situacao !== 'aberta') throw new Error('não está em aberto');
      Object.assign(c, { situacao: 'paga', pago_em: p.pago_em, valor_pago: p.valor_pago || c.valor, lancamento_id: p.lancamento_id, estimado: false }); }); return p.ids.length; },
    lin_ger_pagar_situacao: a => { if ((a.p_motivo || '').trim().length < 5) throw new Error('Escreva o motivo (ao menos 5 letras)');
      const c = db.lin_ger_pagar.find(x => x.id === a.p_id); if (a.p_acao === 'cancelar') Object.assign(c, { situacao: 'cancelada', cancelado_motivo: a.p_motivo });
      else Object.assign(c, { situacao: 'aberta', pago_em: null, valor_pago: null, lancamento_id: null }); },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-dono' } } } }) },
    from: tab => consulta(tab),
    storage: { from: () => ({ download: async p => XMLS[p] ? { data: new Blob([XMLS[p]], { type: 'text/xml' }), error: null } : { data: null, error: { message: 'Arquivo não encontrado' } } }) },
    rpc: async (nome, args) => { window.__rpc.push([nome, JSON.parse(JSON.stringify(args || {}))]);
      try { return { data: fn[nome] ? fn[nome](args || {}) : null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } } }) };
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
  pg.on('dialog', d => d.accept(pg.__resposta || ''));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('"papel":"dono"', `"papel":"${papel}"`), contentType: 'text/javascript' }));
  await pg.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: 'window.Chart = class { destroy() {} };', contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/?aba=estoque`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const rpc = (pg, nome) => pg.evaluate(n => window.__rpc.filter(x => x[0] === n).map(x => x[1]), nome);
const sp = t => t.replace(/\s/g, ' ');
const abrir = async pg => { await pg.click('#grp_gerencial'); await pg.click('.aba[data-v="ger_pagar"]'); await pg.waitForSelector('.cabtela h2:has-text("Contas a pagar")'); };
const fechado = (pg, d = 'dlg') => pg.waitForFunction(id => !document.querySelector('#' + id + '[open]'), d);

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const v = await pagina(ctx, 'vendedora');
    ok(await v.pg.locator('.aba[data-v="ger_pagar"]').evaluate(e => e.classList.contains('oculto')), 'vendedora não vê Contas a pagar');
    await v.pg.close();

    const { pg, erros } = await pagina(ctx, 'dono');
    await abrir(pg);
    const cab = await pg.locator('.gpgrade thead th').allInnerTexts();
    ok(cab[1].toLowerCase() === 'vencidas' && cab.length === 1 + 1 + 12 + 1, 'grade: Fornecedor, Vencidas, 12 meses e Total');
    const linhas = await pg.locator('.gpgrade tbody tr').allInnerTexts();
    ok(linhas.length === 2 && linhas[0].includes('Imobiliária Exemplo') && linhas[1].includes('Tecidos Fictícios') && linhas[1].includes('01.234.567/0001-89'), 'uma linha por fornecedor (em aberto), com o CNPJ');
    ok(!linhas.join().includes('Malharia'), 'conta paga fora da visão "Em aberto"');
    const tot = sp(await pg.locator('.gpgrade tfoot').innerText());
    ok(tot.includes('14.690,60'), 'total geral 1.345,30 × 2 + 6.000 × 2');
    const k = (await pg.locator('.kpis .kpi b').allInnerTexts()).map(sp);
    ok(k[0] === 'R$ 1.345,30' && k[4] === 'R$ 14.690,60', 'indicadores: vencidas e em aberto');
    ok(await pg.locator('.gpcel.venc').count() >= 2, 'valor vencido em vermelho');
    ok((await pg.locator('#gpimp').innerText()).includes('(2)') && await pg.locator('.msg.info', { hasText: 'Buscador de NF' }).count() === 1, 'avisa as NF-e do Buscador que faltam (a 5501 já está, a 7700 veio na carga)');
    await print(pg, 'pagar_grade');

    // desmembramento + baixa com sugestão do extrato
    await pg.locator('.gpgrade tbody tr', { hasText: 'Tecidos' }).locator('td').nth(1).locator('.gpcel').click();
    await pg.waitForSelector('#dlg[open] .gpsel');
    ok((await pg.locator('#dlgf h3').innerText()).includes('Tecidos Fictícios Ltda · vencidas'), 'clique na célula abre o desmembramento');
    ok((await pg.locator('#dlgf tbody tr').count()) === 1 && (await pg.locator('#dlgf').innerText()).includes('vencida'), 'mostra a parcela vencida');
    await pg.click('#dlgf [data-pg]');
    await pg.waitForSelector('#dlg2[open] #gpbok');
    const sug = await pg.locator('.gpsug label').allInnerTexts();
    ok(sug.length === 3 && sug[1].toLowerCase().includes('mesmo valor') && sug[1].toLowerCase().includes('mesmo cnpj'), 'sugere o lançamento do extrato (mesmo valor e CNPJ primeiro; transferência interna fora)');
    ok(await pg.locator('.gpsug input[type=radio]').nth(1).isChecked() && await pg.inputValue('#gpbd') === dia(-38), 'marca a sugestão e usa a data dela');
    await print(pg, 'pagar_baixa');
    await pg.click('#gpbok');
    await fechado(pg, 'dlg2');
    let r = await rpc(pg, 'lin_ger_pagar_baixa');
    ok(r.length === 1 && r[0].p.ids.length === 1 && r[0].p.lancamento_id === LANC.find(l => l.descricao.includes('TECIDOS')).id && !('valor_pago' in r[0].p), 'baixa grava a data e o lançamento');
    ok((await pg.locator('#dlgf').innerText()).includes('paga em'), 'desmembramento atualizado: paga');
    await pg.click('#gpdx');
    ok(await pg.locator('.gpgrade thead th', { hasText: /vencidas/i }).count() === 0, 'sem vencidas, a coluna some');

    // cancelar com motivo
    await pg.locator('.gpgrade tbody tr', { hasText: 'Imobiliária' }).locator('.gpforn').click();
    await pg.waitForSelector('#dlg[open] [data-ca]');
    ok((await pg.locator('#dlgf tbody tr').count()) === 2, 'clique no fornecedor abre todas as parcelas dele');
    pg.__resposta = 'contrato renegociado';
    await pg.locator('#dlgf [data-ca]').last().click();
    await pg.waitForFunction(() => document.querySelector('#dlgf').innerText.includes('cancelada'));
    r = await rpc(pg, 'lin_ger_pagar_situacao');
    ok(r.length === 1 && r[0].p_acao === 'cancelar' && r[0].p_motivo === 'contrato renegociado', 'cancelar com motivo');
    await pg.click('#gpdx');

    // importar NF-e do Buscador
    await pg.click('#gpimp');
    await pg.waitForSelector('#dlg[open] #gpnler');
    ok(await pg.locator('.gpnf').count() === 1 && (await pg.locator('#dlgf').innerText()).includes('só resumo'), 'nota só resumo aparece sem marcar');
    await pg.click('#gpnler');
    await pg.waitForSelector('#gppok');
    const prev = (await pg.locator('.gpprev tbody tr').allInnerTexts()).map(sp);
    ok(prev.length === 3 && prev[0].includes('1/3') && prev[2].includes('R$ 300,50'), 'duplicatas viram 3 parcelas');
    await print(pg, 'pagar_nfe');
    await pg.fill('#gppc', 'Insumos');
    await pg.click('#gppok');
    await fechado(pg);
    r = await rpc(pg, 'lin_ger_pagar_importar');
    const c0 = r[0].p.contas[0];
    ok(r[0].p.origem === 'nfe' && r[0].p.contas.length === 3 && c0.chave === `nfe|${CH1}|001` && c0.vencimento === mes(1) + '-05' && c0.parcela === '1/3'
      && c0.fornecedor_doc === '98765432000110' && c0.documento === '8888' && c0.categoria === 'Insumos', 'grava as parcelas com chave, vencimento, CNPJ e categoria');
    ok((await pg.locator('#gpimp').innerText()).includes('(1)'), 'a nota importada sai da lista de pendentes');

    // XML por arquivo: outro CNPJ avisa; sem duplicatas pede o vencimento
    await pg.click('#gpimp');
    await pg.waitForSelector('#gpxml');
    await pg.setInputFiles('#gpxml', { name: 'nota.xml', mimeType: 'text/xml', buffer: Buffer.from(XML('33261198765432000110550010000077771000000002', '7777', '11222333000144', [])) });
    await pg.waitForSelector('#gppok');
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('outro CNPJ'), 'XML para outro CNPJ: avisa');
    ok(await pg.inputValue('.gppv') === '' && (await pg.locator('#dlgf').innerText()).includes('não traz duplicatas'), 'sem duplicatas: uma parcela com o vencimento a informar');
    await pg.click('#gppok');
    await pg.waitForSelector('#gpperr .msg.err');
    ok((await pg.locator('#gpperr').innerText()).includes('vencimento'), 'sem vencimento não grava');
    await pg.fill('.gppv', mes(1) + '-20');
    await pg.click('#gppok');
    await fechado(pg);
    r = await rpc(pg, 'lin_ger_pagar_importar');
    ok(r.length === 3 && r[2].p.contas[0].valor === 480 && r[2].p.contas[0].chave.endsWith('|unica'), 'nota sem duplicatas grava uma parcela com o valor da nota');

    // contas recorrentes
    await pg.click('#gprec');
    await pg.waitForSelector('#dlg[open] [data-rg]');
    const rec = (await pg.locator('#dlgf table').first().locator('tbody tr').allInnerTexts()).map(sp);
    const luz = rec.find(x => x.includes('Energia Elétrica Ipanema'));
    const alu = rec.find(x => x.includes('Aluguel Ipanema'));
    ok(rec.length === 2 && luz && alu, 'contas mensais: aluguel e luz (Netflix só 2 meses, costureira à parte)');
    ok(luz.includes('R$ 1.333,33') && luz.includes('varia de R$ 900,00 a R$ 1.500,00') && luz.includes('dia 20'), 'luz: média dos 3 últimos meses, faixa e dia');
    ok(alu.includes('R$ 6.000,00') && alu.includes('valor fixo') && alu.includes('dia 5'), 'aluguel: valor fixo');
    await pg.click('#dlgf details summary');
    ok((await pg.locator('#dlgf details').innerText()).includes('Costureira') && (await pg.locator('#dlgf details').innerText()).includes('4×/mês'), 'pagamentos várias vezes no mês ficam à parte');
    await print(pg, 'pagar_recorrentes');
    await pg.locator('#dlgf table').first().locator('tr', { hasText: 'Energia' }).locator('[data-rg]').click();
    await pg.waitForSelector('#gpeok');
    ok(await pg.inputValue('#gpef') === 'Energia Elétrica Ipanema' && await pg.inputValue('#gpec') === 'Energia Elétrica' && await pg.inputValue('#gpeval') === '1.333,33'
      && await pg.isChecked('#gpeest') && await pg.inputValue('#gper') === '12' && (await pg.inputValue('#gpev')).endsWith('-20'), 'gerar: formulário com a média estimada, dia 20 e 12 meses');
    await pg.fill('#gpef', 'Light Ipanema');
    await pg.click('#gpeok');
    await pg.waitForSelector('#dlg[open] [data-rg]');
    r = await rpc(pg, 'lin_ger_pagar_salvar');
    ok(r.length === 1 && r[0].p.estimado === true && r[0].p.repetir === 12 && r[0].p.valor === 1333.33, 'gera 12 contas estimadas');
    await pg.click('#gprx');
    ok(await pg.locator('.gpgrade tbody tr', { hasText: 'Light Ipanema' }).locator('.gpcel.est').count() >= 11, 'contas estimadas aparecem com "~"');
    ok((await pg.locator('.kpis').innerText()).includes('com valor estimado'), 'indicador conta as estimadas');

    // conta à mão com valor em reais
    await pg.click('#gpnova');
    await pg.waitForSelector('#gpeok');
    await pg.fill('#gpef', 'Contabilidade Exemplo'); await pg.fill('#gpev', mes(1) + '-18'); await pg.fill('#gpeval', '24.0870');
    await pg.click('#gpeok');
    await pg.waitForSelector('#gpeerr .msg.err');
    ok((await pg.locator('#gpeerr').innerText()).includes('24.087,08'), 'valor em reais ambíguo é recusado');
    await pg.fill('#gpeval', '1.234,56');
    await pg.click('#gpeok');
    await fechado(pg);
    r = await rpc(pg, 'lin_ger_pagar_salvar');
    ok(r[1].p.valor === 1234.56 && r[1].p.repetir === 1 && r[1].p.estimado === false, 'conta à mão com valor 1.234,56');

    // ver pagas, busca e CSV
    await pg.selectOption('#gpver', 'todas');
    await pg.selectOption('#gpde', mes(-1));
    ok(await pg.locator('.gpgrade tbody tr', { hasText: 'Malharia' }).locator('.gpcel.pago').count() === 1, 'em aberto e pagas: paga em verde');
    await pg.fill('#gpq', 'contabil');
    await pg.waitForFunction(() => document.querySelectorAll('.gpgrade tbody tr').length === 1);
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#gpcsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.includes('"Contabilidade Exemplo"') && csv.includes('"1234,56"') && csv.split('\r\n').length === 2, 'CSV com as contas da tela');
    await pg.fill('#gpq', '');

    // celular
    await pg.setViewportSize({ width: 390, height: 844 });
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'celular: a página não rola de lado (a grade rola dentro do quadro)');
    await print(pg, 'pagar_celular');
    ok(!erros.length, 'sem erros na página' + (erros.length ? ': ' + erros.join(' | ') : ''));
  } finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
