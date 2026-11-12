// Teste de tela do "Colocar / Trocar cliente" da venda do Sistema Linum (versão 2.50) com o Playwright do Node e um
// Supabase IMITADO no navegador. Dados FICTÍCIOS. As regras do banco estão nos testes SQL (testes/teste_sql.sql, "linum 2.50").
// Confere: quadro "Vendas sem cliente" na aba Vendas (vendedora: as próprias; Estoque: todas, sem ler as vendas);
// "Colocar cliente" busca só com 2 letras, cadastra cliente nova; "Trocar cliente" na boleta exige motivo; Dono; celular.
// Uso: node testes/linum/tela_venda_cliente_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8838;
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const DADOS = {
  papel: 'vendedora', minha_loja: 'l-gav', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', categoria: 'Vestido', preco_venda: 489,
    variantes: [{ id: 'v1', cor: 'Azul', tamanho: 'P', edicao: '' }] }],
  estoque: [['v1', 'l-gav', 5]],
};
const venda = (id, vend, cli) => ({ id, data: hoje, loja_id: 'l-gav', vendedora_id: vend, vendedora_nome: vend === 'u-vendedora' ? 'Vera Vendedora' : 'Bia Outra',
  cliente_id: cli, valor_bruto: 489, valor_itens: 489, desconto: 0, valor_total: 489, credito_usado: 0, valor_nf: 489, comissao_pct: 0, comissao_valor: 0,
  pagamentos: [{ forma: 'pix', valor: 489 }], observacao: '', criado_nome: 'Vera', criado_em: new Date().toISOString(), cancelada_em: null });

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [],
    vendas: [${JSON.stringify(venda(5, 'u-vendedora', null))}, ${JSON.stringify(venda(6, 'u-outra', null))}, ${JSON.stringify(venda(7, 'u-vendedora', 'c1'))}],
    itens: [5, 6, 7].map(v => ({ id: v * 10, venda_id: v, variante_id: 'v1', quantidade: 1, referencia: 'VES-MAR', descricao: 'Vestido Mar', cor: 'Azul', tamanho: 'P', edicao: '',
      preco_tabela: 489, desconto_pct: 0, valor_unitario: 489, valor_total: 489 })),
    cli: [{ id: 'c1', nome: 'Maria Souza', telefone: '21999990000' }, { id: 'c2', nome: 'Joana Lima', telefone: '21988887777' }] };
  S.D.papel = '__PAPEL__';
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const pode = v => S.D.papel === 'dono' || v.vendedora_id === eu;   // RLS de lin_vendas
  const tabela = t => ({ lin_clientes: S.cli, lin_vendas: S.vendas.filter(pode), lin_venda_itens: S.itens.filter(i => pode(S.vendas.find(v => v.id === i.venda_id))) }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; },
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; },
      or: () => q, maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]),
    lin_vendedoras: () => ok([{ user_id: 'u-vendedora', nome: 'Vera Vendedora' }, { user_id: 'u-outra', nome: 'Bia Outra' }]),
    lin_cliente_salvar: ({ p }) => { const id = 'c' + (S.cli.length + 1); S.cli.push({ id, nome: p.nome, telefone: String(p.telefone || '').replace(/\\D/g, '') }); return ok(id); },
    lin_vendas_sem_cliente: () => ok(S.vendas.filter(v => !v.cliente_id && (S.D.papel !== 'vendedora' || v.vendedora_id === eu))
      .map(v => ({ id: v.id, data: v.data, loja_id: v.loja_id, vendedora_id: v.vendedora_id, vendedora_nome: v.vendedora_nome, pecas: 'VES-MAR Vestido Mar Azul P' }))),
    lin_venda_cliente: ({ p_venda, p_cliente, p_motivo }) => { const v = S.vendas.find(x => x.id === p_venda);
      if (!(S.D.papel !== 'vendedora' || v.vendedora_id === eu)) return erro('Somente o Dono, o Estoque ou quem fez a venda coloca a cliente');
      if (v.cliente_id && String(p_motivo || '').trim().length < 5) return erro('A venda já tem cliente: escreva o motivo da troca');
      v.cliente_id = p_cliente; return ok(null); },
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

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    // vendedora: quadro com a própria venda sem cliente
    const { pg, erros } = await pagina(ctx, 'vendedora');
    await vendas(pg);
    const q = await pg.locator('#vsemcli').innerText();
    ok(q.includes('Nº 5') && !q.includes('Nº 6'), 'vendedora: quadro "Vendas sem cliente" só com as próprias');
    await print(pg, 'vcli_quadro');
    await pg.click('[data-semcli="5"]'); await pg.waitForSelector('#dlg[open] #vcsalvar');
    ok(await pg.locator('#vcsalvar').isDisabled() && (await pg.locator('#vcres').innerText()).trim() === '', 'sem cliente escolhida: salvar desligado e lista fechada');
    await pg.fill('#vcq', 'jo'); await pg.waitForTimeout(100);
    ok((await pg.locator('#vcres').innerText()).includes('Joana Lima') && (await pg.locator('#vcres').innerText()).includes('+ Cadastrar cliente'), 'com 2 letras, aparece a cliente e o "+ Cadastrar cliente"');
    await pg.fill('#vcq', 'Bia Nova 21977776666'); await pg.waitForTimeout(100);
    await pg.click('#vcnovo'); await pg.waitForSelector('#dlg2[open] #clok');
    await pg.click('#clok'); await pg.waitForTimeout(400);
    ok((await pg.locator('#dlgf').innerText()).includes('Bia Nova') && !(await pg.locator('#vcsalvar').isDisabled()), 'cliente nova cadastrada já fica escolhida');
    await print(pg, 'vcli_colocar');
    await pg.click('#vcsalvar'); await pg.waitForTimeout(500);
    const r1 = await ultimaRpc(pg, 'lin_venda_cliente');
    ok(r1 && r1.p_venda === 5 && r1.p_cliente === 'c3', 'manda a venda e a cliente nova');
    ok(await pg.locator('#vsemcli').count() === 0 && (await pg.locator('.vrow[data-v="5"]').innerText()).includes('Bia Nova'), 'a venda sai do quadro e mostra a cliente na lista');
    // trocar a cliente pela boleta (exige motivo)
    await pg.click('.vrow[data-v="7"]'); await pg.waitForSelector('#dlg[open] #vcli');
    ok((await pg.locator('#vcli').innerText()) === 'Trocar cliente', 'boleta com cliente: botão "Trocar cliente"');
    await pg.click('#vcli'); await pg.waitForSelector('#dlg[open] #vcmot');
    ok((await pg.locator('#dlgf').innerText()).includes('Cliente de agora: Maria Souza'), 'mostra a cliente de agora');
    await pg.fill('#vcq', 'joana'); await pg.waitForTimeout(100); await pg.click('[data-vcc="c2"]'); await pg.waitForTimeout(100);
    await pg.click('#vcsalvar'); await pg.waitForTimeout(300);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('motivo'), 'troca sem motivo: recusada com a mensagem');
    await pg.fill('#vcmot', 'era a irmã dela'); await pg.click('#vcsalvar'); await pg.waitForTimeout(500);
    const r2 = await ultimaRpc(pg, 'lin_venda_cliente');
    ok(r2 && r2.p_venda === 7 && r2.p_cliente === 'c2' && r2.p_motivo === 'era a irmã dela', 'troca com motivo');
    ok(erros.length === 0, 'sem erro de JavaScript (vendedora) ' + erros.join(' | '));

    // Estoque: vê a venda sem cliente da outra vendedora (não lê as vendas) e coloca a cliente
    const e = await pagina(ctx, 'estoque');
    await vendas(e.pg);
    const qe = await e.pg.locator('#vsemcli').innerText();
    ok(qe.includes('Nº 6') && qe.includes('Bia Outra') && await e.pg.locator('.vrow[data-v="6"]').count() === 0, 'Estoque: vê a venda sem cliente da outra vendedora pelo quadro');
    await e.pg.click('[data-semcli="6"]'); await e.pg.waitForSelector('#dlg[open] #vcq');
    ok(await e.pg.locator('#vcmot').count() === 0, 'venda sem cliente: sem campo de motivo');
    await e.pg.fill('#vcq', 'maria'); await e.pg.waitForTimeout(100); await e.pg.click('[data-vcc="c1"]'); await e.pg.waitForTimeout(100);
    await e.pg.click('#vcsalvar'); await e.pg.waitForTimeout(500);
    const r3 = await ultimaRpc(e.pg, 'lin_venda_cliente');
    ok(r3 && r3.p_venda === 6 && r3.p_cliente === 'c1' && await e.pg.locator('[data-semcli="6"]').count() === 0, 'Estoque coloca a cliente; a venda sai do quadro');
    ok(e.erros.length === 0, 'sem erro de JavaScript (Estoque) ' + e.erros.join(' | '));

    // Dono: botão na boleta de venda de outra pessoa
    const d = await pagina(ctx, 'dono');
    await vendas(d.pg);
    await d.pg.click('.vrow[data-v="6"]'); await d.pg.waitForSelector('#dlg[open] #vcli');
    ok(true, 'Dono: botão de cliente na boleta de qualquer venda');
    ok(d.erros.length === 0, 'sem erro de JavaScript (Dono) ' + d.erros.join(' | '));

    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'vendedora');
    await vendas(m.pg); await m.pg.click('[data-semcli="5"]'); await m.pg.waitForSelector('#dlg[open] #vcq');
    await m.pg.fill('#vcq', 'jo'); await m.pg.waitForTimeout(100);
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: sem rolagem lateral');
    await print(m.pg, 'vcli_celular');
    ok(m.erros.length === 0, 'sem erro de JavaScript (celular) ' + m.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
