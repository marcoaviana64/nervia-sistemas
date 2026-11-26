// Teste de tela das REGRAS DE COMISSÃO do Sistema Linum (versão 2.61) com o Playwright do Node e um Supabase IMITADO
// no navegador. Dados FICTÍCIOS. As regras do banco (recálculo, sobreposição, permissões) estão nos testes SQL ("linum 2.61").
// Uso: node testes/linum/tela_comissoes_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8851;
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const DADOS = { papel: 'dono', minha_loja: null, comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }], produtos: [], estoque: [] };
const venda = (id, vend, nome, loja, valor, pct) => ({ id, data: hoje, loja_id: loja, vendedora_id: vend, vendedora_nome: nome, valor_total: valor,
  credito_usado: 0, comissao_pct: pct, comissao_valor: Math.round(valor * pct) / 100, cancelada_em: null });

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [], seq: 10,
    vendas: [${JSON.stringify(venda(1, 'u-rachel', 'Rachel', 'l-ipa', 1000, 0))}, ${JSON.stringify(venda(2, 'u-rachel', 'Rachel', 'l-gav', 500, 0))}],
    regras: [], pessoas: [{ user_id: 'u-meire', nome: 'Meire', papel: 'vendedora' }, { user_id: 'u-rachel', nome: 'Rachel', papel: 'vendedora' }] };
  S.D.papel = '__PAPEL__';
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const tabela = t => ({ lin_vendas: S.vendas }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q, not: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; }, is: (c, v) => { f.push(x => (x[c] ?? null) === v); return q; },
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; }, lt: (c, v) => { f.push(x => x[c] < v); return q; },
      or: () => q, maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const vale = (r, v) => r.user_id === v.vendedora_id && r.lojas.includes(v.loja_id) && v.data >= r.inicio && (!r.fim || v.data <= r.fim);
  const recalc = () => { let n = 0; S.vendas.forEach(v => { const r = S.regras.find(r => vale(r, v)); const pct = r ? r.pct : 0;
    if (pct !== v.comissao_pct) { v.comissao_pct = pct; v.comissao_valor = Math.round(v.valor_total * pct) / 100; n++; } }); return n; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }), lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]), lin_vendas_sem_cliente: () => ok([]), lin_creditos_saldos: () => ok({}),
    lin_comissoes_ler: () => ok(JSON.parse(JSON.stringify({ regras: S.regras.map(r => Object.assign({ nome: S.pessoas.find(p => p.user_id === r.user_id).nome }, r)), pessoas: S.pessoas }))),
    lin_comissao_salvar: ({ p }) => {
      const conf = S.regras.find(r => r.id !== p.id && r.user_id === p.user_id && r.lojas.some(l => p.lojas.includes(l)) && r.inicio <= (p.fim || '9999') && p.inicio <= (r.fim || '9999'));
      if (conf) return erro('Já existe regra para esta pessoa em Ipanema de ' + conf.inicio + ' sem fim: ajuste o período ou as lojas');
      if (p.id) Object.assign(S.regras.find(r => r.id === p.id), { pct: p.pct, lojas: p.lojas, inicio: p.inicio, fim: p.fim, observacao: p.observacao });
      else S.regras.push({ id: S.seq++, user_id: p.user_id, pct: p.pct, lojas: p.lojas, inicio: p.inicio, fim: p.fim, observacao: p.observacao });
      return ok({ id: 1, recalculadas: recalc() }); },
    lin_comissao_excluir: ({ p_id }) => { S.regras = S.regras.filter(r => r.id !== p_id); return ok({ recalculadas: recalc() }); },
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
const ultimaRpc = (pg, fn) => pg.evaluate(fn => { const l = window.__S.rpc.filter(x => x[0] === fn); return l.length ? l[l.length - 1][1] : null; }, fn);

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); const erros = [];
    pg.on('pageerror', e => erros.push(String(e.stack || e).slice(0, 300)));
    pg.on('dialog', d => d.accept(d.type() === 'prompt' ? 'cadastrada errado' : undefined));
    await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('__PAPEL__', 'dono'), contentType: 'text/javascript' }));
    await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/?aba=estoque`); await pg.waitForSelector('#app:not(.oculto)');
    await pg.click('.barra .grupo[data-g="gestao"]'); await pg.waitForTimeout(150); await pg.click('#abaComissoes'); await pg.waitForSelector('#cmnova');
    ok((await pg.locator('#cmregras').innerText()).includes('Nenhuma regra cadastrada') && (await pg.locator('#cmregras').innerText()).includes('Sem comissão hoje: Meire, Rachel'),
      'sem regra: ninguém tem comissão, e a tela diz quem está sem');
    // nova regra: Rachel 1,5% só em Ipanema, desde o 1º do mês, sem fim
    await pg.click('#cmnova'); await pg.waitForSelector('#dlg[open] #cmrok');
    await pg.click('#cmrok'); ok((await pg.locator('#cmrerr').innerText()).includes('Escolha a pessoa'), 'formulário pede a pessoa');
    await pg.selectOption('#cmrp', 'u-rachel'); await pg.fill('#cmrpct', '0');
    await pg.click('#cmrok'); ok((await pg.locator('#cmrerr').innerText()).includes('maior que zero'), '0% recusado: sem comissão = sem regra');
    await pg.fill('#cmrpct', '1,5'); await pg.uncheck('#cmrlojas input[value="l-gav"]'); await pg.uncheck('#cmrlojas input[value="l-ipa"]');
    await pg.click('#cmrok'); ok((await pg.locator('#cmrerr').innerText()).includes('pelo menos uma loja'), 'precisa de pelo menos uma loja');
    await pg.check('#cmrlojas input[value="l-ipa"]'); await pg.fill('#cmrini', hoje.slice(0, 8) + '01');
    await pg.fill('#cmrfim', hoje.slice(0, 8) + '01'); await pg.fill('#cmrini', hoje); 
    if (hoje.slice(8) !== '01') { await pg.click('#cmrok'); ok((await pg.locator('#cmrerr').innerText()).includes('antes do início'), 'fim antes do início recusado'); }
    else ok(true, 'fim antes do início (pulado no dia 1º)');
    await pg.fill('#cmrini', hoje.slice(0, 8) + '01'); await pg.fill('#cmrfim', ''); await pg.fill('#cmrobs', 'só Ipanema');
    await pg.click('#cmrok'); await pg.waitForTimeout(400);
    const r = await ultimaRpc(pg, 'lin_comissao_salvar');
    ok(r && r.p.user_id === 'u-rachel' && r.p.pct === 1.5 && JSON.stringify(r.p.lojas) === '["l-ipa"]' && r.p.inicio === hoje.slice(0, 8) + '01' && r.p.fim === null,
      'grava pessoa, 1,5%, só Ipanema, início e sem fim');
    ok((await pg.locator('#msg').innerText()).includes('1 venda(s) recalculada(s)'), 'avisa quantas vendas foram recalculadas');
    const t = await pg.locator('#cmrtab').innerText();
    ok(t.includes('Rachel') && t.includes('1,5%') && t.includes('Ipanema') && t.includes('sem fim') && t.includes('valendo') && !t.includes('Gávea'), 'regra aparece na lista: %, loja, período, situação');
    ok((await pg.locator('#cmtab').innerText()).includes('15,00'), 'a comissão recalculada aparece no relatório do mês (1,5% de R$ 1.000)');
    // segunda regra da Rachel na Gávea com outro %: lojas diferentes, pode
    await pg.click('#cmnova'); await pg.selectOption('#cmrp', 'u-rachel'); await pg.fill('#cmrpct', '1');
    await pg.click('#cmrok'); await pg.waitForTimeout(300);
    ok((await pg.locator('#cmrerr').innerText()).includes('Já existe regra'), 'regra que se sobrepõe na mesma loja: mostra o erro do servidor');
    await pg.uncheck('#cmrlojas input[value="l-ipa"]'); await pg.click('#cmrok'); await pg.waitForTimeout(400);
    ok((await pg.locator('#cmrtab tbody tr').count()) === 2 && (await pg.locator('#cmrtab').innerText()).includes('Gávea'), 'a mesma pessoa com % diferente em cada loja');
    if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, 'comissoes_regras.png'), fullPage: true });
    // editar: período com fim
    await pg.locator('[data-cmed]').first().click(); await pg.waitForSelector('#dlg[open] #cmrok');
    ok(await pg.locator('#cmrp').isDisabled(), 'ao editar, a pessoa não muda');
    await pg.fill('#cmrfim', '2099-12-31'); await pg.click('#cmrok'); await pg.waitForTimeout(400);
    ok((await pg.locator('#cmrtab').innerText()).includes('31/12/2099'), 'regra com período (início e fim)');
    // excluir
    const antes = await pg.locator('#cmrtab tbody tr').count();
    await pg.locator('[data-cmex]').first().click(); await pg.waitForTimeout(400);
    const ex = await ultimaRpc(pg, 'lin_comissao_excluir');
    ok(ex && ex.p_motivo === 'cadastrada errado' && (await pg.locator('#cmrtab tbody tr').count()) === antes - 1, 'excluir pede o motivo e tira a regra');
    // equipe sem o campo antigo
    ok(await pg.locator('.eq-comissao').count() === 0, 'a aba Equipe não tem mais o % de comissão');
    // celular
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.click('#cmnova'); await pg.waitForSelector('#dlg[open] #cmrok');
    ok(await pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: formulário sem rolagem lateral');
    if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, 'comissoes_celular.png'), fullPage: true });
    ok(erros.length === 0, 'sem erro de JavaScript ' + erros.join(' | '));
    // vendedora: sem a aba Comissões
    const v = await ctx.newPage();
    await v.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('__PAPEL__', 'vendedora'), contentType: 'text/javascript' }));
    await v.goto(`http://127.0.0.1:${PORTA}/apps/linum/?aba=estoque`); await v.waitForSelector('#app:not(.oculto)');
    ok(await v.locator('#abaComissoes.oculto').count() === 1, 'vendedora não vê a aba Comissões');
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
