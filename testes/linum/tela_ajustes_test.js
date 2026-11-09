// Teste de tela do andamento dos ajustes do Sistema Linum (versão 2.39) com o Playwright do Node e um Supabase IMITADO
// no navegador (lin_ajustes, lin_ajuste_eventos, lin_ajuste_andamento). Dados FICTÍCIOS. As regras do banco estão nos
// testes SQL (testes/teste_sql.sql, "linum 2.39").
// Confere: "Voltou" e "Entregue" abrem o formulário com a observação opcional (e mandam a observação ao servidor);
// voltar para a costureira e cancelar exigem o motivo; a ficha do ajuste mostra os dados, a situação, o andamento e as
// ações; a ficha muda de status por dentro; na venda, "Ficha / status" abre a ficha; a impressão leva o andamento.
// Uso: node testes/linum/tela_ajustes_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8835;

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const DADOS = {
  papel: 'vendedora', minha_loja: 'l-ipa', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'VES-MAR', descricao: 'Vestido Mar', preco_venda: 489, variantes: [{ id: 'v1', cor: 'Azul', tamanho: 'P', edicao: '' }] }],
  estoque: [['v1', 'l-ipa', 3]],
};
const aj = (id, sit, extra = {}) => ({ id, venda_id: 12, venda_item_id: 1, quantidade: 1, loja_id: 'l-ipa', cliente_id: 'c1', peca: 'VES-MAR Vestido Mar — Azul P',
  servico: 'Bainha 2 cm', parceiro_id: null, costureira: 'Dona Rosa', prazo: '2099-01-10', valor_costureira: 25, valor_cliente: 0, observacao: 'alfinete marcado',
  situacao: sit, enviado_em: '2026-11-01T15:00:00Z', enviado_por: 'u-vendedora', enviado_nome: 'Vera', pronto_em: null, pronto_nome: null, pronto_obs: '',
  entregue_em: null, entregue_nome: null, entrega_obs: '', cancelado_em: null, cancelado_nome: null, motivo_cancelamento: null, ...extra });
const ESTADO = {
  lin_ajustes: [aj(1, 'na_costureira'), aj(2, 'pronto', { pronto_em: '2026-11-05T15:00:00Z', pronto_nome: 'Vera', servico: 'Apertar cava' })],
  lin_ajuste_eventos: [
    { id: 1, ajuste_id: 1, evento: 'enviado', texto: 'Bainha 2 cm', criado_em: '2026-11-01T15:00:00Z', criado_nome: 'Vera' },
    { id: 2, ajuste_id: 2, evento: 'enviado', texto: 'Apertar cava', criado_em: '2026-11-01T15:00:00Z', criado_nome: 'Vera' },
    { id: 3, ajuste_id: 2, evento: 'pronto', texto: '', criado_em: '2026-11-05T15:00:00Z', criado_nome: 'Vera' }],
  lin_clientes: [{ id: 'c1', nome: 'Ana Souza', telefone: '21999990000' }],
  lin_vendas: [{ id: 12, data: hoje, loja_id: 'l-ipa', vendedora_id: 'u-vendedora', vendedora_nome: 'Vera', cliente_id: 'c1', valor_bruto: 489, valor_itens: 489, desconto: 0,
    valor_total: 489, pagamentos: [{ forma: 'pix', valor: 489 }], comissao_pct: 0, comissao_valor: 0, credito_usado: 0, valor_nf: 489, observacao: '', criado_nome: 'Vera', criado_em: hoje + 'T15:00:00Z' }],
  lin_venda_itens: [{ id: 1, venda_id: 12, referencia: 'VES-MAR', descricao: 'Vestido Mar', cor: 'Azul', tamanho: 'P', edicao: '', quantidade: 1, preco_tabela: 489, desconto_pct: 0, valor_unitario: 489, valor_total: 489 }],
};

