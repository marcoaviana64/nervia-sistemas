// Teste de tela da Malinha e da Reserva do Sistema Linum (versão 2.46) com o Playwright do Node e um Supabase IMITADO no
// navegador. Dados FICTÍCIOS. As regras do banco estão nos testes SQL (testes/teste_sql.sql, "linum 2.46").
// Confere: aba para toda a equipe; malinha com cliente obrigatória, peças, prazo padrão (3 dias; reserva 7); ficha;
// marca "+N com cliente" no Estoque; volta parcial (voltou → estoque; comprou → Nova venda preenchida, loja travada,
// mandada pela lin_condicional_venda); "Desistiu de tudo"; mudar prazo; "Malinha / reserva" ao movimentar; celular.
// Uso: node testes/linum/tela_condicionais_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8836;

const DADOS = {
  papel: 'estoque', minha_loja: 'l-gav', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [
    { id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', categoria: 'Vestido', preco_venda: 489,
      variantes: [{ id: 'v1', cor: 'Azul', tamanho: 'P', edicao: '' }, { id: 'v2', cor: 'Azul', tamanho: 'M', edicao: '' },
                  { id: 'v3', cor: 'Azul', tamanho: 'P', edicao: 'Bordada' }] },
    { id: 'p2', referencia: 'CAL-ARE', descricao: 'Calça Areia', categoria: 'Calça', preco_venda: 359,
      variantes: [{ id: 'v5', cor: 'Cru', tamanho: '38', edicao: '' }] }],
  estoque: [['v1', 'l-gav', 5], ['v2', 'l-gav', 2], ['v5', 'l-gav', 4]],
};



const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, cd: [], it: [], bx: [], mov: [], rpc: [],
    cli: [{ id: 'c1', nome: 'Maria Souza', telefone: '21999990000' }, { id: 'c2', nome: 'Joana Lima', telefone: '21988887777' }] };
  S.D.papel = '__PAPEL__';
  const hojeS = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const tabela = t => ({ lin_clientes: S.cli, lin_movimentos: S.mov, lin_condicionais: S.cd, lin_cond_itens: S.it, lin_cond_baixas: S.bx }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; },
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; },
      or: () => q, maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const est = (v, l) => S.D.estoque.find(e => e[0] === v && e[1] === l);
  const somar = (v, l, q) => { const e = est(v, l); if (e) e[2] += q; else S.D.estoque.push([v, l, q]); };
  const vari = id => { for (const p of S.D.produtos) for (const v of p.variantes) if (v.id === id) return { p, v }; };
  const fechar = c => { if (S.it.filter(i => i.condicional_id === c.id).every(i => i.compradas + i.devolvidas === i.quantidade)) { c.situacao = 'concluida'; c.concluido_em = new Date().toISOString(); } return c.situacao; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]),
    lin_vendedoras: () => ok([{ user_id: 'u-vendedora', nome: 'Vera Vendedora' }, { user_id: 'u-estoque', nome: 'Edu Estoque' }]),
    lin_cliente_credito: () => ok({ saldo: 0, extrato: [] }),
    lin_cond_no_estoque: () => { const m = new Map();
      for (const i of S.it) { const c = S.cd.find(x => x.id === i.condicional_id), pend = i.quantidade - i.compradas - i.devolvidas;
        if (!c || c.situacao !== 'aberta' || pend <= 0) continue;
        const k = i.variante_id + ':' + c.loja_id, x = m.get(k) || { variante_id: i.variante_id, loja_id: c.loja_id, pecas: 0, itens: [] };
        x.pecas += pend; x.itens.push({ n: c.id, tipo: c.tipo, cliente: S.cli.find(z => z.id === c.cliente_id).nome.split(' ')[0], prazo: c.prazo, pecas: pend }); m.set(k, x); }
      return ok([...m.values()]); },
    lin_condicional_criar: ({ p }) => {
      if (!p.cliente_id) return erro('Escolha a cliente (ela precisa estar cadastrada)');
      for (const i of p.itens) { const e = est(i.variante_id, p.loja); if (!e || e[2] < i.quantidade) return erro('Estoque insuficiente'); }
      const id = S.cd.length + 1;
      S.cd.unshift({ id, tipo: p.tipo, loja_id: p.loja, cliente_id: p.cliente_id, responsavel_id: 'u-' + S.D.papel, responsavel_nome: 'Vera Vendedora', prazo: p.prazo,
        observacao: p.observacao, situacao: 'aberta', criado_nome: 'Vera Vendedora', criado_em: new Date().toISOString(), concluido_em: null });
      for (const i of p.itens) { const x = vari(i.variante_id); est(i.variante_id, p.loja)[2] -= i.quantidade;
        S.it.push({ id: S.it.length + 1, condicional_id: id, variante_id: i.variante_id, quantidade: i.quantidade, compradas: 0, devolvidas: 0,
          referencia: x.p.referencia, descricao: x.p.descricao, cor: x.v.cor, tamanho: x.v.tamanho, edicao: x.v.edicao, preco_venda: x.p.preco_venda }); }
      return ok(id); },
    lin_condicional_devolver: ({ p_id, p_itens, p_obs }) => { const c = S.cd.find(x => x.id === p_id);
      const l = p_itens && p_itens.length ? p_itens : S.it.filter(i => i.condicional_id === p_id).map(i => ({ item_id: i.id, quantidade: i.quantidade - i.compradas - i.devolvidas }));
      for (const r of l) { const i = S.it.find(x => x.id === r.item_id); i.devolvidas += r.quantidade; somar(i.variante_id, c.loja_id, r.quantidade);
        S.bx.push({ id: S.bx.length + 1, condicional_id: p_id, item_id: i.id, resultado: 'devolveu', quantidade: r.quantidade, observacao: p_obs || '', criado_nome: 'Vera', criado_em: new Date().toISOString() }); }
      return ok(fechar(c)); },
    lin_condicional_venda: ({ p_id, p_itens, p }) => { const c = S.cd.find(x => x.id === p_id);
      for (const r of p_itens) { const i = S.it.find(x => x.id === r.item_id); i.compradas += r.quantidade;
        S.bx.push({ id: S.bx.length + 1, condicional_id: p_id, item_id: i.id, resultado: 'comprou', quantidade: r.quantidade, venda_id: 77, criado_nome: 'Vera', criado_em: new Date().toISOString() }); }
      fechar(c); return ok(77); },
    lin_condicional_prazo: ({ p_id, p_prazo }) => { S.cd.find(x => x.id === p_id).prazo = p_prazo; return ok(null); },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-' + S.D.papel } } } }) },
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

