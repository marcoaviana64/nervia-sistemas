// Teste de tela da ficha com vídeos para mostrar à cliente (Sistema Linum 2.49) com o Playwright do Node e um Supabase
// IMITADO no navegador (inclusive a função linum-videos). Dados FICTÍCIOS; o vídeo do Google Drive não é carregado de
// verdade (o iframe é trocado por uma página vazia). As regras do banco estão nos testes SQL ("linum 2.49").
// Confere: botão "Mostrar à cliente" só no produto com pasta; ficha com vídeos em ordem, player do Drive, cores,
// tamanhos com peça (sem quantidade nem custo), cor escolhida traz o vídeo dela primeiro; erro da pasta aparece;
// campo da pasta no cadastro (Estoque) grava pela lin_produto_video_salvar; celular sem rolagem lateral.
// Uso: node testes/linum/tela_videos_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8837;

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
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [], fn: [], videos: { p1: 'https://drive.google.com/drive/folders/PastaVestidoMar' } };
  S.D.papel = '__PAPEL__';
  S.arquivos = __ARQ__;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const consulta = tab => { const q = { select: () => q, order: () => q, limit: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, or: () => q,
      maybeSingle: () => tab === 'perfis' ? ok({ admin: false }) : ok(null), range: () => ok([]), then: (r, j) => Promise.resolve({ data: [], error: null }).then(r, j) };
    return q; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]),
    lin_videos_produtos: () => ok(S.videos),
    lin_catalogo: () => ok({ produtos: S.D.produtos.map(p => ({ id: p.id, referencia: p.referencia, descricao: p.descricao, categoria: p.categoria, preco_venda: p.preco_venda, ativo: true })),
      variantes: S.D.produtos.flatMap(p => p.variantes.map(v => ({ ...v, produto_id: p.id, ativo: true }))) }),
    lin_produto_salvar: ({ p }) => ok(p.id),
    lin_produto_video_salvar: ({ p_produto, p_url }) => { if (p_url) S.videos[p_produto] = p_url; else delete S.videos[p_produto]; return ok(null); },
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-' + S.D.papel } } } }) },
    from: tab => consulta(tab),
    functions: { invoke: async (nome, { body }) => { S.fn.push([nome, body]);
      if (S.arquivos === 'erro') return { data: null, error: { message: 'x', context: { json: async () => ({ ok: false, mensagem: 'O Google Drive recusou o acesso (403). Confira se a pasta está compartilhada.' }) } } };
      return { data: { ok: true, arquivos: S.arquivos }, error: null }; } },
    rpc: async (fn, args) => { S.rpc.push([fn, args]); return fns[fn] ? fns[fn](args || {}) : { data: null, error: null }; } }) };
})();`;
const ARQ = [{ id: 'f1', nome: '01 natural', tipo: 'video', chave: '' }, { id: 'f2', nome: '02 azul', tipo: 'video', chave: '' }, { id: 'f3', nome: 'capa', tipo: 'foto', chave: 'rk' }];

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
  const corpo = FALSO.replace('__PAPEL__', papel).replace('__ARQ__', JSON.stringify(preset === undefined ? ARQ : preset));
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



(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('https://drive.google.com/**', r => r.fulfill({ body: '<html><body>player</body></html>', contentType: 'text/html' }));
    const { pg, erros } = await pagina(ctx, 'vendedora', false);
    ok(await pg.locator('[data-vid]').count() === 1 && await pg.locator('[data-vid="p1"]').count() === 1, 'botão "Mostrar à cliente" só no produto com pasta de vídeos');
    await pg.click('[data-vid="p1"]'); await pg.waitForSelector('#dlg[open].vitrine iframe');
    const src1 = await pg.getAttribute('#dlgf iframe', 'src');
    ok(src1 === 'https://drive.google.com/file/d/f1/preview', 'abre o primeiro vídeo no player do Google Drive');
    const fn = await pg.evaluate(() => window.__S.fn[0]);
    ok(fn && fn[0] === 'linum-videos' && fn[1].produto === 'p1', 'pede a lista à função linum-videos com o produto');
    const txt = await pg.locator('#dlgf').innerText();
    ok(txt.includes('Vestido Mar') && txt.includes('489,00') && txt.includes('01 natural') && txt.includes('capa'), 'ficha com nome, preço e a lista de vídeos e fotos');
    ok(!/un\./.test(txt) && !/custo/i.test(txt) && !/Gávea|Ipanema/.test(txt), 'nada interno na ficha: sem quantidades, custo nem loja');
    ok(await pg.locator('#dlgf .vtam').allInnerTexts().then(t => t.join(',')) === 'P,M', 'tamanhos com peça na loja (sem dizer quantas)');
    await pg.click('#dlgf [data-vcor="Azul"]'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .vlista button').first().innerText()).includes('02 azul') && (await pg.getAttribute('#dlgf iframe', 'src')).includes('/f2/'), 'escolher a cor traz o vídeo dela primeiro');
    await pg.click('#dlgf [data-vd="2"]'); await pg.waitForTimeout(150);
    ok((await pg.getAttribute('#dlgf iframe', 'src')) === 'https://drive.google.com/file/d/f3/preview?resourcekey=rk', 'tocar na foto mostra a foto (com a chave da pasta antiga)');
    await print(pg, 'videos_ficha');
    await pg.click('#vdx'); await pg.waitForTimeout(150);
    ok(!(await pg.locator('#dlg').evaluate(d => d.open)) && !(await pg.locator('#dlg').evaluate(d => d.classList.contains('vitrine'))), 'Fechar fecha a ficha');
    ok(erros.length === 0, 'sem erro de JavaScript (vendedora) ' + erros.join(' | '));

    // pasta com problema: a mensagem aparece na ficha
    const e = await pagina(ctx, 'vendedora', false, 'erro');
    await e.pg.click('[data-vid="p1"]'); await e.pg.waitForSelector('#dlg[open] .msg.err');
    ok((await e.pg.locator('#dlgf .msg.err').innerText()).includes('compartilhada'), 'erro da pasta aparece na ficha');
    // pasta vazia
    const z = await pagina(ctx, 'vendedora', false, []);
    await z.pg.click('[data-vid="p1"]'); await z.pg.waitForSelector('#dlg[open] .vvazio');
    await z.pg.waitForTimeout(200);
    ok((await z.pg.locator('#dlgf .vvazio').innerText()).includes('ainda não tem vídeos'), 'pasta vazia avisa');

    // cadastro: Estoque cola o link no Editar peça
    const s = await pagina(ctx, 'estoque', false);
    await aba(s.pg, '#abaProdutos'); await s.pg.waitForTimeout(300);
    await s.pg.evaluate(() => editarProduto('p2')); await s.pg.waitForSelector('#dlg[open] #pf_video_pasta');
    ok(await s.pg.inputValue('#pf_video_pasta') === '', 'produto sem pasta: campo vazio');
    await s.pg.fill('#pf_video_pasta', 'https://drive.google.com/drive/folders/PastaCalca'); await s.pg.click('#pfs'); await s.pg.waitForTimeout(400);
    const sv = await s.pg.evaluate(() => window.__S.rpc.filter(x => x[0] === 'lin_produto_video_salvar').pop());
    ok(sv && sv[1].p_produto === 'p2' && sv[1].p_url === 'https://drive.google.com/drive/folders/PastaCalca', 'salvar o produto grava a pasta de vídeos');
    await s.pg.evaluate(() => editarProduto('p1')); await s.pg.waitForSelector('#dlg[open] #pf_video_pasta');
    ok(await s.pg.inputValue('#pf_video_pasta') === 'https://drive.google.com/drive/folders/PastaVestidoMar', 'produto com pasta: o link aparece no campo');
    await s.pg.click('#pfs'); await s.pg.waitForTimeout(300);
    ok(await s.pg.evaluate(() => window.__S.rpc.filter(x => x[0] === 'lin_produto_video_salvar').length) === 1, 'sem mudança no link, não grava de novo');
    ok(s.erros.length === 0, 'sem erro de JavaScript (Estoque) ' + s.erros.join(' | '));

    // celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await cel.route('https://drive.google.com/**', r => r.fulfill({ body: '<html><body>player</body></html>', contentType: 'text/html' }));
    const m = await pagina(cel, 'vendedora', false);
    await m.pg.click('[data-vid="p1"]'); await m.pg.waitForSelector('#dlg[open].vitrine iframe');
    ok(await m.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: ficha sem rolagem lateral');
    await print(m.pg, 'videos_celular');
    ok(m.erros.length === 0, 'sem erro de JavaScript (celular) ' + m.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
