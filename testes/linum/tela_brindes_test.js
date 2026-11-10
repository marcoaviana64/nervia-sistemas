// Teste de tela do Brinde / Presente / Divulgação do Sistema Linum (versão 2.44) com o Playwright do Node e um Supabase
// IMITADO no navegador. Dados FICTÍCIOS. As regras do banco estão nos testes SQL (testes/teste_sql.sql, "linum 2.44").
// Confere: aba só para Dono e Estoque; "Brinde / presente" ao movimentar a peça; para quem obrigatório; "Outro" exige
// observação; mais que o estoque barrado; cliente do cadastro; o que vai ao servidor; lista, KPIs e custo só do Dono;
// cancelar só do Dono, com motivo; Movimentações com os tipos novos; celular sem rolagem lateral.
// Uso: node testes/linum/tela_brindes_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8835;

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
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, br: [], mov: [], rpc: [],
    cli: [{ id: 'c1', nome: 'Maria Souza', telefone: '21999990000' }, { id: 'c2', nome: 'Joana Lima', telefone: '21988887777' }] };
  S.D.papel = '__PAPEL__';
  const PRE = __PRESET__; if (PRE.br) S.br.push(...PRE.br);
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const tabela = t => ({ lin_clientes: S.cli, lin_movimentos: S.mov }[t] || []);
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
  const vari = id => { for (const p of S.D.produtos) for (const v of p.variantes) if (v.id === id) return { p, v }; };
  const controla = () => ['dono', 'estoque'].includes(S.D.papel);
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]),
    lin_brindes_ler: () => controla() ? ok(JSON.parse(JSON.stringify(S.br)).map(b => { if (S.D.papel !== 'dono') b.itens.forEach(i => delete i.custo_unitario); return b; }))
      : erro('Somente o Dono ou o Estoque vê os brindes'),
    lin_brinde_registrar: ({ p }) => {
      if (!controla()) return erro('Somente o Dono ou o Estoque registra brindes e presentes');
      for (const i of p.itens) { const e = est(i.variante_id, p.loja); if (!e || e[2] < i.quantidade) return erro('Estoque insuficiente'); }
      const id = S.br.length + 1;
      S.br.unshift({ id, data: p.data, loja_id: p.loja, motivo: p.motivo, destinatario: p.destinatario, cliente_id: p.cliente_id, observacao: p.observacao,
        criado_nome: 'Quem registrou', criado_em: new Date().toISOString(), cancelado_em: null,
        itens: p.itens.map(i => { const x = vari(i.variante_id); est(i.variante_id, p.loja)[2] -= i.quantidade;
          S.mov.push({ tipo: 'brinde', variante_id: i.variante_id, quantidade: i.quantidade, loja_id: p.loja, data: p.data, observacao: 'Presente', criado_em: new Date().toISOString() });
          return { variante_id: i.variante_id, quantidade: i.quantidade, referencia: x.p.referencia, descricao: x.p.descricao, cor: x.v.cor, tamanho: x.v.tamanho, edicao: x.v.edicao,
            preco_venda: x.p.preco_venda, custo_unitario: 150 }; }) });
      return ok(id);
    },
    lin_brinde_cancelar: ({ p_id, p_motivo }) => {
      if (S.D.papel !== 'dono') return erro('Só o Dono cancela um brinde');
      const b = S.br.find(x => x.id === p_id); b.cancelado_em = new Date().toISOString(); b.cancelado_nome = 'Dona'; b.cancelamento_motivo = p_motivo;
      b.itens.forEach(i => est(i.variante_id, b.loja_id)[2] += i.quantidade); return ok(null);
    },
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
  pg.on('pageerror', e => erros.push(String(e)));
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