async function pagina(ctx, papel, valores, preset) {
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push(String(e.stack || e).slice(0, 300)));
  const corpo = FALSO.replace('__PAPEL__', papel).replace('__PRESET__', JSON.stringify(preset || {}));
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: corpo, contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`);
  await pg.waitForSelector('#app:not(.oculto)');
  return { pg, erros };
}
async function aba(pg, sel) {
  const g = await pg.getAttribute(sel, 'data-g'); await pg.click(`.barra .grupo[data-g="${g}"]`); await pg.waitForTimeout(150);
  await pg.click(sel); await pg.waitForTimeout(250);
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const estoque = (pg, v, l) => pg.evaluate(([v, l]) => (window.__S.D.estoque.find(e => e[0] === v && e[1] === l) || [0, 0, 0])[2], [v, l]);
const ultimaRpc = (pg, fn) => pg.evaluate(fn => { const l = window.__S.rpc.filter(x => x[0] === fn); return l.length ? l[l.length - 1][1] : null; }, fn);


const hojeBR = (d = 0) => { const x = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const { pg, erros } = await pagina(ctx, 'vendedora', false);
    ok(!(await pg.locator('#abaCond').evaluate(e => e.classList.contains('oculto'))), 'vendedora tem a aba Malinhas e reservas');
    await aba(pg, '#abaCond'); await pg.waitForSelector('#cdmal');
    await pg.click('#cdmal'); await pg.waitForSelector('#dlg[open] #cdok');
    ok(await pg.inputValue('#cdprazo') === hojeBR(3), 'malinha: prazo padrão de 3 dias');
    await pg.click('#dlgf [data-cdg="tipo"][data-x="reserva"]');
    ok(await pg.inputValue('#cdprazo') === hojeBR(7), 'reserva: prazo padrão de 7 dias');
    await pg.click('#dlgf [data-cdg="tipo"][data-x="malinha"]');
    await pg.fill('#cdq', 'vestido'); await pg.waitForTimeout(150); await pg.locator('#cdpres button').first().click(); await pg.waitForTimeout(100);
    await pg.click('#cdok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('cliente'), 'malinha exige a cliente');
    await pg.fill('#cdqc', 'maria'); await pg.waitForTimeout(150); await pg.click('[data-cdcli="c1"]'); await pg.waitForTimeout(100);
    await pg.fill('[data-cdq="0"]', '9'); await pg.click('#cdok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('só tem 5'), 'mais que o estoque: barrado na tela');
    await pg.fill('[data-cdq="0"]', '2'); await pg.fill('#cdobs', 'motoboy à tarde');
    await pg.click('#cdok'); await pg.waitForSelector('#dlg[open] #cdfimp');
    const r1 = await ultimaRpc(pg, 'lin_condicional_criar');
    ok(r1 && r1.p.tipo === 'malinha' && r1.p.cliente_id === 'c1' && r1.p.loja === 'l-gav' && r1.p.prazo === hojeBR(3) && r1.p.itens[0].quantidade === 2 && r1.p.observacao === 'motoboy à tarde',
      'manda tipo, cliente, loja, prazo, observação e peças');
    ok((await pg.locator('#dlgf').innerText()).includes('Malinha nº 1 · Maria Souza'), 'a ficha abre depois de registrar (para imprimir e mandar junto)');
    await print(pg, 'cond_ficha');
    await pg.click('#cdfx');
    // Estoque: marca com cliente
    await aba(pg, '.barra .aba[data-v="estoque"]'); await pg.waitForTimeout(300);
    const chip = pg.locator('.chip[data-v="v1"][data-l="l-gav"]');
    ok((await chip.innerText()).includes('+2 com cliente') && (await chip.getAttribute('class')).includes('cd'), 'Estoque: o quadrado mostra "+2 com cliente"');
    ok(((await chip.locator('b').getAttribute('title')) || '').includes('Com cliente: 2 peça(s)') && ((await chip.locator('b').getAttribute('title')) || '').includes('malinha nº 1 (Maria'), 'aviso ao apontar o mouse: quantas, malinha, cliente e prazo');
    await print(pg, 'cond_estoque');
    // volta: 1 voltou, 1 comprou → venda preenchida
    await aba(pg, '#abaCond'); await pg.waitForSelector('[data-cdvolta="1"]');
    ok((await pg.locator('#tela').innerText()).includes('Malinha nº 1 · Maria Souza'), 'lista com a malinha');
    await pg.click('[data-cdvolta="1"]'); await pg.waitForTimeout(400); if (erros.length) console.log('ERROS', erros); await pg.waitForSelector('#dlg[open] #cdvok');
    await pg.fill('[data-cdv="comprou:1"]', '2'); await pg.fill('[data-cdv="devolveu:1"]', '1'); await pg.click('#cdvok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('só 2 peça'), 'não registra mais do que está com a cliente');
    await pg.fill('[data-cdv="comprou:1"]', '1'); await pg.fill('#cdvobs', 'não serviu');
    pg.once('dialog', d => d.accept()); await pg.click('#cdvok'); await pg.waitForSelector('#dlg[open] #nvok');
    const dv = await ultimaRpc(pg, 'lin_condicional_devolver');
    ok(dv && dv.p_id === 1 && dv.p_itens[0].quantidade === 1 && dv.p_obs === 'não serviu' && await estoque(pg, 'v1', 'l-gav') === 4, 'o que voltou entra no estoque');
    const fv = await pg.locator('#dlgf').innerText();
    ok(fv.includes('Venda da malinha nº 1') && fv.includes('Maria Souza') && await pg.locator('#nvloja').isDisabled() && await pg.inputValue('#nvitens input[data-k="q"]') === '1',
      'abre a venda preenchida: cliente, peça comprada, loja travada');
    await print(pg, 'cond_venda');
    await pg.click('#nvok'); await pg.waitForTimeout(500);
    const vd = await ultimaRpc(pg, 'lin_condicional_venda');
    ok(vd && vd.p_id === 1 && vd.p_itens[0].quantidade === 1 && vd.p.itens[0].variante_id === 'v1' && vd.p.itens[0].quantidade === 1 && vd.p.pagamentos.length === 1,
      'a venda vai pela lin_condicional_venda com a peça comprada e o pagamento');
    ok(await pg.evaluate(() => !window.__S.rpc.some(x => x[0] === 'lin_venda_registrar')), 'não usa a venda comum');
    // reserva → desistiu de tudo; mudar prazo
    await aba(pg, '#abaCond'); await pg.waitForSelector('#cdreserva');
    await pg.click('#cdreserva'); await pg.waitForSelector('#dlg[open] #cdok');
    await pg.fill('#cdqc', 'joana'); await pg.waitForTimeout(150); await pg.click('[data-cdcli="c2"]'); await pg.waitForTimeout(100);
    await pg.fill('#cdq', 'calca'); await pg.waitForTimeout(150); await pg.locator('#cdpres button').first().click(); await pg.waitForTimeout(100);
    await pg.click('#cdok'); await pg.waitForSelector('#dlg[open] #cdfprazo');
    await pg.click('#cdfprazo'); await pg.waitForSelector('#cdnp'); await pg.fill('#cdnp', hojeBR(12)); await pg.click('#cdnpok'); await pg.waitForTimeout(300);
    const pz = await ultimaRpc(pg, 'lin_condicional_prazo');
    ok(pz && pz.p_id === 2 && pz.p_prazo === hojeBR(12), 'mudar o prazo da reserva');
    await pg.click('#cdfx'); await aba(pg, '#abaCond'); await pg.waitForSelector('[data-cdtudo="devolveu:2"]');
    await pg.click('[data-cdtudo="devolveu:2"]'); await pg.waitForSelector('#dlg[open] #cdvok');
    pg.once('dialog', d => d.accept()); await pg.click('#cdvok'); await pg.waitForTimeout(500);
    const dv2 = await ultimaRpc(pg, 'lin_condicional_devolver');
    ok(dv2 && dv2.p_id === 2 && dv2.p_itens[0].quantidade === 1 && await estoque(pg, 'v5', 'l-gav') === 4, '"Desistiu de tudo" devolve as peças da reserva');
    await pg.click('#tela [data-fcd="sit"][data-x="concluida"]'); await pg.waitForTimeout(300);
    ok((await pg.locator('#tela').innerText()).includes('Reserva nº 2 · Joana Lima'), 'concluídas aparecem no filtro');
    // a venda comum continua igual (sem malinha): loja livre e lin_venda_registrar
    await pg.evaluate(async () => { await carregarVendedoras(); await carregarClientes(); novaVenda({}); }); await pg.waitForSelector('#dlg[open] #nvok');
    ok(await pg.locator('#dlgf h3').innerText() === 'Nova venda' && !(await pg.locator('#nvloja').isDisabled()), 'venda comum: título e loja livres');
    await pg.fill('#nvpq', 'vestido'); await pg.waitForTimeout(200); await pg.locator('#nvres button, #nvres [data-add], #nvres .vlin button').first().click(); await pg.waitForTimeout(150);
    await pg.click('#nvok'); await pg.waitForTimeout(400);
    const vc = await ultimaRpc(pg, 'lin_venda_registrar');
    ok(vc && vc.p.loja_id === 'l-gav' && vc.p.itens.length === 1 && vc.p.itens[0].quantidade === 1, 'venda comum continua indo pela lin_venda_registrar');
    ok(erros.length === 0, 'sem erro de JavaScript (vendedora) ' + erros.join(' | '));

    // Estoque (papel): "Malinha / reserva" ao movimentar
    const e = await pagina(ctx, 'estoque', false);
    await e.pg.click('button.chip[data-v="v1"][data-l="l-gav"]'); await e.pg.waitForSelector('#dlg[open]'); await e.pg.waitForTimeout(300);
    await e.pg.click('#dlgf [data-g="tipo"][data-x="malinha"]'); await e.pg.waitForSelector('#dlg[open] #cdok');
    ok((await e.pg.locator('#dlgf table').innerText()).includes('Vestido Mar'), '"Malinha / reserva" ao movimentar abre com a peça');
    ok(e.erros.length === 0, 'sem erro de JavaScript (Estoque) ' + e.erros.join(' | '));

    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'vendedora', false);
    await aba(m.pg, '#abaCond'); await m.pg.waitForSelector('#cdmal');
    await m.pg.click('#cdmal'); await m.pg.waitForSelector('#dlg[open] #cdok');
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: malinha sem rolagem lateral');
    await print(m.pg, 'cond_celular');
    ok(m.erros.length === 0, 'sem erro de JavaScript (celular) ' + m.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
