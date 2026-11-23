// Teste de tela da aba INÍCIO do Sistema Linum (versão 2.62) com o Playwright do Node e um Supabase IMITADO no navegador
// (que imita também a regra de leitura: quem não é Dono só lê as próprias vendas). Dados FICTÍCIOS.
// O ranking do que mais vende (lin_mais_vendidos) tem testes SQL ("linum 2.62").
// Uso: node testes/linum/tela_inicio_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8853;
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const dia = n => { const x = new Date(hoje + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dm = n => { const d = dia(n); return { aniversario_dia: +d.slice(8), aniversario_mes: +d.slice(5, 7) }; };

const DADOS = { papel: 'vendedora', minha_loja: 'l-ipa', comissao_pct: 0,
  lojas: [{ id: 'l-ipa', nome: 'Ipanema' }, { id: 'l-gav', nome: 'Gávea' }],
  produtos: [{ id: 'p1', referencia: 'A25', descricao: 'Vestido Artesanal', categoria: 'Vestido', preco_venda: 1799,
      variantes: [{ id: 'v1', cor: 'Natural', tamanho: 'G', edicao: '' }, { id: 'v2', cor: 'Preto', tamanho: 'M', edicao: '' }] },
    { id: 'p2', referencia: 'NOVA-2026-7', descricao: 'Blusa Nova', categoria: 'Blusa', preco_venda: 500, variantes: [{ id: 'w1', cor: 'Cru', tamanho: 'P', edicao: '' }] }],
  estoque: [['v1', 'l-ipa', 2], ['v2', 'l-ipa', 9], ['v1', 'l-gav', 0], ['w1', 'l-gav', 4]] };
const CLI = [
  Object.assign({ id: 'c1', nome: 'Ana Souza', telefone: '21999990001', proximo_contato: hoje, responsavel_id: 'u-vendedora', responsavel_nome: 'Rachel' }, dm(0)),
  Object.assign({ id: 'c2', nome: 'Bia Lima', telefone: '', proximo_contato: dia(-2), responsavel_id: 'u-outra', responsavel_nome: 'Meire' }, dm(3)),
  Object.assign({ id: 'c3', nome: 'Carla Dias', telefone: '' }, dm(20))];
const AJ = [{ id: 1, situacao: 'na_costureira', prazo: dia(-1), peca: 'A25 Vestido Artesanal Natural G', servico: 'Bainha', costureira: 'Dona Rosa', cliente_id: 'c1', loja_id: 'l-ipa', venda_id: 5 },
  { id: 2, situacao: 'pronto', prazo: dia(-3), peca: 'B10 Blusa Cru P', servico: 'Apertar lateral', costureira: 'Dona Rosa', cliente_id: 'c2', loja_id: 'l-gav', venda_id: 6 },
  { id: 3, situacao: 'na_costureira', prazo: dia(20), peca: 'C1 Calça', servico: 'Bainha', costureira: 'Dona Rosa', cliente_id: 'c3', loja_id: 'l-ipa', venda_id: 7 }];
const CD = [{ id: 11, tipo: 'malinha', situacao: 'aberta', prazo: dia(2), cliente_id: 'c2', loja_id: 'l-ipa' }, { id: 12, tipo: 'reserva', situacao: 'aberta', prazo: dia(20), cliente_id: 'c3', loja_id: 'l-gav' }];
const VD = [{ id: 5, data: hoje, loja_id: 'l-ipa', vendedora_id: 'u-vendedora', vendedora_nome: 'Rachel', valor_total: 300, pagamentos: [{ forma: 'credito', valor: 300 }], cancelada_em: null },
  { id: 6, data: hoje, loja_id: 'l-gav', vendedora_id: 'u-outra', vendedora_nome: 'Meire', valor_total: 500, pagamentos: [{ forma: 'pix', valor: 500 }], cancelada_em: null }];

const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, rpc: [], cli: ${JSON.stringify(CLI)}, aj: ${JSON.stringify(AJ)}, cd: ${JSON.stringify(CD)}, vd: ${JSON.stringify(VD)},
    bf: [{ id: 21, servico: 'Bordado', beneficiador: 'Ateliê X', previsto: '${dia(-4)}', loja_id: 'l-ipa', situacao: 'no_beneficiamento' }],
    tr: [{ id: 31, origem_id: 'l-gav', destino_id: 'l-ipa', situacao: 'em_transito' }],
    promos: [{ id: 41, nome: 'Black Friday', loja_id: null, inicio: '${dia(-3)}', fim: '${dia(4)}', cancelada_em: null }], pitens: [] };
  S.D.papel = '__PAPEL__';
  const eu = 'u-' + S.D.papel;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const tabela = t => ({ lin_clientes: S.cli, lin_ajustes: S.aj, lin_condicionais: S.cd, lin_vendas: S.vd.filter(v => S.D.papel === 'dono' || v.vendedora_id === eu),
    lin_beneficiamentos: ['dono', 'estoque'].includes(S.D.papel) ? S.bf : [], lin_transferencias: S.tr, lin_promocoes: S.promos, lin_promo_itens: S.pitens, lin_contatos: [] }[t] || []);
  const consulta = tab => { const f = []; let head = false, um = false;
    const q = { select: (c, o) => { head = !!(o && o.head); return q; }, order: () => q, limit: () => q, not: () => q,
      eq: (c, v) => { f.push(x => x[c] === v); return q; }, in: (c, v) => { f.push(x => v.includes(x[c])); return q; }, is: (c, v) => { f.push(x => (x[c] ?? null) === v); return q; },
      gte: (c, v) => { f.push(x => x[c] >= v); return q; }, lte: (c, v) => { f.push(x => x[c] <= v); return q; }, lt: (c, v) => { f.push(x => x[c] < v); return q; },
      or: () => q, maybeSingle: () => { if (tab === 'perfis') return ok({ admin: false }); um = true; return q; },
      range: (a, b) => ok(tabela(tab).filter(x => f.every(g => g(x))).slice(a, b + 1)),
      then: (r, j) => { const l = tabela(tab).filter(x => f.every(g => g(x)));
        return Promise.resolve(head ? { data: null, count: l.length, error: null } : { data: um ? (l[0] || null) : l, error: null }).then(r, j); } };
    return q; };
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }), lin_minhas_permissoes: () => ok({}),
    lin_benef_no_estoque: () => ok([]), lin_cond_no_estoque: () => ok([]), lin_creditos_saldos: () => ok({}),
    lin_vendas_sem_cliente: () => ok([{ id: 5 }]),
    lin_cliente_credito: () => ok({ saldo: 0, extrato: [] }), lin_costureiras: () => ok([]),
    lin_mais_vendidos: ({ p_dias }) => ['dono', 'estoque'].includes(S.D.papel) ? ok({ de: '', pecas: p_dias === 90 ? 40 : 12, cores: [{ cor: 'Natural', pecas: 7 }, { cor: 'Preto', pecas: 5 }],
      tamanhos: [{ tamanho: 'M', pecas: 6 }, { tamanho: 'G', pecas: 4 }], produtos: [{ referencia: 'A25', descricao: 'Vestido Artesanal', pecas: 8 }] }) : erro('Só a Dona e o Estoque veem o que mais vende'),
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
  await pg.waitForSelector('#app:not(.oculto)'); await pg.waitForSelector('#inniver', { timeout: 10000 });
  return { pg, erros };
}
const txt = (pg, s) => pg.locator(s).count().then(c => c ? pg.locator(s).innerText() : '');

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
    // ---------------- vendedora
    const v = await pagina(ctx, 'vendedora');
    ok(await v.pg.locator('#abaInicio.on').count() === 1 && await v.pg.locator('.barra .grupo[data-g="inicio"].on').count() === 1, 'o app abre na aba Início');
    const niver = await txt(v.pg, '#inniver');
    ok(niver.includes('Ana Souza') && niver.includes('hoje') && niver.includes('Bia Lima') && !niver.includes('Carla'), 'aniversários dos próximos 7 dias (hoje marcado), sem os de depois');
    ok((await txt(v.pg, '#invendas')).includes('Suas vendas hoje') && (await txt(v.pg, '#invendas')).includes('300,00') && !(await txt(v.pg, '#invendas')).includes('800,00'), 'vendedora vê só as próprias vendas de hoje');
    const ag = await txt(v.pg, '#inagenda');
    ok(ag.includes('Ana Souza') && !ag.includes('Bia Lima'), 'vendedora vê só as clientes que ela acompanha para contatar');
    const aj = await txt(v.pg, '#inajustes');
    ok(aj.includes('Bainha') && aj.includes('atrasado') && aj.includes('pronto') && !aj.includes('C1 Calça'), 'ajustes: atrasado, vencendo na semana e prontos; não os de depois');
    ok(await v.pg.locator('#inajustes.alerta').count() === 1, 'ajuste atrasado destaca o quadro');
    const cd = await txt(v.pg, '#incond');
    ok(cd.includes('Malinha nº 11') && cd.includes('Bia Lima') && !cd.includes('nº 12'), 'malinhas e reservas vencendo na semana');
    const eb = await txt(v.pg, '#inbaixo');
    ok(eb.includes('A25') && eb.includes('Natural G') && !eb.includes('Preto M') && !eb.includes('Blusa Nova'), 'estoque baixo da loja da vendedora (Ipanema): 1 a 5 peças, sem a de 9');
    await v.pg.click('[data-inloja=""]'); await v.pg.waitForSelector('#inbaixo');
    ok((await txt(v.pg, '#inbaixo')).includes('Blusa Nova') && (await txt(v.pg, '#inbaixo')).includes('(Gávea)'), 'filtro Todas as lojas mostra as duas, com a loja');
    ok((await txt(v.pg, '#intransf')).includes('1 para Ipanema'), 'transferência em trânsito para a loja dela');
    ok((await txt(v.pg, '#inpromo')).includes('Black Friday') && (await txt(v.pg, '#inpromo')).includes('termina'), 'promoção que termina nesta semana');
    ok((await txt(v.pg, '#incompletar')).includes('sem a cliente') && (await txt(v.pg, '#incompletar')).includes('sem o CV'), 'vendas para completar: sem cliente e cartão sem CV');
    ok(await v.pg.locator('#inmais, #inbenef, #inprov').count() === 0 && !(await v.pg.evaluate(() => window.__S.rpc.some(r => r[0] === 'lin_mais_vendidos'))),
      'vendedora não vê o que mais vende, beneficiamento nem referências provisórias');
    if (SAIDA) await v.pg.screenshot({ path: path.join(SAIDA, 'inicio_vendedora.png'), fullPage: true });
    await v.pg.locator('#inniver [data-incli="c1"]').click(); await v.pg.waitForTimeout(400);
    ok(await v.pg.evaluate(() => document.getElementById('dlg').open) && (await v.pg.locator('#dlg').innerText()).includes('Ana Souza'), 'clicar na aniversariante abre a ficha dela');
    await v.pg.evaluate(() => document.getElementById('dlg').close());
    await v.pg.locator('#inbaixo [data-inpeca="p1"]').click(); await v.pg.waitForSelector('#lista');
    ok(await v.pg.inputValue('#fq') === 'A25' && await v.pg.locator('#lista .prod').count() === 1, 'clicar na peça do estoque baixo abre o Estoque já filtrado');
    ok(v.erros.length === 0, 'sem erro de JavaScript (vendedora) ' + v.erros.join(' | '));

    // ---------------- Dona
    const d = await pagina(ctx, 'dono');
    ok((await txt(d.pg, '#invendas')).includes('Vendas de hoje') && (await txt(d.pg, '#invendas')).includes('800,00') && (await txt(d.pg, '#invendas')).includes('Gávea'), 'Dona vê todas as vendas de hoje, por loja');
    const agd = await txt(d.pg, '#inagenda');
    ok(agd.includes('Bia Lima') && agd.includes('atrasado') && agd.includes('Meire'), 'Dona vê todos os contatos, com quem acompanha');
    await d.pg.waitForSelector('#inmais');
    const m = await txt(d.pg, '#inmais');
    ok(m.includes('Natural') && m.includes('M') && m.includes('Vestido Artesanal') && m.includes('12 peça'), 'o que mais vende: cores, tamanhos e peças (30 dias)');
    await d.pg.click('[data-indias="90"]'); await d.pg.waitForSelector('#inmais');
    ok((await txt(d.pg, '#inmais')).includes('40 peça') && (await d.pg.evaluate(() => window.__S.rpc.filter(r => r[0] === 'lin_mais_vendidos').pop()[1].p_dias)) === 90, 'botão 90 dias');
    ok((await txt(d.pg, '#inbenef')).includes('Bordado') && (await txt(d.pg, '#inprov')).includes('NOVA-2026-7'), 'Dona vê beneficiamento atrasado e referências provisórias');
    if (SAIDA) await d.pg.screenshot({ path: path.join(SAIDA, 'inicio_dona.png'), fullPage: true });
    await d.pg.locator('#inajustes [data-inaj="1"]').click(); await d.pg.waitForTimeout(500);
    ok(await d.pg.evaluate(() => document.getElementById('dlg2').open), 'clicar no ajuste abre a ficha do ajuste');
    ok(d.erros.length === 0, 'sem erro de JavaScript (Dona) ' + d.erros.join(' | '));

    // ---------------- Estoque
    const e = await pagina(ctx, 'estoque');
    await e.pg.waitForSelector('#inmais');
    ok(await e.pg.locator('#inmais').count() === 1 && await e.pg.locator('#inbenef').count() === 1, 'Estoque vê o que mais vende e o beneficiamento');
    ok((await txt(e.pg, '#invendas')).includes('Suas vendas hoje'), 'Estoque vê só as próprias vendas');
    ok(e.erros.length === 0, 'sem erro de JavaScript (Estoque) ' + e.erros.join(' | '));

    // ---------------- celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await pagina(cel, 'dono'); await c.pg.waitForSelector('#inmais');
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral');
    if (SAIDA) await c.pg.screenshot({ path: path.join(SAIDA, 'inicio_celular.png'), fullPage: true });
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
