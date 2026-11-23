// Teste de tela do FLUXO DA LOJA do Sistema Linum (versão 2.53) com o Playwright do Node e um Supabase IMITADO no navegador.
// Dados FICTÍCIOS. As regras do banco estão nos testes SQL (testes/teste_sql.sql, "linum 2.53").
// Confere: aba Fluxo da loja (vazia, KPIs, como chegaram, para retornar), registro sem contato (como chegou, gostou,
// vai voltar), visita vazia recusada, com contato (exige autorização, cria possível cliente ou usa a do telefone),
// botão "+ Fluxo / visita" na aba Vendas, cada um vê as próprias e o Dono todas, CSV só do Dono, celular.
// Uso: node testes/linum/tela_fluxo_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8839;
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const mais3 = (() => { const x = new Date(hoje + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 3); return x.toISOString().slice(0, 10); })();

const DADOS = {
  papel: 'vendedora', minha_loja: 'l-gav', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'CAM-CAT', descricao: 'Camisa Catela', categoria: 'Camisa', preco_venda: 389,
    variantes: [{ id: 'v1', cor: 'Natural', tamanho: 'G', edicao: '' }] }],
  estoque: [['v1', 'l-gav', 5]],
};
const visOutra = { id: 1, em: new Date().toISOString(), data: hoje, loja_id: 'l-ipa', por: 'u-outra', por_nome: 'Bia Outra', pessoas: 2, motivos: ['preco'], motivo_outro: '',
  faltou: '', pecas: [], observacao: 'Achou caro', como_chegou: 'instagram', como_outro: '', gostou: 'gostou', volta: 'nao', volta_quando: '', cliente_id: null };

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [], vis: [${JSON.stringify(visOutra)}],
    vendas: [{ id: 9, data: '${hoje}', loja_id: 'l-gav', vendedora_id: 'u-vendedora', cliente_id: null, valor_total: 389, pagamentos: [], cancelada_em: null }],
    cli: [{ id: 'c1', nome: 'Maria Souza', telefone: '21999990000', situacao: 'cliente', proximo_contato: null }] };
  S.D.papel = '__PAPEL__';
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const dono = () => S.D.papel === 'dono';
  const tabela = t => ({ lin_clientes: S.cli, lin_vendas: S.vendas.filter(v => dono() || v.vendedora_id === eu), lin_visitas: S.vis.filter(v => dono() || v.por === eu) }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; },
      is: (c, v) => { f.push(x => (x[c] ?? null) === v); return q; }, not: () => q,
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; }, lt: () => q,
      or: () => q, maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]), lin_vendas_sem_cliente: () => ok([]), lin_creditos_saldos: () => ok({}),
    lin_vendedoras: () => ok([{ user_id: 'u-vendedora', nome: 'Vera Vendedora' }]),
    lin_cliente_salvar: ({ p }) => { const id = 'c' + (S.cli.length + 1); S.cli.push({ id, nome: p.nome, telefone: p.telefone, situacao: p.situacao, proximo_contato: null }); return ok(id); },
    lin_visita_registrar: ({ p }) => {
      if (!p.observacao && !(p.pecas || []).length && !(p.motivos || []).length && !p.como_chegou && !p.gostou && !p.volta) return erro('Escreva o que aconteceu ou marque alguma informação da visita');
      const id = S.vis.length + 1;
      S.vis.unshift(Object.assign({ id, em: new Date().toISOString(), data: '${hoje}', por: eu, por_nome: 'Eu', motivo_outro: '', faltou: '' }, p,
        { pessoas: Number(p.pessoas), cliente_id: p.cliente_id || null, pecas: (p.pecas || []).map(v => ({ variante_id: v, referencia: 'CAM-CAT', descricao: 'Camisa Catela', cor: 'Natural', tamanho: 'G', edicao: '' })) }));
      if (p.cliente_id && p.proximo_contato) S.cli.find(c => c.id === p.cliente_id).proximo_contato = p.proximo_contato;
      return ok(id); },
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
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/?aba=estoque`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
async function vendas(pg) {
  await pg.click('.barra .grupo[data-g="vendas"]'); await pg.waitForTimeout(150);
  await pg.click('#abaVendas'); await pg.waitForSelector('#vnova'); await pg.waitForTimeout(200);
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const ultimaRpc = (pg, fn) => pg.evaluate(fn => { const l = window.__S.rpc.filter(x => x[0] === fn); return l.length ? l[l.length - 1][1] : null; }, fn);
const conta = (pg, fn) => pg.evaluate(fn => window.__S.rpc.filter(x => x[0] === fn).length, fn);
async function fluxo(pg) {
  await pg.click('.barra .grupo[data-g="vendas"]'); await pg.waitForTimeout(150);
  await pg.click('#abaFluxo'); await pg.waitForSelector('#fxnovo'); await pg.waitForTimeout(200);
}
const salvar = async pg => { await pg.click('#visok'); await pg.waitForTimeout(500); };

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const { pg, erros } = await pagina(ctx, 'vendedora');
    ok(await pg.locator('#abaFluxo').count() === 1, 'aba Fluxo da loja no grupo Vendas');
    await fluxo(pg);
    ok((await pg.locator('#tela').innerText()).includes('Nenhuma visita registrada') && !(await pg.locator('#tela').innerText()).includes('Achou caro'), 'vendedora: não vê a visita de outra pessoa');
    ok(await pg.locator('#fxcsv').count() === 0, 'vendedora: sem CSV');

    // visita vazia
    await pg.click('#fxnovo'); await pg.waitForSelector('#dlg[open] #visobs');
    await salvar(pg);
    ok((await pg.locator('#viserr').innerText()).includes('Escreva o que aconteceu'), 'visita vazia: recusada com a mensagem');
    // sem contato: 3 amigas do panfleto
    await pg.fill('#visobs', 'Recebemos 3 amigas do panfleto, gostaram muito');
    await pg.fill('#vispes', '3');
    await pg.click('[data-como="panfleto"]'); await pg.click('[data-gost="muito"]');
    ok(await pg.locator('#visquando').isHidden(), '"quando volta" escondido até marcar sim/talvez');
    await pg.click('[data-volta="talvez"]');
    await pg.fill('#visquando', 'semana que vem');
    await print(pg, 'fluxo_form');
    await salvar(pg);
    const r1 = await ultimaRpc(pg, 'lin_visita_registrar');
    ok(r1 && r1.p.como_chegou === 'panfleto' && r1.p.gostou === 'muito' && r1.p.volta === 'talvez' && r1.p.volta_quando === 'semana que vem' && r1.p.pessoas === '3'
      && !r1.p.cliente_id && r1.p.observacao.includes('panfleto') && r1.p.loja_id === 'l-gav', 'sem contato: manda anotação, como chegou, gostou, volta e a loja da vendedora');
    ok(!await pg.locator('#dlg').evaluate(d => d.open), 'janela fecha depois de registrar');
    ok((await pg.locator('#fxcomo').innerText()).includes('Panfleto') && (await pg.locator('.kpi').first().innerText()).includes('3'), 'painel: 3 pessoas, como chegaram = Panfleto');

    // com contato nova: exige autorização
    await pg.click('#fxnovo'); await pg.waitForSelector('#dlg[open] #visobs');
    await pg.fill('#visobs', 'Gostou da Camisa Catela, ficou grande; viaja amanhã');
    await pg.click('[data-como="vitrine"]');
    await pg.fill('#vispq', 'catela'); await pg.waitForTimeout(100); await pg.click('[data-vadd="0"]');
    await pg.click('[data-mot="tamanho"]'); await pg.click('[data-volta="sim"]'); await pg.fill('#visquando', 'depois da viagem');
    await pg.check('#viscont'); await pg.fill('#visnome', 'Ana Visitante'); await pg.fill('#vistel', '(21) 98888-1234');
    ok(await pg.inputValue('#visprox') === mais3, 'retorno sugerido para daqui a 3 dias');
    await salvar(pg);
    ok((await pg.locator('#viserr').innerText()).includes('autorizou'), 'contato sem autorização: recusado');
    ok(await conta(pg, 'lin_cliente_salvar') === 0, 'sem autorização: nada é cadastrado');
    await pg.check('#visaceite'); await salvar(pg);
    const c = await ultimaRpc(pg, 'lin_cliente_salvar'), r2 = await ultimaRpc(pg, 'lin_visita_registrar');
    ok(c && c.p.situacao === 'possivel' && c.p.telefone === '21988881234' && c.p.origem === 'Fluxo da loja – Vitrine' && c.p.interesses.includes('Camisa Catela'), 'cria a possível cliente com origem e interesse');
    ok(r2.p.cliente_id === 'c2' && r2.p.aceite === true && r2.p.proximo_contato === mais3 && r2.p.pecas[0] === 'v1' && r2.p.motivos[0] === 'tamanho', 'visita ligada à cliente, com retorno e peça');
    ok((await pg.locator('[data-fxcli="c2"]').innerText()).includes('Ana Visitante') && (await pg.locator('#fxlista').innerText()).includes('retornar'), 'lista mostra o contato e o retorno');

    // telefone que já é de uma cliente: não cadastra de novo
    await pg.click('#fxnovo'); await pg.waitForSelector('#dlg[open] #visobs');
    await pg.fill('#visobs', 'Voltou para ver cores'); await pg.click('[data-volta="nao"]');
    await pg.check('#viscont'); await pg.fill('#visnome', 'Maria'); await pg.fill('#vistel', '21 99999-0000'); await pg.check('#visaceite');
    await salvar(pg);
    ok(await conta(pg, 'lin_cliente_salvar') === 1 && (await ultimaRpc(pg, 'lin_visita_registrar')).p.cliente_id === 'c1', 'telefone já cadastrado: usa a cliente que existe');

    // para retornar
    await pg.click('[data-ffx="retornar"][data-x="true"]'); await pg.waitForTimeout(200);
    const lr = await pg.locator('#fxlista tbody tr').count();
    ok(lr === 2 && !(await pg.locator('#fxlista').innerText()).includes('Voltou para ver cores'), 'Para retornar: só quem disse sim/talvez');
    await print(pg, 'fluxo_painel');
    // aba Vendas: botão e link para o painel
    await pg.click('#abaVendas'); await pg.waitForSelector('#vvisita');
    ok((await pg.locator('#vvisita').innerText()) === '+ Fluxo / visita', 'aba Vendas: botão "+ Fluxo / visita"');
    await pg.click('#vvisita'); await pg.waitForSelector('#dlg[open] #visobs');
    await pg.fill('#visobs', 'Só olhou a vitrine por dentro'); await salvar(pg);
    ok(await pg.locator('#vnova').count() === 1, 'registro pela aba Vendas volta para a aba Vendas');
    await pg.click('#vfluxo'); await pg.waitForSelector('#fxnovo');
    ok(true, 'link "ver o painel do fluxo" abre a aba');
    ok(erros.length === 0, 'sem erro de JavaScript (vendedora) ' + erros.join(' | '));

    // Dono: vê todas e baixa o CSV
    const d = await pagina(ctx, 'dono');
    await fluxo(d.pg);
    ok((await d.pg.locator('#tela').innerText()).includes('Achou caro') && await d.pg.locator('#fxcsv').count() === 1, 'Dono: vê a visita da outra pessoa e tem CSV');
    const [dl] = await Promise.all([d.pg.waitForEvent('download'), d.pg.click('#fxcsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.includes('Como chegou') && csv.includes('Instagram'), 'CSV com o fluxo');
    ok(d.erros.length === 0, 'sem erro de JavaScript (Dono) ' + d.erros.join(' | '));

    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'vendedora');
    await fluxo(m.pg); await m.pg.click('#fxnovo'); await m.pg.waitForSelector('#dlg[open] #visobs'); await m.pg.check('#viscont');
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: formulário sem rolagem lateral');
    await print(m.pg, 'fluxo_celular');
    ok(m.erros.length === 0, 'sem erro de JavaScript (celular) ' + m.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
