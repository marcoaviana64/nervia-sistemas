// Teste de tela das PROMOÇÕES do Sistema Linum (versão 2.58) com o Playwright do Node e um Supabase IMITADO no navegador.
// Dados FICTÍCIOS. As regras do banco estão nos testes SQL (testes/teste_sql.sql, "linum 2.58").
// Uso: node testes/linum/tela_promocoes_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8847;
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const ontem = (() => { const x = new Date(hoje + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); })();

const DADOS = {
  papel: 'vendedora', minha_loja: 'l-ipa', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'A25', descricao: 'Vestido Artesanal', categoria: 'Vestido', preco_venda: 1799,
    variantes: [{ id: 'v1', cor: 'Natural', tamanho: 'G', edicao: '' }, { id: 'v2', cor: 'Natural', tamanho: 'M', edicao: 'Bordada', preco_venda: 2400 }] },
    { id: 'p2', referencia: 'B10', descricao: 'Blusa Linho', categoria: 'Blusa', preco_venda: 500,
      variantes: [{ id: 'w1', cor: 'Cru', tamanho: 'P', edicao: '' }, { id: 'w2', cor: 'Cru', tamanho: 'M', edicao: '' }, { id: 'w3', cor: 'Preto', tamanho: 'P', edicao: '' }, { id: 'w4', cor: 'Preto', tamanho: 'M', edicao: '' }] }],
  estoque: [['v1', 'l-ipa', 5], ['v2', 'l-ipa', 3], ['v1', 'l-gav', 2], ['w1', 'l-ipa', 2], ['w4', 'l-ipa', 1]],
};
const venda = (id, vend, pags) => ({ id, data: hoje, loja_id: 'l-ipa', vendedora_id: vend, vendedora_nome: vend === 'u-vendedora' ? 'Beatriz' : 'Bia Outra',
  cliente_id: null, valor_bruto: 849, valor_itens: 849, desconto: 0, valor_total: 849, credito_usado: 0, valor_nf: 849, comissao_pct: 0, comissao_valor: 0,
  pagamentos: pags, observacao: '', criado_nome: 'Beatriz', criado_em: new Date().toISOString(), cancelada_em: null });

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [],
    vendas: [${JSON.stringify(venda(5, 'u-vendedora', [{ forma: 'pix', valor: 49 }, { forma: 'credito', valor: 800, parcelas: 2, cv: '' }]))},
             ${JSON.stringify(venda(6, 'u-vendedora', [{ forma: 'debito', valor: 849, parcelas: 1, cv: '189435334' }]))}],
    itens: [5, 6].map(v => ({ id: v * 10, venda_id: v, variante_id: 'v1', quantidade: 1, referencia: 'A25', descricao: 'Vestido Artesanal', cor: 'Natural', tamanho: 'G', edicao: '',
      preco_tabela: 849, desconto_pct: 0, valor_unitario: 849, valor_total: 849 })),
    cli: [], promos: [], pitens: [], seq: 1 };
  S.D.papel = '__PAPEL__'; if (window.__PROMOS) { S.promos = window.__PROMOS.promos; S.pitens = window.__PROMOS.pitens; S.seq = 100; }
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const pode = v => S.D.papel === 'dono' || v.vendedora_id === eu;
  const tabela = t => ({ lin_promocoes: S.promos, lin_promo_itens: S.pitens, lin_clientes: S.cli, lin_vendas: S.vendas.filter(pode), lin_venda_itens: S.itens.filter(i => pode(S.vendas.find(v => v.id === i.venda_id))) }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q, not: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; }, is: (c, v) => { f.push(x => (x[c] ?? null) === v); return q; },
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; },
      or: () => q, maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }), lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]), lin_vendas_sem_cliente: () => ok([]), lin_creditos_saldos: () => ok({}),
    lin_vendedoras: () => ok([{ user_id: 'u-vendedora', nome: 'Beatriz' }, { user_id: 'u-dono', nome: 'Dona' }]),
    lin_venda_registrar: ({ p }) => { const id = 10 + S.vendas.length; S.vendas.push(Object.assign(${JSON.stringify(venda(0, 'x', []))}, { id, vendedora_id: p.vendedora_id || eu, data: p.data, pagamentos: p.pagamentos })); return ok(id); },
    lin_promocao_salvar: ({ p }) => { if (!['dono', 'estoque'].includes(S.D.papel)) return erro('Somente o Dono ou o Estoque cria e altera promoções');
      let id = p.id; if (id) { const x = S.promos.find(y => y.id === id); Object.assign(x, { nome: p.nome, loja_id: p.loja_id, inicio: p.inicio, fim: p.fim, observacao: p.observacao }); S.pitens = S.pitens.filter(i => i.promocao_id !== id); }
      else { id = S.seq++; S.promos.push({ id, nome: p.nome, loja_id: p.loja_id, inicio: p.inicio, fim: p.fim, observacao: p.observacao, criado_nome: 'Estoque', criado_em: new Date().toISOString(), cancelada_em: null }); }
      p.itens.forEach(i => S.pitens.push({ id: S.seq++, promocao_id: id, produto_id: i.produto_id, variante_id: i.variante_id, preco: Number(i.preco) })); return ok(id); },
    lin_promocao_cancelar: ({ p_id, p_motivo }) => { Object.assign(S.promos.find(x => x.id === p_id), { cancelada_em: new Date().toISOString(), cancelada_nome: 'Estoque', motivo_cancelamento: p_motivo }); return ok(null); },
    lin_promocoes_resumo: () => ok({}),
    lin_catalogo: () => ok({ produtos: S.D.produtos.map(p => ({ id: p.id, referencia: p.referencia, descricao: p.descricao, categoria: p.categoria, preco_venda: p.preco_venda, ativo: true })),
      variantes: S.D.produtos.flatMap(p => p.variantes.map(v => Object.assign({ produto_id: p.id, ativo: true }, v))) }),
    lin_venda_comprovante: ({ p_venda, p_cvs }) => { const v = S.vendas.find(x => x.id === p_venda);
      v.pagamentos = v.pagamentos.map((p, i) => (p.forma === 'credito' || p.forma === 'debito') && p_cvs[i] ? { ...p, cv: p_cvs[i].replace(/^0+/, '') } : p); return ok(null); },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: eu } } } }) },
    from: tab => consulta(tab),
    rpc: async (fn, args) => { S.rpc.push([fn, args]); return fns[fn] ? fns[fn](args || {}) : { data: null, error: null }; } }) };
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
async function pagina(ctx, papel, promos) {
  const pg = await ctx.newPage();
  if (promos) await pg.addInitScript(x => { window.__PROMOS = x; }, promos); const erros = [];
  pg.on('pageerror', e => erros.push(String(e.stack || e).slice(0, 300)));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('__PAPEL__', papel), contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/?aba=estoque`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
async function vendas(pg) {
  await pg.evaluate(() => { const d = document.getElementById('dlg2'); if (d.open) d.close(); });
  await pg.click('.barra .grupo[data-g="vendas"]'); await pg.waitForTimeout(150);
  await pg.click('#abaVendas'); await pg.waitForSelector('#vnova'); await pg.waitForTimeout(200);
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const ultimaRpc = (pg, fn) => pg.evaluate(fn => { const l = window.__S.rpc.filter(x => x[0] === fn); return l.length ? l[l.length - 1][1] : null; }, fn);
async function vendas(pg) {
  await pg.evaluate(() => { const d = document.getElementById('dlg2'); if (d.open) d.close(); });
  await pg.click('.barra .grupo[data-g="vendas"]'); await pg.waitForTimeout(150);
  await pg.click('#abaVendas'); await pg.waitForSelector('#vnova'); await pg.waitForTimeout(200);
}
async function nova(pg) {
  await pg.evaluate(() => { const d = document.getElementById('dlg2'); if (d.open) d.close(); });   // extrato da venda anterior (2.56)
  await pg.click('#vnova'); await pg.waitForSelector('#dlg[open] #nvok');
  await pg.fill('#nvpq', 'a25'); await pg.waitForTimeout(200); await pg.locator('#nvres button').first().click(); await pg.waitForTimeout(150);
}


const somaD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    // Estoque cria a promoção pela tela
    const e = await pagina(ctx, 'estoque');
    await e.pg.click('.barra .grupo[data-g="estoque"]'); await e.pg.waitForTimeout(150);
    await e.pg.click('#abaPromo');
    await e.pg.waitForSelector('#prnova');
    await e.pg.click('#prnova'); await e.pg.waitForSelector('#dlg[open] #prok');
    await e.pg.fill('#prnome', 'Semana do Linho');
    await e.pg.fill('#prq', 'a25'); await e.pg.waitForTimeout(150); await e.pg.click('[data-pradd="p1"]'); await e.pg.waitForTimeout(100);
    await e.pg.fill('[data-prp="0"]', '1349,90'); await e.pg.click('#prok'); await e.pg.waitForTimeout(200);
    ok((await e.pg.locator('#dlgf .msg.err').innerText()).includes('marque pelo menos uma cor'), '2.59: peça sem cor/tamanho marcado não salva');
    await e.pg.click('[data-prtodas="0"]'); await e.pg.waitForTimeout(100);
    ok(await e.pg.locator('[data-prv="0|v1"].on').count() === 1 && await e.pg.locator('[data-prv="0|v2"].on').count() === 0, '2.59: "Todas" marca as normais, não a peça especial');
    await e.pg.fill('[data-prp="0"]', '1900'); await e.pg.click('#prok'); await e.pg.waitForTimeout(200);
    ok((await e.pg.locator('#dlgf .msg.err').innerText()).includes('menor que o de tabela'), 'preço da promoção maior que o de tabela: barrado na tela');
    await e.pg.fill('[data-prp="0"]', '1349,90'); await e.pg.waitForTimeout(100);
    ok((await e.pg.locator('[data-prd="0"]').innerText()).startsWith('−'), 'mostra o desconto da promoção');
    await print(e.pg, 'promo_form');
    // 2.59: grade — segunda peça com 2 cores × 2 tamanhos
    await e.pg.fill('#prq', 'b10'); await e.pg.waitForTimeout(150); await e.pg.click('[data-pradd="p2"]'); await e.pg.waitForTimeout(100);
    await e.pg.click('[data-prrow="1|Cru"]'); await e.pg.waitForTimeout(80);
    ok(await e.pg.locator('#pritens [data-prv^="1|"].on').count() === 2, '2.59: clicar na cor marca a linha');
    await e.pg.click('[data-prcol="1|M"]'); await e.pg.waitForTimeout(80);
    ok(await e.pg.locator('#pritens [data-prv^="1|"].on').count() === 3 && (await e.pg.locator('[data-prcont="1"]').innerText()).startsWith('3 de 4'), '2.59: clicar no tamanho marca a coluna (contador)');
    await e.pg.click('[data-prv="1|w2"]'); await e.pg.waitForTimeout(80);
    ok(await e.pg.locator('#pritens [data-prv^="1|"].on').count() === 2, '2.59: clique no quadradinho desmarca');
    await e.pg.click('[data-prest="1"]'); await e.pg.waitForTimeout(80);
    ok(await e.pg.locator('[data-prv="1|w1"].on').count() === 1 && await e.pg.locator('[data-prv="1|w4"].on').count() === 1 && await e.pg.locator('#pritens [data-prv^="1|"].on').count() === 2, '2.59: "Só as com estoque"');
    await e.pg.fill('[data-prp="1"]', '399,90');
    await print(e.pg, 'promo_grade');
    await e.pg.click('#prok'); await e.pg.waitForTimeout(400);
    const r = await ultimaRpc(e.pg, 'lin_promocao_salvar');
    ok(r && r.p.itens.length === 3 && r.p.itens[1].variante_id === 'w1' && r.p.itens[2].variante_id === 'w4' && r.p.itens[1].preco === '399.90', '2.59: grava uma linha por cor/tamanho marcado');
    ok(r && r.p.nome === 'Semana do Linho' && r.p.loja_id === null && r.p.inicio === hoje && r.p.fim === somaD(hoje, 6) && r.p.itens[0].produto_id === 'p1' && r.p.itens[0].variante_id === null && r.p.itens[0].preco === '1349.90' && r.p.itens.length === 3,
      'grava nome, todas as lojas, 7 dias a partir de hoje e a peça com o preço');
    const t = await e.pg.locator('#tela').innerText();
    ok(t.includes('Semana do Linho') && t.includes('Valendo') && t.includes('todas as cores e tamanhos') && t.includes('Todas as lojas'), 'lista mostra a promoção valendo');
    await print(e.pg, 'promo_lista');
    ok(e.erros.length === 0, 'sem erro de JavaScript (Estoque) ' + e.erros.join(' | '));

    // vendedora: venda com promoção; duas promoções → menor preço; especial fora da peça toda
    const promos = { promos: [
      { id: 1, nome: 'Semana do Linho', loja_id: null, inicio: hoje, fim: somaD(hoje, 6), observacao: '', cancelada_em: null, criado_nome: 'x', criado_em: new Date().toISOString() },
      { id: 2, nome: 'Queima Ipanema', loja_id: 'l-ipa', inicio: hoje, fim: hoje, observacao: '', cancelada_em: null, criado_nome: 'x', criado_em: new Date().toISOString() },
      { id: 3, nome: 'Cancelada', loja_id: null, inicio: hoje, fim: hoje, observacao: '', cancelada_em: new Date().toISOString(), criado_nome: 'x', criado_em: new Date().toISOString() },
      { id: 4, nome: 'Futura', loja_id: null, inicio: somaD(hoje, 3), fim: somaD(hoje, 9), observacao: '', cancelada_em: null, criado_nome: 'x', criado_em: new Date().toISOString() }],
      pitens: [{ id: 11, promocao_id: 1, produto_id: 'p1', variante_id: null, preco: 1349.9 }, { id: 12, promocao_id: 2, produto_id: 'p1', variante_id: 'v1', preco: 1199 },
               { id: 13, promocao_id: 3, produto_id: 'p1', variante_id: null, preco: 10 }, { id: 14, promocao_id: 4, produto_id: 'p1', variante_id: null, preco: 900 }] };
    const v = await pagina(ctx, 'vendedora', promos);
    await vendas(v.pg); await v.pg.click('#vnova'); await v.pg.waitForSelector('#dlg[open] #nvok');
    await v.pg.fill('#nvpq', 'a25'); await v.pg.waitForTimeout(200);
    const busca = await v.pg.locator('#nvres').innerText();
    ok(busca.includes('Queima Ipanema') && busca.includes('1.199,00'), 'busca mostra o preço da promoção');
    await v.pg.locator('#nvres button').first().click(); await v.pg.waitForTimeout(150);
    ok(await v.pg.inputValue('[data-i="0"][data-k="vu"]') === '1199,00' && (await v.pg.locator('#nvitens').innerText()).includes('Promoção: Queima Ipanema'),
      'duas promoções valendo: entra o menor preço (a cancelada e a futura não valem)');
    ok(await v.pg.inputValue('[data-i="0"][data-k="pct"]') !== '', 'o desconto da promoção aparece no Desc. %');
    await print(v.pg, 'promo_venda');
    // especial: a peça toda não vale
    await v.pg.fill('#nvpq', 'a25'); await v.pg.waitForTimeout(200); await v.pg.locator('#nvres button').nth(1).click(); await v.pg.waitForTimeout(150);
    ok(await v.pg.inputValue('[data-i="1"][data-k="vu"]') === '2400,00' && !(await v.pg.locator('#nvitens tr').nth(2).innerText()).includes('Promoção'), 'peça especial com preço próprio fica fora da "peça toda"');
    await v.pg.click('[data-rm="1"]'); await v.pg.waitForTimeout(100);
    // data de ontem: a promoção não valia → volta ao preço cheio
    await v.pg.fill('#nvdata', somaD(hoje, -1)); await v.pg.dispatchEvent('#nvdata', 'change'); await v.pg.waitForTimeout(150);
    ok(await v.pg.inputValue('[data-i="0"][data-k="vu"]') === '1799,00' && !(await v.pg.locator('#nvitens').innerText()).includes('Promoção'), 'venda com data fora da promoção volta ao preço de tabela');
    await v.pg.fill('#nvdata', hoje); await v.pg.dispatchEvent('#nvdata', 'change'); await v.pg.waitForTimeout(150);
    ok(await v.pg.inputValue('[data-i="0"][data-k="vu"]') === '1199,00', 'voltando a data, a promoção volta');
    await v.pg.selectOption('[data-pg="0"][data-k="forma"]', 'pix'); await v.pg.waitForTimeout(100);
    await v.pg.click('#nvok'); await v.pg.waitForTimeout(500);
    const rv = await ultimaRpc(v.pg, 'lin_venda_registrar');
    ok(rv && Number(rv.p.itens[0].valor_unitario) === 1199 && Number(rv.p.pagamentos[0].valor) === 1199, 'a venda vai com o preço da promoção');
    ok(v.erros.length === 0, 'sem erro de JavaScript (vendedora) ' + v.erros.join(' | '));
    // vendedora vê a aba, sem botão de criar
    await v.pg.evaluate(() => { const d = document.getElementById('dlg2'); if (d.open) d.close(); });
    await v.pg.click('.barra .grupo[data-g="estoque"]'); await v.pg.waitForTimeout(150); await v.pg.click('#abaPromo'); await v.pg.waitForTimeout(400);
    ok((await v.pg.locator('#tela').innerText()).includes('Queima Ipanema') && await v.pg.locator('#prnova').count() === 0 && await v.pg.locator('[data-pred]').count() === 0, 'vendedora vê as promoções, sem criar nem editar');

    // 2.60: relatório das peças em promoção (PDF), também para a vendedora
    ok(await v.pg.locator('[data-prrel]').count() >= 1, '2.60: vendedora tem o botão Relatório (PDF)');
    const rels = [];
    for (const id of await v.pg.locator('[data-prrel]').evaluateAll(l => l.map(b => b.dataset.prrel))) {
      const [pop] = await Promise.all([v.pg.waitForEvent('popup'), v.pg.click(`[data-prrel="${id}"]`)]);
      await pop.waitForLoadState(); rels.push({ id, html: await pop.content(), txt: await pop.locator('body').innerText(), pop });
    }
    const rel = rels.find(r => r.txt.includes('Semana do Linho'));
    ok(rel, '2.60: relatório abre numa janela nova com o nome da promoção');
    if (rel) {
      const nomes = await rel.pop.locator('.pc .cab > div:first-child > b').allInnerTexts();
      ok(nomes.join('|') === [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')).join('|') && nomes.length >= 1, '2.60: peças em ordem alfabética ' + nomes.join(' / '));
      const tams = await rel.pop.locator('.pc').first().locator('td.tam').allInnerTexts();
      ok(tams.length > 0 && rel.txt.includes('de R$') && rel.txt.includes('%'), '2.60: tamanho por linha, preço de/por e desconto ' + tams.join(','));
      await rel.pop.pdf({ path: require('path').join(require('os').tmpdir(), 'promo_relatorio.pdf'), format: 'A4' }).catch(() => {});
      await rel.pop.screenshot({ path: require('path').join(require('os').tmpdir(), 'promo_relatorio.png'), fullPage: true });
    }
    for (const r of rels) await r.pop.close();
    // várias peças: todas as do cadastro, a peça toda (com especiais à parte) e uma variação com outro preço
    const [pop2] = await Promise.all([v.pg.waitForEvent('popup'), v.pg.evaluate(() => {
      const its = PRODUTOS.map(p => ({ produto_id: p.id, variante_id: null, preco: Number(p.preco_venda) * 0.8 }));
      const esp = PRODUTOS.flatMap(p => (p.variantes || []).filter(x => (x.edicao || '').trim()).map(x => ({ produto_id: p.id, variante_id: x.id, preco: 100 })));
      relatorioPromocao({ id: 99, nome: 'Teste várias', loja_id: null, inicio: hoje(), fim: hoje(), itens: its.concat(esp) }); })]);
    await pop2.waitForLoadState();
    const nomes2 = await pop2.locator('.pc .cab > div:first-child > b').allInnerTexts();
    const ordenado = [...nomes2].sort((a, b) => a.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().localeCompare(b.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), 'pt-BR'));
    ok(nomes2.length >= 2 && nomes2.join('|') === ordenado.join('|'), '2.60: várias peças em ordem alfabética ' + nomes2.join(' / '));
    const ordemOk = await pop2.evaluate(() => [...document.querySelectorAll('.pc')].every(pc => { const O = ['PP','P','M','G','GG','G1','G2','G3'];
      const t = [...pc.querySelectorAll('tr:not(.e) td.tam')].filter(td => !td.nextElementSibling.textContent.startsWith('★')).map(td => O.indexOf(td.textContent)); return t.every((x, i) => i === 0 || x >= t[i - 1]); }));
    ok(ordemOk, '2.60: tamanhos na ordem PP, P, M, G…');
    ok((await pop2.locator('body').innerText()).includes('peça especial'), '2.60: peça especial aparece à parte, com a edição');
    if (SAIDA) await pop2.screenshot({ path: path.join(SAIDA, 'promo_relatorio_varias.png'), fullPage: true });
    await pop2.screenshot({ path: require('path').join(require('os').tmpdir(), 'promo_relatorio2.png'), fullPage: true });
    await pop2.close();

    // 2.58: indicação no Estoque (e filtro) e em Produtos
    const est = await pagina(ctx, 'estoque', promos);
    await est.pg.waitForSelector('#lista .prod');
    const cart = await est.pg.locator('#lista .prod').first().innerText();
    ok(cart.includes('Semana do Linho') && cart.includes('Queima Ipanema') && cart.includes('Futura') && !cart.includes('Cancelada'),
      '2.58: cartão do Estoque mostra as promoções valendo e as próximas (não a cancelada)');
    ok((await est.pg.locator('#lista .tagpromo.futura').count()) === 1 && (await est.pg.locator('#lista .tagpromo').first().getAttribute('title')).includes('por R$'), '2.58: a futura aparece diferente; o aviso explica a promoção');
    await print(est.pg, 'promo_estoque');
    await est.pg.click('#fpromo'); await est.pg.waitForTimeout(150);
    ok(await est.pg.locator('#lista .prod').count() === 1, '2.58: filtro "Em promoção"');
    await est.pg.click('.barra .grupo[data-g="estoque"]'); await est.pg.waitForTimeout(150); await est.pg.click('#abaProdutos'); await est.pg.waitForTimeout(600);
    ok((await est.pg.locator('#plista').innerText()).includes('Queima Ipanema'), '2.58: lista de Produtos mostra a promoção');
    ok(est.erros.length === 0, 'sem erro de JavaScript (Estoque/Produtos) ' + est.erros.join(' | '));

    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'estoque', promos);
    await m.pg.click('.barra .grupo[data-g="estoque"]'); await m.pg.waitForTimeout(150); await m.pg.click('#abaPromo'); await m.pg.waitForSelector('#prnova');
    await m.pg.click('[data-pred="1"]'); await m.pg.waitForSelector('#dlg[open] #prok');
    ok(await m.pg.locator('[data-prv="0|v1"].on').count() === 1, '2.59: ao editar, a peça inteira aparece com as cores/tamanhos normais marcados');
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: formulário sem rolagem lateral');
    await print(m.pg, 'promo_celular');
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
