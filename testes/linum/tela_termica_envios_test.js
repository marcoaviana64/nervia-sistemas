// Teste de tela dos comprovantes de TRANSFERÊNCIA e BENEFICIAMENTO na impressora térmica (Sistema Linum 2.63) com o Playwright
// do Node, Supabase IMITADO e impressora Bluetooth IMITADA (guarda os bytes ESC/POS). Dados FICTÍCIOS.
// Uso: node testes/linum/tela_termica_envios_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8854;
const agora = new Date().toISOString();
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const DADOS = { papel: 'estoque', minha_loja: 'l-ipa', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'A25', descricao: 'Vestido Artesanal', categoria: 'Vestido', preco_venda: 1799, variantes: [{ id: 'v1', cor: 'Natural', tamanho: 'G', edicao: '' }] }],
  estoque: [['v1', 'l-ipa', 5]] };
const TR = [{ id: 7, origem_id: 'l-ipa', destino_id: 'l-gav', situacao: 'em_transito', enviado_em: agora, enviado_nome: 'Beatriz Estoque', enviado_por: 'u-estoque', observacao: 'para a vitrine' },
  { id: 8, origem_id: 'l-gav', destino_id: 'l-ipa', situacao: 'recebida_com_falta', enviado_em: agora, enviado_nome: 'Meire', recebido_em: agora, recebido_nome: 'Rachel', recebimento_obs: 'uma veio manchada, voltou' }];
const TI = [{ id: 1, transferencia_id: 7, variante_id: 'v1', quantidade: 2, referencia: 'A25', descricao: 'Vestido Artesanal', cor: 'Natural', tamanho: 'G', edicao: '', recebida: null },
  { id: 2, transferencia_id: 8, variante_id: 'v1', quantidade: 2, referencia: 'A25', descricao: 'Vestido Artesanal', cor: 'Natural', tamanho: 'G', edicao: '', recebida: 1 }];
