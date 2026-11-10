// Teste de tela do Beneficiamento do Sistema Linum (versão 2.38) com o Playwright do Node e um Supabase IMITADO no
// navegador (estoque, lin_beneficiamento_*, lin_variante_salvar). Dados FICTÍCIOS. As regras do banco estão nos testes SQL
// (testes/teste_sql.sql, "linum 2.38"); aqui confere a tela e o que ela manda ao servidor.
// Confere: aba só para Dono e Estoque (2.42; a vendedora vê só a marca ⟳ no Estoque, com o aviso ao apontar o mouse); "Beneficiamento" ao movimentar a peça abre o
// envio; serviço e quem faz obrigatórios; envio maior que o estoque barrado; valor por peça só com "Valores da produção";
// retorno parcial (igual + peça especial escolhida), perda exige motivo, nova peça especial criada na hora, loja de entrada,
// concluído; Valor pago; Movimentações com os tipos novos; celular sem rolagem lateral.
// Uso: node testes/linum/tela_beneficiamento_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8834;

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

// "servidor" imitado: guarda o estado no window e aplica as mesmas regras básicas das funções do banco
const FALSO = `(() => {
  const S = window.__S = { D: ${JSON.stringify(DADOS)}, bf: [], it: [], rt: [], val: [], mov: [], rpc: [], perm: __PERM__ };
  S.D.papel = '__PAPEL__';
  const PRE = __PRESET__; if (PRE.bf) S.bf.push(...PRE.bf); if (PRE.it) S.it.push(...PRE.it); if (PRE.estoque) S.D.estoque = PRE.estoque;
  const ok = data => Promise.resolve({ data, error: null }), erro = m => Promise.resolve({ data: null, error: { message: m } });
  const tabela = t => ({ lin_beneficiamentos: S.bf, lin_benef_itens: S.it, lin_benef_retornos: S.rt, lin_benef_valores: S.perm.producao_valores ? S.val : [], lin_movimentos: S.mov }[t] || []);
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
  const agora = () => new Date().toISOString();
  const fns = {
    lin_estoque_ler: () => ok(JSON.parse(JSON.stringify(S.D))),
    lin_meu_horario: () => ok({ liberado: true }),
    lin_minhas_permissoes: () => ok(S.perm),
    lin_beneficiamento_enviar: ({ p }) => {
      if (!['dono', 'estoque'].includes(S.D.papel)) return erro('Somente o Dono ou o Estoque envia peças para o beneficiamento');
      for (const i of p.itens) { const e = est(i.variante_id, p.loja); if (!e || e[2] < i.quantidade) return erro('Estoque insuficiente'); }
      if (p.itens.some(i => i.valor_unitario != null) && !S.perm.producao_valores) return erro('Seu login não registra valores do beneficiamento');
      const id = S.bf.length + 1;
      S.bf.push({ id, loja_id: p.loja, beneficiador: p.beneficiador, servico: p.servico, previsto: p.previsto || null, vai_virar: p.vai_virar || '', observacao: p.observacao,
        situacao: 'no_beneficiamento', enviado_nome: 'Edu Estoque', enviado_em: agora(), concluido_em: null });
      for (const i of p.itens) {
        est(i.variante_id, p.loja)[2] -= i.quantidade;
        const x = vari(i.variante_id), iid = S.it.length + 1;
        S.it.push({ id: iid, beneficiamento_id: id, variante_id: i.variante_id, quantidade: i.quantidade, voltaram: 0, perdidas: 0,
          referencia: x.p.referencia, descricao: x.p.descricao, cor: x.v.cor, tamanho: x.v.tamanho, edicao: x.v.edicao });
        if (i.valor_unitario != null) S.val.push({ item_id: iid, valor_unitario: i.valor_unitario });
        S.mov.push({ tipo: 'benef_envio', variante_id: i.variante_id, quantidade: i.quantidade, loja_id: p.loja });
      }
      return ok(id);
    },
    lin_beneficiamento_retorno: ({ p_id, p }) => {
      const b = S.bf.find(x => x.id === p_id);
      for (const r of p.itens) {
        const it = S.it.find(x => x.id === r.item_id);
        if (r.resultado === 'perda') { it.perdidas += r.quantidade; S.rt.push({ id: S.rt.length + 1, beneficiamento_id: p_id, item_id: it.id, resultado: 'perda', quantidade: r.quantidade, motivo: r.motivo, cor: '', tamanho: '', edicao: '', loja_id: null, criado_em: agora(), criado_nome: 'Edu' }); continue; }
        const v = r.resultado === 'igual' ? it.variante_id : r.variante_id, x = vari(v);
        it.voltaram += r.quantidade; somar(v, p.loja, r.quantidade);
        S.rt.push({ id: S.rt.length + 1, beneficiamento_id: p_id, item_id: it.id, resultado: r.resultado, quantidade: r.quantidade, variante_id: v, loja_id: p.loja,
          cor: x.v.cor, tamanho: x.v.tamanho, edicao: x.v.edicao, motivo: '', criado_em: agora(), criado_nome: 'Edu' });
        S.mov.push({ tipo: 'benef_retorno', variante_id: v, quantidade: r.quantidade, loja_id: p.loja });
      }
      const fim = S.it.filter(x => x.beneficiamento_id === p_id).every(x => x.voltaram + x.perdidas === x.quantidade);
      if (fim) { b.situacao = 'concluido'; b.concluido_em = agora(); }
      return ok(fim ? 'concluido' : 'no_beneficiamento');
    },
    lin_beneficiamento_valores: ({ p_itens }) => { for (const v of p_itens) { S.val = S.val.filter(x => x.item_id !== v.item_id); if (v.valor_unitario !== '') S.val.push(v); } return ok(null); },
    lin_benef_no_estoque: () => { const m = new Map();
      for (const i of S.it) { const b = S.bf.find(x => x.id === i.beneficiamento_id), pend = i.quantidade - i.voltaram - i.perdidas;
        if (!b || b.situacao !== 'no_beneficiamento' || pend <= 0) continue;
        const k = i.variante_id + ':' + b.loja_id, x = m.get(k) || { variante_id: i.variante_id, loja_id: b.loja_id, pecas: 0, itens: [] };
        x.pecas += pend; x.itens.push({ servico: b.servico, vai_virar: b.vai_virar || '', previsto: b.previsto, pecas: pend }); m.set(k, x); }
      return ok([...m.values()]); },
    lin_beneficiamento_editar: ({ p_id, p_previsto, p_vai_virar }) => { const b = S.bf.find(x => x.id === p_id); b.previsto = p_previsto; b.vai_virar = p_vai_virar; return ok(null); },
    lin_variante_salvar: ({ p }) => { const pr = S.D.produtos.find(x => x.id === p.produto_id); const id = 'v' + (100 + S.rpc.length);
      pr.variantes.push({ id, cor: p.cor, tamanho: p.tamanho, edicao: p.edicao }); return ok(id); },
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
  const corpo = FALSO.replace('__PAPEL__', papel).replace('__PERM__', JSON.stringify({ producao: !!valores, producao_valores: !!valores })).replace('__PRESET__', JSON.stringify(preset || {}));
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

    // ---------------------------------------------------------------- Estoque: envia (sem valor)
    const { pg, erros } = await pagina(ctx, 'estoque', false);
    ok(await pg.locator('#abaBenef').count() === 1, 'aba Beneficiamento existe no grupo Estoque');
    // pelo quadrado do Estoque → Movimentar → Beneficiamento
    await pg.click('button.chip[data-v="v1"][data-l="l-gav"]'); await pg.waitForSelector('#dlg[open]'); await pg.waitForTimeout(300);
    await pg.click('#dlgf [data-g="tipo"][data-x="beneficiamento"]'); await pg.waitForSelector('#dlg[open] #bfquem');
    ok((await pg.locator('#dlgf table').innerText()).includes('Vestido Mar') && await pg.locator('#dlgf [data-bfl].on').innerText() === 'Gávea',
      '"Beneficiamento" ao movimentar abre o envio com a peça e a loja');
    ok(await pg.locator('[data-bfv]').count() === 0, 'Estoque sem "Valores da produção": sem campo de valor');
    await pg.click('#bfok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('quem vai fazer'), 'quem faz é obrigatório');
    await pg.fill('#bfquem', 'Ateliê Flor'); await pg.click('#bfok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('serviço'), 'serviço é obrigatório');
    await pg.fill('#bfserv', 'bordado à mão'); await pg.fill('#bfvirar', 'peça especial bordada');
    await pg.fill('[data-bfq="0"]', '9'); await pg.click('#bfok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('só tem 5'), 'mais que o estoque: barrado na tela');
    await pg.fill('[data-bfq="0"]', '4');
    await pg.fill('#bfq', 'calca'); await pg.waitForTimeout(150);
    await pg.locator('#bfres button').first().click(); await pg.waitForTimeout(100);
    await pg.fill('[data-bfq="1"]', '1'); await pg.fill('#bfobs', 'flores na barra');
    pg.once('dialog', d => d.accept()); await pg.click('#bfok'); await pg.waitForTimeout(500);
    const env = await ultimaRpc(pg, 'lin_beneficiamento_enviar');
    ok(env && env.p.loja === 'l-gav' && env.p.beneficiador === 'Ateliê Flor' && env.p.servico === 'bordado à mão' && env.p.itens.length === 2
       && env.p.itens[0].quantidade === 4 && !('valor_unitario' in env.p.itens[0]) && env.p.vai_virar === 'peça especial bordada', 'envio manda loja, quem faz, serviço, vai virar e peças (sem valor)');
    ok(await estoque(pg, 'v1', 'l-gav') === 1 && (await pg.locator('#msg').innerText()).includes('Beneficiamento nº 1'), 'peças saem do estoque; mensagem com o número');
    ok((await pg.locator('#abaBenef').innerText()).trim().endsWith('1'), 'número na aba');
    // 2.40: depois do envio, a ficha abre sozinha (para imprimir e mandar junto com as peças)
    await pg.waitForSelector('#dlg[open] #bffimp');
    let fic = await pg.locator('#dlgf').innerText();
    ok(fic.includes('Beneficiamento nº 1') && fic.includes('bordado à mão') && fic.includes('Ateliê Flor') && fic.includes('Enviado para Ateliê Flor') && fic.includes('Próximo: registrar a volta de 5 peça(s)'),
      'ficha abre depois do envio: serviço, quem faz, andamento e próximo passo');
    ok(!/R\$/.test(fic) && await pg.locator('#bffval').count() === 0, 'ficha do Estoque sem valor');
    ok(fic.includes('Vai virar') && fic.includes('peça especial bordada'), 'ficha mostra o que a peça vai virar');
    // 2.42: editar a previsão pela ficha
    await pg.click('#bffedit'); await pg.waitForSelector('#dlg[open] #bevir');
    await pg.fill('#bepre', '2099-11-30'); await pg.fill('#bevir', 'peça especial bordada à mão'); await pg.click('#beok'); await pg.waitForSelector('#dlg[open] #bffimp');
    const ed = await ultimaRpc(pg, 'lin_beneficiamento_editar');
    ok(ed && ed.p_id === 1 && ed.p_previsto === '2099-11-30' && ed.p_vai_virar === 'peça especial bordada à mão'
       && (await pg.locator('#dlgf').innerText()).includes('peça especial bordada à mão'), '"Editar previsão" grava a volta e o vai virar e volta para a ficha');
    const [pop] = await Promise.all([pg.context().waitForEvent('page'), pg.click('#bffimp')]);
    await pop.waitForLoadState(); const imp = await pop.evaluate(() => document.body.innerText); await pop.close();
    ok(imp.includes('Beneficiamento nº 1') && imp.includes('Ateliê Flor') && imp.includes('Recebido por Ateliê Flor') && imp.includes('Andamento') && !imp.includes('R$'), 'ficha impressa para ir com as peças (sem valor para o Estoque)');
    await pg.click('#bffx');
    const tit = await pg.getAttribute('button.chip[data-v="v1"][data-l="l-gav"]', 'title');
    ok(await pg.locator('button.chip.bf[data-v="v1"][data-l="l-gav"]').count() === 1 && tit.includes('No beneficiamento: 4 peça(s)') && tit.includes('vai virar: peça especial bordada à mão') && tit.includes('volta prevista 30/11'),
      'Estoque: o quadrado da peça ganha a marca ⟳ e o aviso com peças fora, vai virar e volta prevista');

    // ---------------------------------------------------------------- aba Beneficiamento + retorno
    await aba(pg, '#abaBenef'); await pg.waitForSelector('[data-bfret]');
    const card = await pg.locator('[data-bf="1"]').innerText();
    ok(card.includes('Nº 1 · bordado à mão · Ateliê Flor') && card.includes('4× Vestido Mar') && card.includes('Saiu de Gávea'), 'cartão do beneficiamento');
    ok(await pg.locator('[data-bfval]').count() === 0 && !/R\$/.test(await pg.locator('#tela').innerText()), 'Estoque não vê valor');
    await print(pg, 'benef_lista');
    await pg.click('[data-bfret="1"]'); await pg.waitForSelector('#dlg[open] #rbok');
    // vestido: 1 igual + 2 viram a bordada (existente); calça: perdida sem motivo → erro
    await pg.click('#dlgf [data-rbl]:has-text("Ipanema")');
    await pg.fill('[data-rbf="igual"][data-k="0"]', '1');
    await pg.fill('[data-rbf="outra"][data-k="0"]', '2'); await pg.dispatchEvent('[data-rbf="outra"][data-k="0"]', 'change'); await pg.waitForTimeout(100);
    const ops = await pg.locator('select[data-rbf="alvo"] option').allInnerTexts();
    ok(ops[1] === '★ Azul P Bordada' && ops.includes('Azul M') && !ops.some(o => o === 'Azul P'), 'virou qual: outras variações da mesma peça, especiais primeiro');
    await pg.click('#rbok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('escolha em que peça'), 'virou outra sem escolher: barrado');
    await pg.selectOption('select[data-rbf="alvo"]', 'v3');
    await pg.fill('[data-rbf="perda"][data-k="1"]', '1'); await pg.dispatchEvent('[data-rbf="perda"][data-k="1"]', 'change'); await pg.waitForTimeout(100);
    await pg.click('#rbok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlgf .msg.err').innerText()).includes('peça perdida'), 'perda sem motivo: barrada');
    await pg.fill('[data-rbf="perda"][data-k="1"]', '0'); await pg.dispatchEvent('[data-rbf="perda"][data-k="1"]', 'change'); await pg.waitForTimeout(100);
    ok(await pg.inputValue('[data-rbf="outra"][data-k="0"]') === '2' && await pg.inputValue('select[data-rbf="alvo"]') === 'v3', 'redesenhar mantém o que foi digitado');
    await print(pg, 'benef_retorno');
    pg.once('dialog', d => d.accept()); await pg.click('#rbok'); await pg.waitForTimeout(500);
    const ret = await ultimaRpc(pg, 'lin_beneficiamento_retorno');
    ok(ret && ret.p.loja === 'l-ipa' && JSON.stringify(ret.p.itens) === JSON.stringify([{ item_id: 1, resultado: 'igual', quantidade: 1 }, { item_id: 1, resultado: 'outra', quantidade: 2, variante_id: 'v3' }]),
      'retorno parcial manda igual + outra (com a variação) para Ipanema');
    ok(await estoque(pg, 'v3', 'l-ipa') === 2 && await estoque(pg, 'v1', 'l-ipa') === 1 && (await pg.locator('#msg').innerText()).includes('Ainda há peças fora'),
      'peças entram em Ipanema; ainda há peças fora');
    const card2 = await pg.locator('[data-bf="1"]').innerText();
    ok(card2.includes('virou Azul P Bordada') && card2.includes('voltou igual') && card2.includes('fora 1'), 'cartão mostra os retornos e o que falta');
    // segundo retorno: vestido vira peça especial NOVA; calça perdida com motivo → concluído
    await pg.click('[data-bfret="1"]'); await pg.waitForSelector('#dlg[open] #rbok');
    await pg.fill('[data-rbf="outra"][data-k="0"]', '1'); await pg.dispatchEvent('[data-rbf="outra"][data-k="0"]', 'change'); await pg.waitForTimeout(100);
    await pg.click('[data-rbnova="0"]'); await pg.waitForSelector('#dlg2[open] #need');
    ok(await pg.inputValue('#necor') === 'Azul' && await pg.inputValue('#netam') === 'P', 'nova peça especial já vem com a cor e o tamanho enviados');
    await pg.click('#neok'); await pg.waitForTimeout(150);
    ok((await pg.locator('#dlg2f .msg.err').innerText()).includes('edição'), 'edição obrigatória');
    await pg.fill('#need', 'Tingida'); await pg.fill('#necor', 'Marinho'); await pg.fill('#nepre', '590,00');
    await pg.click('#neok'); await pg.waitForTimeout(400);
    const nova = await ultimaRpc(pg, 'lin_variante_salvar');
    ok(nova && nova.p.produto_id === 'p1' && nova.p.edicao === 'Tingida' && nova.p.cor === 'Marinho' && nova.p.preco_venda === '590.00' && nova.p.preco_custo === '',
      'cria a peça especial pela mesma função do cadastro (sem custo)');
    ok(!(await pg.locator('#dlg2').isVisible()) && (await pg.locator('select[data-rbf="alvo"] option:checked').innerText()) === '★ Marinho P Tingida', 'a nova peça já fica escolhida');
    await pg.fill('[data-rbf="perda"][data-k="1"]', '1'); await pg.dispatchEvent('[data-rbf="perda"][data-k="1"]', 'change'); await pg.waitForTimeout(100);
    await pg.fill('[data-rbf="motivo"][data-k="1"]', 'manchou no bordado');
    pg.once('dialog', d => d.accept()); await pg.click('#rbok'); await pg.waitForTimeout(500);
    ok((await pg.locator('#msg').innerText()).includes('Beneficiamento concluído') && (await pg.locator('#tela').innerText()).includes('Nenhuma peça no beneficiamento'),
      'tudo voltou ou perdido: concluído');
    ok((await pg.locator('#abaBenef').innerText()).trim() === 'Beneficiamento', 'sem número na aba');
    await pg.click('[data-fbf="concluido"]'); await pg.waitForSelector('[data-bf="1"]');
    const card3 = await pg.locator('[data-bf="1"]').innerText();
    ok(card3.includes('Concluído') && card3.includes('virou Marinho P Tingida') && card3.includes('manchou no bordado'), 'concluído mostra a peça especial nova e a perda');
    await pg.click('[data-bf="1"] [data-bfficha] >> nth=0'); await pg.waitForSelector('#dlg[open] .ajlinha');
    const and = await pg.locator('#dlgf .ajlinha li').allInnerTexts();
    ok(and.length === 6 && and[0].startsWith('Enviado para Ateliê Flor') && and.some(x => x.includes('voltou como Azul P Bordada → Ipanema')) && and.some(x => x.includes('perdida') && x.includes('manchou no bordado'))
       && and[5].startsWith('Concluído') && await pg.locator('#bffret').count() === 0, 'ficha do concluído: envio, cada volta, a perda e o fim, sem "Registrar retorno"');
    await print(pg, 'benef_ficha');
    await pg.click('#bffx');

    // ---------------------------------------------------------------- Movimentações mostram os tipos novos
    const tipos = await pg.evaluate(() => [MV_TIPO.benef_envio, MV_TIPO.benef_retorno, mvEfeito({ tipo: 'benef_envio', quantidade: 3 }), mvEfeito({ tipo: 'benef_retorno', quantidade: 2 })]);
    ok(tipos.join('|') === 'Saiu para beneficiamento|Voltou do beneficiamento|-3|2', 'Movimentações: nomes e efeito no estoque');
    ok(erros.length === 0, 'sem erro de JavaScript (Estoque) ' + erros.join(' | '));

    // ---------------------------------------------------------------- Dono com valores
    const d = await pagina(ctx, 'dono', true);
    await d.pg.click('button.chip[data-v="v2"][data-l="l-gav"]'); await d.pg.waitForSelector('#dlg[open]'); await d.pg.waitForTimeout(300);
    await d.pg.click('#dlgf [data-g="tipo"][data-x="beneficiamento"]'); await d.pg.waitForSelector('#dlg[open] #bfquem');
    ok(await d.pg.locator('[data-bfv]').count() === 1, 'Dono vê o campo de valor por peça');
    await d.pg.fill('#bfquem', 'Tinturaria Sol'); await d.pg.fill('#bfserv', 'tingimento'); await d.pg.fill('[data-bfq="0"]', '2'); await d.pg.fill('[data-bfv="0"]', '35,5');
    d.pg.once('dialog', x => x.accept()); await d.pg.click('#bfok'); await d.pg.waitForTimeout(500);
    const env2 = await ultimaRpc(d.pg, 'lin_beneficiamento_enviar');
    ok(env2 && env2.p.itens[0].valor_unitario === 35.5, 'valor por peça vai no envio (vírgula vira ponto)');
    await d.pg.waitForSelector('#dlg[open] #bffimp');
    ok((await d.pg.locator('#dlgf').innerText()).replace(/\u00a0/g, ' ').includes('R$ 71,00') && await d.pg.locator('#bffval').count() === 1, 'ficha do Dono mostra o valor pago e "Valor pago"');
    await d.pg.click('#bffx');
    await aba(d.pg, '#abaBenef'); await d.pg.waitForSelector('[data-bfval]');
    const t = (await d.pg.locator('#tela').innerText()).replace(/\u00a0/g, ' ');
    ok(t.includes('R$ 35,50/peça') && t.includes('Valor pago: R$ 71,00') && /Valor das peças fora\s*R\$\s*71,00/.test(t), 'Dono vê valor por peça, total e o valor das peças fora');
    await d.pg.click('[data-bfval="1"]'); await d.pg.waitForSelector('#dlg[open] #vvok');
    await d.pg.fill('[data-vv="0"]', '40,00'); await d.pg.click('#vvok'); await d.pg.waitForTimeout(400);
    const vals = await ultimaRpc(d.pg, 'lin_beneficiamento_valores');
    ok(vals && vals.p_id === 1 && vals.p_itens[0].valor_unitario === 40 && (await d.pg.locator('#tela').innerText()).replace(/\u00a0/g, ' ').includes('Valor pago: R$ 80,00'), 'Valor pago: corrige depois');
    await print(d.pg, 'benef_dono');
    ok(d.erros.length === 0, 'sem erro de JavaScript (Dono) ' + d.erros.join(' | '));

    // ---------------------------------------------------------------- vendedora (2.42): sem a aba; vê a marca no Estoque
    const pre = { bf: [{ id: 7, loja_id: 'l-gav', beneficiador: 'Tigre', servico: 'tingimento', vai_virar: 'peça especial marinho', previsto: '2099-11-30',
        observacao: '', situacao: 'no_beneficiamento', enviado_nome: 'Dona', enviado_em: new Date().toISOString() }],
      it: [{ id: 9, beneficiamento_id: 7, variante_id: 'v2', quantidade: 2, voltaram: 0, perdidas: 0, referencia: 'VES-MAR', descricao: 'Vestido Mar', cor: 'Azul', tamanho: 'M', edicao: '' }],
      estoque: [['v1', 'l-gav', 5], ['v5', 'l-gav', 4]] };
    const v = await pagina(ctx, 'vendedora', false, pre);
    ok(await v.pg.locator('#abaBenef').evaluate(e => e.classList.contains('oculto')), 'vendedora não tem a aba Beneficiamento');
    ok(await v.pg.evaluate(() => !window.__S.rpc.some(x => /beneficiamento_/.test(x[0]))), 'vendedora não chama as funções do beneficiamento');
    const q = v.pg.locator('div.chip.bf[data-v="v2"][data-l="l-gav"]');
    ok(await q.count() === 1, 'Estoque: a peça toda no beneficiamento (0 na loja) continua aparecendo com "ocultar zerados", com a marca ⟳');
    const tv = await q.getAttribute('title');
    ok(tv.includes('No beneficiamento: 2 peça(s) fora da loja, voltam ao estoque') && tv.includes('2 em tingimento') && tv.includes('vai virar: peça especial marinho') && tv.includes('volta prevista 30/11') && !tv.includes('Tigre'),
      'aviso ao apontar o mouse: peças fora, serviço, vai virar e volta prevista (sem o beneficiador)');
    await q.click(); await v.pg.waitForTimeout(150);
    ok((await v.pg.locator('#msg').innerText()).includes('vai virar: peça especial marinho'), 'no celular, tocar no quadrado mostra o aviso');
    await print(v.pg, 'benef_estoque_vendedora');
    // vendedora no Estoque: o quadrado com peça continua sendo a transferência
    await v.pg.click('button.chip[data-v="v1"][data-l="l-gav"]'); await v.pg.waitForSelector('#dlg[open]');
    ok(await v.pg.locator('#trq').count() === 1, 'vendedora: o quadrado do Estoque continua abrindo a transferência');
    ok(v.erros.length === 0, 'sem erro de JavaScript (vendedora) ' + v.erros.join(' | '));

    // ---------------------------------------------------------------- celular
    const cel = await b.newContext({ viewport: { width: 390, height: 844 } });
    const c = await pagina(cel, 'estoque', false);
    await c.pg.click('button.chip[data-v="v1"][data-l="l-gav"]'); await c.pg.waitForSelector('#dlg[open]'); await c.pg.waitForTimeout(300);
    await c.pg.click('#dlgf [data-g="tipo"][data-x="beneficiamento"]'); await c.pg.waitForSelector('#dlg[open] #bfquem');
    await c.pg.fill('#bfquem', 'Ateliê'); await c.pg.fill('#bfserv', 'bordado');
    c.pg.once('dialog', x => x.accept()); await c.pg.click('#bfok'); await c.pg.waitForSelector('#dlg[open] #bffimp');
    ok(await c.pg.evaluate(() => document.getElementById('dlg').scrollWidth <= document.getElementById('dlg').clientWidth + 1), 'celular: ficha sem rolagem lateral');
    await c.pg.click('#bffx');
    await aba(c.pg, '#abaBenef'); await c.pg.waitForSelector('[data-bfret]');
    await c.pg.click('[data-bfret="1"]'); await c.pg.waitForSelector('#dlg[open] #rbok');
    ok(await c.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: retorno sem rolagem lateral');
    await print(c.pg, 'benef_celular');
    ok(c.erros.length === 0, 'sem erro de JavaScript (celular) ' + c.erros.join(' | '));
  } catch (e) { falhas++; console.log('FALHOU  ' + (e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