const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });

    // ---------------------------------------------------------------- Estoque registra pelo quadrado
    const { pg, erros } = await pagina(ctx, 'estoque', false);
    ok(await pg.locator('#abaBrindes').count() === 1 && !(await pg.locator('#abaBrindes').evaluate(e => e.classList.contains('oculto'))), 'Estoque tem a aba Brindes');
    await pg.click('button.chip[data-v="v1"][data-l="l-gav"]'); await pg.waitForSelector('#dlg[open]'); await pg.waitForTimeout(300);
    await pg.click('#dlgf [data-g="tipo"][data-x="brinde"]'); await pg.waitForSelector('#dlg[open] #brok');
    ok((await pg.locator('#dlgf table').innerText()).includes('Vestido Mar') && await pg.locator('#dlgf [data-brg="loja"].on').innerText() === 'Gávea',
      '"Brinde / presente" ao movimentar abre o registro com a peça e a loja');
    await pg.click('#brok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('para quem'), 'para quem é obrigatório');
    await pg.fill('#brdest', '@influ.linho'); await pg.click('#dlgf [data-brg="motivo"][data-x="outro"]'); await pg.click('#brok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('Outro'), '"Outro" exige observação');
    await pg.click('#dlgf [data-brg="motivo"][data-x="divulgacao"]');
    await pg.fill('[data-brq="0"]', '9'); await pg.click('#brok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('só tem 5'), 'mais que o estoque: barrado na tela');
    await pg.fill('[data-brq="0"]', '2'); await pg.fill('#brobs', 'post no Instagram');
    pg.once('dialog', d => d.accept()); await pg.click('#brok'); await pg.waitForTimeout(500);
    const r1 = await ultimaRpc(pg, 'lin_brinde_registrar');
    ok(r1 && r1.p.loja === 'l-gav' && r1.p.motivo === 'divulgacao' && r1.p.destinatario === '@influ.linho' && r1.p.cliente_id === null && r1.p.data === hojeBR()
      && r1.p.observacao === 'post no Instagram' && r1.p.itens.length === 1 && r1.p.itens[0].quantidade === 2, 'manda motivo, para quem, loja, data, observação e peças');
    ok(await estoque(pg, 'v1', 'l-gav') === 3 && (await pg.locator('#msg').innerText()).includes('Divulgação nº 1 registrado'), 'peças saem do estoque e a tela avisa');

    // pela aba, com cliente do cadastro
    await aba(pg, '#abaBrindes'); await pg.waitForSelector('#brnovo');
    ok((await pg.locator('#tela').innerText()).includes('Nº 1 · Divulgação para @influ.linho') && !(await pg.locator('#tela').innerText()).includes('Custo'), 'lista com o registro; Estoque não vê custo');
    await pg.click('#brnovo'); await pg.waitForSelector('#dlg[open] #brqc');
    await pg.fill('#brqc', 'maria'); await pg.waitForTimeout(150);
    await pg.click('[data-brcli="c1"]'); await pg.waitForTimeout(100);
    ok((await pg.locator('#dlgf').innerText()).includes('Cliente do cadastro: Maria Souza'), 'escolhe a cliente do cadastro');
    await pg.fill('#brq', 'calca'); await pg.waitForTimeout(150); await pg.locator('#brres button').first().click(); await pg.waitForTimeout(100);
    pg.once('dialog', d => d.accept()); await pg.click('#brok'); await pg.waitForTimeout(500);
    const r2 = await ultimaRpc(pg, 'lin_brinde_registrar');
    ok(r2 && r2.p.motivo === 'presente' && r2.p.cliente_id === 'c1' && r2.p.destinatario === 'Maria Souza' && r2.p.itens[0].variante_id === 'v5', 'presente para a cliente do cadastro');
    const txt = await pg.locator('#tela').innerText();
    ok(txt.includes('Nº 2 · Presente para Maria Souza') && txt.includes('cliente do cadastro') && /Registros\s*2/.test(txt) && txt.includes('Por motivo'), 'lista, KPIs e quadro por motivo');
    ok(await pg.locator('[data-brcan]').count() === 0, 'Estoque não cancela');
    ok(await pg.locator('#brcsv').count() === 0, 'Estoque não baixa o CSV');
    await print(pg, 'brindes_estoque');
    ok(erros.length === 0, 'sem erro de JavaScript (Estoque) ' + erros.join(' | '));

    // ---------------------------------------------------------------- Dono: custo e cancelar
    const pre = { br: [{ id: 5, data: hojeBR(), loja_id: 'l-gav', motivo: 'presente', destinatario: 'Ana', cliente_id: null, observacao: '', criado_nome: 'Dona', criado_em: new Date().toISOString(),
      cancelado_em: null, itens: [{ variante_id: 'v1', quantidade: 1, referencia: 'VES-MAR', descricao: 'Vestido Mar', cor: 'Azul', tamanho: 'P', edicao: '', preco_venda: 489, custo_unitario: 150 }] }] };
    const d = await pagina(ctx, 'dono', false, pre);
    await aba(d.pg, '#abaBrindes'); await d.pg.waitForSelector('#brnovo');
    const td = await d.pg.locator('#tela').innerText();
    ok(td.includes('Custo das peças') && td.includes('150,00') && td.includes('489,00'), 'Dono vê o custo e o valor a preço de venda');
    const [dl] = await Promise.all([d.pg.waitForEvent('download'), d.pg.click('#brcsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.includes('Custo unitário') && csv.includes('"150,00"') && csv.includes('"Ana"'), 'Dono baixa o CSV, com o custo');
    await d.pg.click('[data-brcan="5"]'); await d.pg.waitForSelector('#brcok');
    await d.pg.click('#brcok'); await d.pg.waitForTimeout(150);
    ok((await d.pg.locator('#dlgf .msg.err').innerText()).includes('motivo'), 'cancelar exige motivo');
    await d.pg.fill('#brcm', 'registrado errado'); await d.pg.click('#brcok'); await d.pg.waitForTimeout(400);
    const c = await ultimaRpc(d.pg, 'lin_brinde_cancelar');
    ok(c && c.p_id === 5 && c.p_motivo === 'registrado errado' && (await d.pg.locator('#tela').innerText()).includes('Cancelado'), 'Dono cancela com motivo; fica marcado como cancelado');
    // Movimentações conhece os tipos novos
    await d.pg.evaluate(() => window.__S.mov.push({ id: 1, tipo: 'brinde', variante_id: 'v1', quantidade: 1, loja_id: 'l-gav', data: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), observacao: 'Presente nº 5 para Ana', criado_nome: 'Dona', criado_em: new Date().toISOString() }));
    await aba(d.pg, '#abaMovimentos'); await d.pg.waitForTimeout(400);
    const tm = await d.pg.locator('#tela').innerText();
    ok(tm.includes('Brinde / presente') && tm.includes('Presente nº 5 para Ana'), 'Movimentações mostram o brinde');
    ok(d.erros.length === 0, 'sem erro de JavaScript (Dono) ' + d.erros.join(' | '));

    // ---------------------------------------------------------------- vendedora
    const v = await pagina(ctx, 'vendedora', false);
    ok(await v.pg.locator('#abaBrindes').evaluate(e => e.classList.contains('oculto')), 'vendedora não tem a aba Brindes');
    ok(await v.pg.evaluate(() => !window.__S.rpc.some(x => /brinde/.test(x[0]))), 'vendedora não chama as funções do brinde');
    ok(v.erros.length === 0, 'sem erro de JavaScript (vendedora) ' + v.erros.join(' | '));

    // ---------------------------------------------------------------- celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const m = await pagina(cel, 'estoque', false);
    await aba(m.pg, '#abaBrindes'); await m.pg.waitForSelector('#brnovo');
    await m.pg.click('#brnovo'); await m.pg.waitForSelector('#dlg[open] #brok');
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: registro sem rolagem lateral');
    await print(m.pg, 'brindes_celular');
    ok(m.erros.length === 0, 'sem erro de JavaScript (celular) ' + m.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