const BF = [{ id: 21, loja_id: 'l-ipa', beneficiador: 'Ateliê X', servico: 'Bordado à mão', previsto: '2026-12-10', vai_virar: 'peça especial Bordada', situacao: 'no_beneficiamento', enviado_em: agora, enviado_nome: 'Beatriz Estoque', observacao: '' }];
const BI = [{ id: 31, beneficiamento_id: 21, variante_id: 'v1', quantidade: 3, voltaram: 0, perdidas: 0, referencia: 'A25', descricao: 'Vestido Artesanal', cor: 'Natural', tamanho: 'G', edicao: '' }];

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [], tr: ${JSON.stringify(TR)}, ti: ${JSON.stringify(TI)}, bf: ${JSON.stringify(BF)}, bi: ${JSON.stringify(BI)} };
  S.D.papel = '__PAPEL__';
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null });
  const tabela = t => ({ lin_transferencias: S.tr, lin_transferencia_itens: S.ti, lin_beneficiamentos: S.bf, lin_benef_itens: S.bi, lin_benef_retornos: [] }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q, not: () => q, or: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; }, is: (c, v) => { f.push(x => (x[c] ?? null) === v); return q; },
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; }, lt: (c, v) => { f.push(x => x[c] < v); return q; },
      maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const fns = { lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))), lin_meu_horario: () => ok({ liberado: true }), lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]), lin_vendas_sem_cliente: () => ok([]) };
  window.__BT = { escritas: [] };
  navigator.bluetooth = { requestDevice: async () => {
    const car = { properties: { write: true }, writeValueWithResponse: async b => { window.__BT.escritas.push(Array.from(b)); } };
    const dev = { name: 'YY0808', addEventListener: () => {}, gatt: { connected: false, connect: async () => { dev.gatt.connected = true;
      return { getPrimaryServices: async () => [{ getCharacteristics: async () => [car] }] }; }, disconnect: () => {} } };
    return dev; } };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: eu } } } }) },
    from: tab => consulta(tab), rpc: async (fn, args) => { S.rpc.push([fn, args]); return fns[fn] ? fns[fn](args || {}) : { data: null, error: null }; } }) };
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
const prev = pg => pg.locator('#tmprev').innerText();
const bytes = pg => pg.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__BT.escritas.flat())));

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
    const pg = await ctx.newPage(); const erros = [];
    pg.on('pageerror', e => erros.push(String(e.stack || e).slice(0, 300)));
    await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO.replace('__PAPEL__', 'estoque'), contentType: 'text/javascript' }));
    await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/?aba=transferencias`); await pg.waitForSelector('[data-trterm="7"]');
    // transferência em trânsito: 2 vias
    await pg.click('[data-trterm="7"]'); await pg.waitForSelector('#dlg2[open] #tmprev');
    let p = await prev(pg);
    ok(p.includes('TRANSFERÊNCIA ENTRE LOJAS Nº 7') && p.includes('De: Ipanema') && p.includes('Para: Gávea') && p.includes('Natural - G') && p.includes('2 un.'),
      'transferência: número, de/para e as peças com a quantidade');
    ok(p.includes('VIA DA LOJA DE ORIGEM') && p.includes('VIA QUE VAI COM AS PEÇAS') && p.includes('destaque aqui'), 'transferência em trânsito: 2 vias (origem e a que vai com as peças)');
    ok(p.includes('Conferido em') && p.includes('Recebido por (Gávea)') && p.includes('Enviado por Beatriz Estoque') && p.includes('para a vitrine'), 'espaço para quem envia e quem confere e recebe; observação');
    ok((await pg.locator('#dlg2 h3').innerText()).includes('transferência nº 7') && (await pg.locator('#dlg2').innerText()).includes('uma fica na loja de origem'), 'janela com o título e o texto das 2 vias');
    if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, 'termica_transferencia.png'), fullPage: true });
    await pg.click('#tmimp'); await pg.waitForFunction(() => window.__BT.escritas.length > 0);
    const bt = await bytes(pg);
    ok(bt.includes('TRANSFER') && bt.includes('Vestido Artesanal'), 'imprime na térmica (bytes ESC/POS com o comprovante)');
    await pg.click('#tmfechar');
    // transferência recebida com falta: uma via, com o que chegou
    await pg.click('[data-ftr="todas"]'); await pg.waitForSelector('[data-trterm="8"]');
    await pg.click('[data-trterm="8"]'); await pg.waitForSelector('#dlg2[open] #tmprev');
    p = await prev(pg);
    ok(p.includes('chegaram 1 de 2') && p.includes('Total recebido') && p.includes('manchada') && !p.includes('VIA QUE VAI') && !p.includes('Conferido em'),
      'transferência recebida: o que chegou, sem as 2 vias nem as assinaturas');
    await pg.click('#tmfechar');
    // depois de enviar, o comprovante abre sozinho
    await pg.evaluate(() => comprovanteTransferenciaId(7, { titulo: 'Transferência nº 7 enviada' }));
    await pg.waitForSelector('#dlg2[open] #tmprev');
    ok((await pg.locator('#dlg2 h3').innerText()).includes('enviada'), 'comprovante pelo número (o que abre depois do envio)');
    ok(fs.readFileSync(path.join(RAIZ, 'site/apps/linum/transferencias.js'), 'utf8').includes('comprovanteTransferenciaId(id,'), 'o envio da transferência chama o comprovante');
    await pg.click('#tmfechar');

    // beneficiamento
    await pg.click('.barra .grupo[data-g="estoque"]'); await pg.waitForTimeout(150); await pg.click('#abaBenef'); await pg.waitForTimeout(400);
    await pg.evaluate(() => abrirFichaBenef(21)); await pg.waitForSelector('#dlg[open] #bffterm');
    await pg.click('#bffterm'); await pg.waitForSelector('#dlg2[open] #tmprev');
    p = await prev(pg);
    ok(p.includes('SAÍDA PARA BENEFICIAMENTO Nº 21') && p.includes('Bordado à mão') && p.includes('Ateliê X') && p.includes('10/12/2026') && p.includes('3 un.') && p.includes('peça especial Bordada'),
      'beneficiamento: serviço, quem faz, volta prevista, o que vai virar e as peças');
    ok(p.includes('VIA DA LOJA') && p.includes('VIA DO BENEFICIADOR') && p.includes('Recebido por Ateliê X') && p.includes('Apresente esta via'), 'beneficiamento: via da loja assinada por quem recebe e via do beneficiador');
    ok(!/R\$/.test(p), 'sem valores no comprovante do beneficiamento');
    if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, 'termica_beneficiamento.png'), fullPage: true });
    await pg.click('#tmfechar'); await pg.waitForTimeout(200);
    ok(!(await pg.evaluate(() => document.getElementById('dlg2').open)) && await pg.evaluate(() => document.getElementById('dlg').open), 'Voltar fecha o comprovante e mantém a ficha aberta');
    ok(fs.readFileSync(path.join(RAIZ, 'site/apps/linum/beneficiamento.js'), 'utf8').includes('bffterm").click()'), 'o envio para beneficiamento já abre o comprovante');
    ok(erros.length === 0, 'sem erro de JavaScript ' + erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
