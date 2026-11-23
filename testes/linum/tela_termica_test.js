// Teste de tela do extrato da venda na impressora térmica (Sistema Linum 2.56) com o Playwright do Node, Supabase IMITADO
// e uma impressora Bluetooth IMITADA no navegador (guarda os bytes ESC/POS). Dados FICTÍCIOS.
// Uso: node testes/linum/tela_termica_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8846;
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
  cliente_id: id === 6 ? 'c1' : null, valor_bruto: 849, valor_itens: 849, desconto: 0, valor_total: 849, credito_usado: 0, valor_nf: 849, comissao_pct: 0, comissao_valor: 0,
  pagamentos: pags, observacao: '', criado_nome: 'Beatriz', criado_em: new Date().toISOString(), cancelada_em: null });

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [],
    vendas: [${JSON.stringify(venda(5, 'u-vendedora', [{ forma: 'pix', valor: 49 }, { forma: 'credito', valor: 800, parcelas: 2, cv: '' }]))},
             ${JSON.stringify(venda(6, 'u-vendedora', [{ forma: 'debito', valor: 849, parcelas: 1, cv: '189435334' }]))}],
    itens: [5, 6].map(v => ({ id: v * 10, venda_id: v, variante_id: 'v1', quantidade: 1, referencia: 'A25', descricao: 'Vestido Artesanal', cor: 'Natural', tamanho: 'G', edicao: '',
      preco_tabela: 849, desconto_pct: 0, valor_unitario: 849, valor_total: 849 })),
    cli: [{ id: 'c1', nome: 'Maria Fictícia da Conceição', telefone: '21999990000', cpf: '11122233344', situacao: 'cliente' }] };
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
  window.__BT = { escritas: [], pedidos: 0 };
  if (!window.__SEM_BT) navigator.bluetooth = { requestDevice: async (o) => { window.__BT.pedidos++; window.__BT.opcoes = o;
    const car = { properties: { write: true, writeWithoutResponse: false }, writeValueWithResponse: async b => { window.__BT.escritas.push(Array.from(b)); } };
    const dev = { name: 'YY0808', addEventListener: () => {}, gatt: { connected: false, connect: async () => { dev.gatt.connected = true;
      return { getPrimaryServices: async () => [{ getCharacteristics: async () => [{ properties: { read: true } }, car] }] }; }, disconnect: () => { dev.gatt.connected = false; } } };
    return dev; } };
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
async function pagina(ctx, papel, semBt) {
  const pg = await ctx.newPage();
  if (semBt) await pg.addInitScript(() => { window.__SEM_BT = true; }); const erros = [];
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


const bytesTexto = b => Buffer.from(b).toString('utf8');
(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const { pg, erros } = await pagina(ctx, 'vendedora');
    await vendas(pg);
    await pg.click('.vrow[data-v="6"]'); await pg.waitForSelector('#dlg[open] #vterm');
    await pg.click('#vterm'); await pg.waitForSelector('#dlg2[open] #tmimp');
    const prev = await pg.locator('#tmprev').innerText();
    ok(prev.includes('EXTRATO DA VENDA Nº 6') && prev.includes('Não é documento fiscal') && prev.includes('Maria Fictícia') && prev.includes('CPF 111.222.333-44')
      && prev.includes('A25 Vestido Artesanal') && prev.includes('CV 189435334') && prev.includes('Rua Visconde de Pirajá') && prev.includes('22410-002') && prev.includes('3734-1350'), 'prévia do extrato com venda, cliente, peça, CV e endereço da loja');
    ok(!prev.includes('omiss'), 'extrato sem comissão');
    const largura = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('#tmprev div:not(.g)')].map(d => d.textContent.length)));
    ok(largura <= 48, 'nenhuma linha passa de 48 colunas (' + largura + ')');
    await print(pg, 'termica_previa');
    await pg.click('#tmimp'); await pg.waitForFunction(() => document.getElementById('tmimp').textContent.includes('Impresso'));
    let env = await pg.evaluate(() => window.__BT);
    const tudo = env.escritas.flat();
    ok(env.pedidos === 1 && env.opcoes.acceptAllDevices && env.opcoes.optionalServices.includes('000018f0-0000-1000-8000-00805f9b34fb'), 'pede a impressora ao navegador (com os serviços BLE das térmicas)');
    ok(tudo[0] === 0x1b && tudo[1] === 0x40 && env.escritas.every(x => x.length <= 100), 'ESC @ no começo e pacotes de até 100 bytes');
    const t = bytesTexto(tudo);
    ok(t.includes('EXTRATO DA VENDA Nº 6') && t.includes('Maria Fictícia') && t.includes('R$ 849,00') && !t.includes(' '), 'bytes em UTF-8 com acentos e sem espaço especial');
    ok(await pg.locator('#tmstatus').innerText().then(x => x.includes('YY0808')), 'mostra a impressora conectada');
    await pg.click('#tmimp'); await pg.waitForTimeout(300);
    ok((await pg.evaluate(() => window.__BT.pedidos)) === 1, 'segunda impressão não pede a impressora de novo');
    // sem acentos e 32 colunas
    await pg.click('#tmprev ~ details summary'); await pg.uncheck('#tmac'); await pg.selectOption('#tmcol', '32'); await pg.waitForTimeout(100);
    const prev2 = await pg.locator('#tmprev').innerText();
    const larg2 = await pg.evaluate(() => Math.max(...[...document.querySelectorAll('#tmprev div:not(.g)')].map(d => d.textContent.length)));
    ok(prev2.includes('Nao e documento fiscal') && larg2 <= 32, 'sem acentos e 32 colunas na prévia (' + larg2 + ')');
    await pg.evaluate(() => { window.__BT.escritas = []; });
    await pg.click('#tmteste'); await pg.waitForTimeout(400);
    const t2 = bytesTexto((await pg.evaluate(() => window.__BT.escritas)).flat());
    ok(t2.includes('TESTE DA IMPRESSORA') && t2.includes('Acentos: acao') && /^[\x00-\x7f]*$/.test(t2), 'teste sem acentos só com ASCII');
    ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('linum-termica')).colunas === 32), 'ajuste guardado no aparelho');
    await pg.selectOption('#tmcol', '48'); await pg.check('#tmac');
    const [pop] = await Promise.all([pg.waitForEvent('popup'), pg.click('#tmnav')]);
    await pop.waitForLoadState(); const h = await pop.content();
    ok(h.includes('size:80mm') && h.includes('EXTRATO DA VENDA Nº 6'), 'imprimir pelo navegador em 80 mm'); await pop.close();
    await pg.click('#tmfechar');
    // depois de registrar a venda abre o extrato
    await pg.keyboard.press('Escape'); await vendas(pg);
    await pg.click('#vnova'); await pg.waitForSelector('#dlg[open] #nvok');
    await pg.fill('#nvpq', 'a25'); await pg.waitForTimeout(200); await pg.locator('#nvres button').first().click(); await pg.waitForTimeout(150);
    await pg.selectOption('[data-pg="0"][data-k="forma"]', 'pix'); await pg.waitForTimeout(100);
    await pg.click('#nvok'); await pg.waitForSelector('#dlg2[open] #tmimp');
    ok((await pg.locator('#dlg2f h3').innerText()).includes('registrada') && (await pg.locator('#tmprev').innerText()).includes('EXTRATO DA VENDA Nº'), 'ao fechar a venda abre o extrato para imprimir');
    await print(pg, 'termica_depois_da_venda');
    ok(erros.length === 0, 'sem erro de JavaScript ' + erros.join(' | '));

    // navegador sem Bluetooth (iPhone): mensagem clara
    const s = await pagina(ctx, 'vendedora', true);
    await vendas(s.pg); await s.pg.click('.vrow[data-v="6"]'); await s.pg.click('#vterm'); await s.pg.waitForSelector('#dlg2[open] #tmimp');
    await s.pg.click('#tmimp'); await s.pg.waitForTimeout(200);
    ok((await s.pg.locator('#tmerr').innerText()).includes('não imprime por Bluetooth') && (await s.pg.locator('#tmstatus').innerText()).includes('sem Bluetooth'), 'sem Bluetooth: avisa e sugere o navegador');
    ok(s.erros.length === 0, 'sem erro de JavaScript (sem Bluetooth) ' + s.erros.join(' | '));

    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'vendedora');
    await vendas(m.pg); await m.pg.click('.vrow[data-v="6"]'); await m.pg.click('#vterm'); await m.pg.waitForSelector('#dlg2[open] #tmimp');
    ok(await m.pg.evaluate(() => document.getElementById('dlg2').scrollWidth <= document.getElementById('dlg2').clientWidth + 1), 'celular: janela do extrato sem rolagem lateral');
    await print(m.pg, 'termica_celular');
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