const FALSO = `(() => {
  const S = window.__S = Object.assign(${JSON.stringify(ESTADO)}, { rpc: [] }); const D = ${JSON.stringify(DADOS)};
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const consulta = tab => { const f = []; let um = false;
    const q = { select: () => q, order: () => q, limit: () => q, or: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; },
      gte: (c, v) => { f.push(x => String(x[c]) >= v); return q; }, lte: (c, v) => { f.push(x => String(x[c]) <= v); return q; },
      maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok((S[tab] || []).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = (S[tab] || []).filter(x => f.every(g => g(x))); return ok(um ? JSON.parse(JSON.stringify(l[0] || null)) : JSON.parse(JSON.stringify(l))).then(r, j); } };
    return q; };
  const agora = () => new Date().toISOString();
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(D))), lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok({ producao: false, producao_valores: false }), lin_costureiras: () => ok([]), lin_vendedoras: () => ok([]),
    lin_creditos_saldos: () => ok({}),
    lin_ajuste_andamento: ({ p_ajuste, p_acao, p_motivo }) => {
      const a = S.lin_ajustes.find(x => x.id === p_ajuste), t = (p_motivo || '').trim();
      if ((p_acao === 'reabrir' || p_acao === 'cancelar') && t.length < 3) return erro('Diga o motivo');
      const ev = { pronto: 'pronto', entregue: 'entregue', reabrir: 'reaberto', cancelar: 'cancelado' }[p_acao];
      if (p_acao === 'pronto') Object.assign(a, { situacao: 'pronto', pronto_em: agora(), pronto_nome: 'Vera', pronto_obs: t });
      if (p_acao === 'entregue') Object.assign(a, { situacao: 'entregue', entregue_em: agora(), entregue_nome: 'Vera', entrega_obs: t });
      if (p_acao === 'reabrir') Object.assign(a, { situacao: 'na_costureira', pronto_em: null, pronto_obs: '' });
      if (p_acao === 'cancelar') Object.assign(a, { situacao: 'cancelado', cancelado_em: agora(), motivo_cancelamento: t });
      S.lin_ajuste_eventos.push({ id: S.lin_ajuste_eventos.length + 1, ajuste_id: p_ajuste, evento: ev, texto: t, criado_em: agora(), criado_nome: 'Vera' });
      return ok(null);
    },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-vendedora' } } } }) },
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
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const ultimaRpc = (pg, fn) => pg.evaluate(fn => { const l = window.__S.rpc.filter(x => x[0] === fn); return l.length ? l[l.length - 1][1] : null; }, fn);
async function aba(pg, sel) { const g = await pg.getAttribute(sel, 'data-g'); await pg.click(`.barra .grupo[data-g="${g}"]`); await pg.waitForTimeout(150); await pg.click(sel); await pg.waitForTimeout(400); }

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); const erros = [];
    pg.on('pageerror', e => erros.push(String(e)));
    await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
    await pg.goto(`http://127.0.0.1:${PORTA}/apps/linum/`); await pg.waitForSelector('#app:not(.oculto)');
    await aba(pg, '#abaAjustes'); await pg.waitForSelector('#ajtab');
    ok(await pg.locator('#ajtab [data-ficha]').count() === 4, 'cada ajuste tem o número e "Ficha" para abrir a ficha');

    // "Voltou" pela lista: formulário com observação opcional
    await pg.click('#ajtab [data-aj="pronto"][data-id="1"]'); await pg.waitForSelector('#dlg2[open] #ajandobs');
    ok((await pg.locator('#dlg2f label').textContent()).includes('Como voltou? (opcional)'), '"Voltou" abre o formulário com a observação opcional');
    await pg.fill('#ajandobs', 'bainha feita e conferida'); await pg.click('#ajandok'); await pg.waitForTimeout(500);
    let r = await ultimaRpc(pg, 'lin_ajuste_andamento');
    ok(r && r.p_ajuste === 1 && r.p_acao === 'pronto' && r.p_motivo === 'bainha feita e conferida' && !(await pg.locator('#dlg2').isVisible()), 'manda a observação da volta e fecha');
    ok((await pg.locator('#ajtab').innerText()).includes('bainha feita e conferida'), 'a lista mostra a observação da volta');

    // "Entregue" sem observação (opcional)
    await pg.click('#ajtab [data-aj="entregue"][data-id="2"]'); await pg.waitForSelector('#dlg2[open] #ajandobs');
    ok((await pg.locator('#dlg2f label').textContent()).includes('Observação do retorno (opcional)'), '"Entregue" pede a observação do retorno (opcional)');
    await pg.click('#ajandok'); await pg.waitForTimeout(500);
    r = await ultimaRpc(pg, 'lin_ajuste_andamento');
    ok(r.p_ajuste === 2 && r.p_acao === 'entregue' && r.p_motivo === null, 'entregue sem observação também grava');

    // "Voltar p/ costureira" exige o motivo
    await pg.click('#ajtab [data-aj="reabrir"][data-id="1"]'); await pg.waitForSelector('#dlg2[open] #ajandobs');
    await pg.click('#ajandok'); await pg.waitForTimeout(200);
    ok((await pg.locator('#ajanderr').innerText()).includes('3 letras') && (await pg.locator('#dlg2').isVisible()), 'voltar para a costureira sem motivo: barrado na tela');
    await pg.click('#ajandx'); await pg.waitForTimeout(100);

    // ficha do ajuste nº 1 (pronto): dados, andamento e ações
    await pg.click('#ajtab [data-ficha="1"] >> nth=0'); await pg.waitForSelector('#dlg2[open] .ajlinha');
    let f = await pg.locator('#dlg2f').innerText();
    ok(f.includes('Ajuste nº 1') && f.includes('Pronto na loja') && f.includes('Ana Souza') && f.includes('Bainha 2 cm') && f.includes('Dona Rosa') && f.includes('alfinete marcado'),
      'ficha: situação, cliente, o que fazer, costureira e observações');
    const evs = await pg.locator('#dlg2f .ajlinha li').allInnerTexts();
    ok(evs.length === 3 && evs[0].startsWith('Enviado para a costureira') && evs[1].startsWith('Voltou para a loja') && evs[1].includes('bainha feita e conferida') && evs[2].includes('avisar a cliente'),
      'ficha: andamento com envio, volta (com a observação) e o próximo passo');
    ok(await pg.locator('#dlg2f [data-fa="entregue"]').count() === 1 && await pg.locator('#dlg2f [data-fa="reabrir"]').count() === 1 && await pg.locator('#dlg2f [data-fa="cancelar"]').count() === 1,
      'ficha pronta: Entregue, Voltar p/ costureira e Cancelar');
    await print(pg, 'ajuste_ficha');
    // entregar pela ficha, com observação; a ficha volta atualizada
    await pg.click('#dlg2f [data-fa="entregue"]'); await pg.waitForSelector('#ajandobs');
    await pg.click('#ajandx'); await pg.waitForSelector('#dlg2f .ajlinha');
    ok(true, '"Voltar" no formulário volta para a ficha');
    await pg.click('#dlg2f [data-fa="entregue"]'); await pg.waitForSelector('#ajandobs');
    await pg.fill('#ajandobs', 'cliente provou e gostou'); await pg.click('#ajandok'); await pg.waitForSelector('#dlg2f .ajlinha li.ev-entregue');
    f = await pg.locator('#dlg2f').innerText();
    ok(f.includes('Entregue') && f.includes('Entregue à cliente') && f.includes('cliente provou e gostou') && await pg.locator('#dlg2f [data-fa]').count() === 0,
      'depois de entregar, a ficha mostra Entregue, a observação e nenhuma ação');
    // impressão com o andamento
    const [pop] = await Promise.all([ctx.waitForEvent('page'), pg.click('#faimp')]);
    await pop.waitForLoadState(); const imp = await pop.evaluate(() => document.body.innerText); await pop.close();
    ok(imp.includes('Situação') && imp.includes('Entregue') && imp.includes('Andamento') && imp.includes('Voltou para a loja') && imp.includes('cliente provou e gostou'), 'ficha impressa com a situação e o andamento');
    await pg.click('#fax');
    ok((await pg.locator('#ajtab').innerText()).includes('Nenhum ajuste aqui.'), 'a lista de trás se atualiza (os dois entregues saem de "Em aberto")');
    await pg.click('[data-fsit="entregue"]'); await pg.waitForTimeout(300);
    ok((await pg.locator('#ajtab').innerText()).includes('cliente provou e gostou'), 'filtro Entregues mostra a observação do retorno');

    // venda: "Ficha / status" abre a ficha por cima da venda
    await pg.evaluate(() => verVenda(12)); await pg.waitForSelector('#vajustes [data-vfa]');
    await pg.click('#vajustes [data-vfa="1"]'); await pg.waitForSelector('#dlg2[open] .ajlinha');
    ok((await pg.locator('#dlg2f').innerText()).includes('Ajuste nº 1') && await pg.locator('#dlg').isVisible(), 'na venda, "Ficha / status" abre a ficha do ajuste');
    await pg.click('#fax');
    ok(erros.length === 0, 'sem erro de JavaScript ' + erros.join(' | '));

    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await cel.newPage(); const ce = []; c.on('pageerror', e => ce.push(String(e)));
    await c.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
    await c.goto(`http://127.0.0.1:${PORTA}/apps/linum/`); await c.waitForSelector('#app:not(.oculto)');
    await aba(c, '#abaAjustes'); await c.click('#ajtab [data-ficha="2"] >> nth=0'); await c.waitForSelector('#dlg2[open] .ajlinha');
    ok(await c.evaluate(() => document.getElementById('dlg2').scrollWidth <= document.getElementById('dlg2').clientWidth + 1), 'celular: ficha sem rolagem lateral');
    await print(c, 'ajuste_ficha_celular');
    ok(ce.length === 0, 'sem erro de JavaScript (celular) ' + ce.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
