// Teste de tela do CV do comprovante na venda do Sistema Linum (versão 2.54) com o Playwright do Node e um Supabase
// IMITADO no navegador. Dados FICTÍCIOS. As regras do banco estão nos testes SQL (testes/teste_sql.sql, "linum 2.54").
// Confere: campo CV só nos pagamentos no cartão; venda no cartão sem CV recusada na tela (vendedora); CV vai no pagamento;
// boleta com "CV …" / "sem CV"; quadro "Vendas no cartão sem comprovante"; "Informar comprovante" manda a lista na ordem
// dos pagamentos; boleta antiga do Dono pode ficar sem CV; impressão com o CV; celular.
// Uso: node testes/linum/tela_venda_cv_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8840;
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const ontem = (() => { const x = new Date(hoje + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); })();

const DADOS = {
  papel: 'vendedora', minha_loja: 'l-ipa', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'A25', descricao: 'Vestido Artesanal', categoria: 'Vestido', preco_venda: 1799,
    variantes: [{ id: 'v1', cor: 'Natural', tamanho: 'G', edicao: '' }] }],
  estoque: [['v1', 'l-ipa', 5]],
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
    cli: [] };
  S.D.papel = '__PAPEL__';
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const pode = v => S.D.papel === 'dono' || v.vendedora_id === eu;
  const tabela = t => ({ lin_clientes: S.cli, lin_vendas: S.vendas.filter(pode), lin_venda_itens: S.itens.filter(i => pode(S.vendas.find(v => v.id === i.venda_id))) }[t] || []);
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
async function pagina(ctx, papel) {
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push(String(e.stack || e).slice(0, 300)));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('__PAPEL__', papel), contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
async function vendas(pg) {
  await pg.click('.barra .grupo[data-g="vendas"]'); await pg.waitForTimeout(150);
  await pg.click('#abaVendas'); await pg.waitForSelector('#vnova'); await pg.waitForTimeout(200);
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const ultimaRpc = (pg, fn) => pg.evaluate(fn => { const l = window.__S.rpc.filter(x => x[0] === fn); return l.length ? l[l.length - 1][1] : null; }, fn);
async function vendas(pg) {
  await pg.click('.barra .grupo[data-g="vendas"]'); await pg.waitForTimeout(150);
  await pg.click('#abaVendas'); await pg.waitForSelector('#vnova'); await pg.waitForTimeout(200);
}
async function nova(pg) {
  await pg.click('#vnova'); await pg.waitForSelector('#dlg[open] #nvok');
  await pg.fill('#nvpq', 'a25'); await pg.waitForTimeout(200); await pg.locator('#nvres button').first().click(); await pg.waitForTimeout(150);
}

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const { pg, erros } = await pagina(ctx, 'vendedora');
    await vendas(pg);
    const q = await pg.locator('#vsemcv').innerText();
    ok(q.includes('Nº 5') && !q.includes('Nº 6'), 'quadro "Vendas no cartão sem comprovante" só com a venda sem CV');
    await print(pg, 'cv_quadro');
    // nova venda: o padrão é crédito → campo CV aparece; Pix tira o campo
    await nova(pg);
    ok(await pg.locator('.nvcv').count() === 1 && (await pg.locator('#nvcvdica').innerText()).includes('CV:'), 'pagamento no crédito mostra o campo CV e a dica');
    await pg.click('#nvok'); await pg.waitForTimeout(300);
    ok((await pg.locator('#nverr').innerText()).includes('CV do comprovante') && !(await ultimaRpc(pg, 'lin_venda_registrar')), 'sem o CV a venda não vai');
    await pg.fill('.nvcv', '18943-5334'); await print(pg, 'cv_nova');
    await pg.click('#nvok'); await pg.waitForTimeout(500);
    const r1 = await ultimaRpc(pg, 'lin_venda_registrar');
    ok(r1 && r1.p.pagamentos.length === 1 && r1.p.pagamentos[0].forma === 'credito' && r1.p.pagamentos[0].cv === '189435334', 'CV vai no pagamento (só números)');
    await nova(pg);
    await pg.selectOption('[data-pg="0"][data-k="forma"]', 'pix'); await pg.waitForTimeout(100);
    ok(await pg.locator('.nvcv').count() === 0, 'Pix não pede CV');
    await pg.click('#nvok'); await pg.waitForTimeout(500);
    ok(!(await ultimaRpc(pg, 'lin_venda_registrar')).p.pagamentos[0].cv, 'venda no Pix vai sem CV');
    // boleta: sem CV + Informar comprovante
    await vendas(pg);
    await pg.click('[data-semcv="5"]'); await pg.waitForSelector('#dlg[open] #vcvsalvar');
    ok(await pg.locator('#vcvbox').isVisible() && (await pg.locator('#dlgf').innerText()).includes('sem CV') && await pg.locator('#vcvmot').count() === 0,
      '"Informar comprovante" abre a boleta já no campo do CV (sem motivo: ainda não havia CV)');
    await pg.fill('#vcv1', '000555666777'); await pg.click('#vcvsalvar'); await pg.waitForTimeout(500);
    const r2 = await ultimaRpc(pg, 'lin_venda_comprovante');
    ok(r2 && r2.p_venda === 5 && JSON.stringify(r2.p_cvs) === '["","000555666777"]' && r2.p_motivo === '', 'manda os CVs na ordem dos pagamentos (Pix vazio)');
    ok(await pg.locator('#vsemcv').count() === 0, 'a venda sai do quadro');
    await pg.click('.vrow[data-v="6"]'); await pg.waitForSelector('#dlg[open] #vcv');
    ok((await pg.locator('#dlgf').innerText()).includes('CV 189435334') && (await pg.locator('#vcv').innerText()) === 'Corrigir comprovante', 'boleta com CV: mostra o número e "Corrigir comprovante"');
    await pg.click('#vcv'); ok(await pg.locator('#vcvmot').isVisible(), 'corrigir pede o motivo');
    const [pop] = await Promise.all([pg.waitForEvent('popup'), pg.click('#vimp')]);
    await pop.waitForLoadState(); ok((await pop.content()).includes('CV 189435334'), 'ficha impressa com o CV'); await pop.close();
    ok(erros.length === 0, 'sem erro de JavaScript (vendedora) ' + erros.join(' | '));

    // Dono: boleta antiga (data de ontem) pode ir sem CV
    const d = await pagina(ctx, 'dono');
    await vendas(d.pg); await nova(d.pg);
    await d.pg.fill('#nvdata', ontem); await d.pg.dispatchEvent('#nvdata', 'change');
    await d.pg.click('#nvok'); await d.pg.waitForTimeout(500);
    const r3 = await ultimaRpc(d.pg, 'lin_venda_registrar');
    ok(r3 && r3.p.data === ontem && r3.p.pagamentos[0].cv === '', 'Dono lança boleta antiga sem CV');
    ok(d.erros.length === 0, 'sem erro de JavaScript (Dono) ' + d.erros.join(' | '));

    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'vendedora');
    await vendas(m.pg); await nova(m.pg);
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: venda com CV sem rolagem lateral');
    await print(m.pg, 'cv_celular');
    ok(m.erros.length === 0, 'sem erro de JavaScript (celular) ' + m.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
