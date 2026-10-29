// Teste de tela do app Atendimentos de TI (site/apps/atendimentos/) com o Playwright do Node e um Supabase IMITADO no
// navegador (dados em memória; reproduz as regras do servidor que a tela usa: situação do chamado pelos andamentos,
// código do equipamento, histórico, RLS de leitura do cliente). As regras do banco de verdade estão em testes/teste_sql.sql.
// Uso: node testes/atendimentos/tela_atendimentos_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8831;

// ---------------------------------------------------------------- Supabase imitado (roda dentro da página)
const FALSO = `(() => {
  const papel = localStorage.getItem('papel_teste') || 'admin';
  const EU = { admin: 'u-admin', cliente: 'u-cli', sem: 'u-sem', anon: null }[papel];
  const salvo = localStorage.getItem('db_teste');
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const TIPO = { NB: 'Notebook', DT: 'Desktop', MM: 'Memória', MN: 'Monitor', IM: 'Impressora' };
  const db = salvo ? JSON.parse(salvo) : {
    perfis: [{ user_id: 'u-admin', email: 'marco@nervia.com.br', nome: 'Marco', admin: true },
             { user_id: 'u-cli', email: 'ti@vogue.com.br', nome: 'TI Vogue', admin: false },
             { user_id: 'u-sem', email: 'outro@x.com', nome: 'Outro', admin: false }],
    app_acessos: [],
    atd_empreendimentos: [{ sigla: 'SVS', nome: 'Shopping Vogue Square', cod_equip: 'SVS', ativo: true },
                          { sigla: 'Rio2Pom', nome: 'Rio2 Peninsula', cod_equip: 'R2P', ativo: true }],
    atd_acessos: [{ user_id: 'u-cli', sigla: 'SVS' }],
    atd_chamados: [
      { numero: 1, sigla: 'SVS', abertura: '2026-08-01', resumo: 'Impressora do financeiro', descricao: 'Não imprime', tipo: 'Suporte TI', solicitante: 'Ana', categoria: '', status: 'Fechado', fechamento: '2026-08-02' },
      { numero: 2, sigla: 'Rio2Pom', abertura: '2026-09-01', resumo: 'Wi-Fi lento', descricao: 'Wi-Fi lento na administração', tipo: 'Suporte TI', solicitante: 'Bruno', categoria: '', status: 'Aberto', fechamento: null }],
    atd_andamentos: [{ id: 1, numero: 1, data: '2026-08-02', fechado: true, texto: 'Driver reinstalado' }],
    atd_chamado_equip: [],
    atd_equipamentos: [{ codigo: 'NBSVS0001', seq: 1, prefixo: 'NB', tipo: 'Notebook', sigla: 'SVS', marca: 'Lenovo', modelo: 'E480', serie: '', setor: 'Operações', situacao: 'Em uso', usuario: 'Robson', vinculado_a: null, obs: '' }],
    atd_equip_historico: [{ id: 1, codigo: 'NBSVS0001', data: '2026-09-29', evento: 'Cadastrado · usuário Robson' }],
    seq: { atd_chamados: 2, atd_andamentos: 1, atd_equip_historico: 1 }
  };
  const gravar = () => localStorage.setItem('db_teste', JSON.stringify(db));
  const admin = () => EU === 'u-admin';
  const pode = s => admin() || db.atd_acessos.some(a => a.user_id === EU && a.sigla === s);
  const chamado = n => db.atd_chamados.find(c => c.numero === n);
  const equip = k => db.atd_equipamentos.find(e => e.codigo === k);
  const ver = {
    perfis: r => admin() || r.user_id === EU, app_acessos: r => admin() || r.user_id === EU,
    atd_empreendimentos: r => pode(r.sigla), atd_acessos: r => admin() || r.user_id === EU,
    atd_chamados: r => pode(r.sigla), atd_andamentos: r => pode(chamado(r.numero)?.sigla),
    atd_chamado_equip: r => pode(chamado(r.numero)?.sigla), atd_equipamentos: r => pode(r.sigla),
    atd_equip_historico: r => pode(equip(r.codigo)?.sigla) };
  const status = n => { const a = db.atd_andamentos.filter(x => x.numero === n), c = chamado(n);
    const f = a.length > 0 && a.every(x => x.fechado); c.status = f ? 'Fechado' : 'Aberto'; c.fechamento = f ? a.map(x => x.data).sort().pop() : null; };
  const hist = (k, ev, d) => db.atd_equip_historico.push({ id: ++db.seq.atd_equip_historico, codigo: k, data: d || hoje, evento: ev });
  const erro = m => ({ data: null, error: { message: m } });
  function inserir(t, r) {
    if (!admin()) return erro('new row violates row-level security policy for table "' + t + '"');
    r = { ...r };
    if (t === 'atd_chamados') { r.numero = ++db.seq.atd_chamados; r.status = 'Aberto'; r.fechamento = null; r.categoria = ''; r.resumo = (r.resumo || '').trim(); }
    if (t === 'atd_andamentos') r.id = ++db.seq.atd_andamentos;
    if (t === 'atd_equipamentos') {
      const e = db.atd_empreendimentos.find(x => x.sigla === r.sigla);
      r.seq = 1 + Math.max(0, ...db.atd_equipamentos.filter(x => x.sigla === r.sigla && x.prefixo === r.prefixo).map(x => x.seq));
      r.codigo = r.prefixo + e.cod_equip + String(r.seq).padStart(4, '0'); r.tipo = TIPO[r.prefixo] || 'Outros';
      if (r.vinculado_a) r.usuario = '';
    }
    if (t === 'atd_chamado_equip' && chamado(r.numero).sigla !== equip(r.codigo).sigla) return erro('O equipamento ' + r.codigo + ' não é do empreendimento do chamado.');
    if (t === 'atd_empreendimentos' && db.atd_empreendimentos.some(x => x.sigla.toLowerCase() === r.sigla.toLowerCase())) return erro('duplicate key value');
    if (t === 'app_acessos' && db.app_acessos.some(x => x.user_id === r.user_id && x.app_id === r.app_id)) return { data: [], error: null };
    db[t].push(r);
    if (t === 'atd_andamentos') status(r.numero);
    if (t === 'atd_equipamentos') { hist(r.codigo, 'Cadastrado' + (r.vinculado_a ? ' · instalado em ' + r.vinculado_a : r.usuario ? ' · usuário ' + r.usuario : ''));
      if (r.vinculado_a) hist(r.vinculado_a, 'Item ' + r.codigo + ' (' + r.tipo + ') instalado'); }
    gravar(); return { data: [r], error: null };
  }
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.um = false; }
    select() { if (this.op === 'select') this.op = 'select'; this.ret = true; return this; }
    insert(r) { this.op = 'insert'; this.rows = [].concat(r); return this; }
    upsert(r) { return this.insert(r); }
    update(v) { this.op = 'update'; this.vals = v; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push(r => r[c] === v); return this; }
    match(o) { for (const [c, v] of Object.entries(o)) this.eq(c, v); return this; }
    order() { return this; }
    range(a, b) { this.rg = [a, b]; return this; }
    single() { this.um = true; return this; }
    maybeSingle() { this.um = true; this.talvez = true; return this; }
    then(ok, bad) { return Promise.resolve(this.run()).then(ok, bad); }
    run() {
      const t = this.t, sel = () => db[t].filter(r => ver[t](r) && this.f.every(f => f(r)));
      if (this.op === 'insert') { const out = []; for (const r of this.rows) { const x = inserir(t, r); if (x.error) return x; out.push(...x.data); }
        return { data: this.um ? out[0] : out, error: null }; }
      if (this.op === 'update') {
        if (!admin()) return { data: [], error: null };
        for (const r of sel()) {
          if (t === 'atd_empreendimentos' && this.vals.cod_equip && this.vals.cod_equip !== r.cod_equip && db.atd_equipamentos.some(e => e.sigla === r.sigla)) return erro('Já existem equipamentos com o código; ele não pode mudar.');
          Object.assign(r, this.vals); if (t === 'atd_andamentos') status(r.numero);
        }
        gravar(); return { data: [], error: null };
      }
      if (this.op === 'delete') {
        if (!admin()) return { data: [], error: null };
        const fora = new Set(sel()); db[t] = db[t].filter(r => !fora.has(r)); for (const r of fora) if (t === 'atd_andamentos') status(r.numero);
        gravar(); return { data: [], error: null };
      }
      let d = sel(); if (this.rg) d = d.slice(this.rg[0], this.rg[1] + 1);
      if (this.um) return { data: d[0] || null, error: null };
      return { data: JSON.parse(JSON.stringify(d)), error: null };
    }
  }
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: EU ? { user: { id: EU } } : null } }) },
    from: t => new Q(t),
    rpc: async (fn, p) => {
      if (fn !== 'atd_equip_alterar') return erro('rpc desconhecida');
      if (!admin()) return erro('Só a equipe Nervia altera equipamentos.');
      const e = equip(p.p_codigo), v = p.p_dados, d = p.p_data, ev = [], vinc = v.vinculado_a || null;
      if (vinc !== e.vinculado_a) { ev.push(vinc ? 'Instalado em ' + vinc + (e.vinculado_a ? ' (antes em ' + e.vinculado_a + ')' : '') : 'Removido de ' + e.vinculado_a + ' (avulso)');
        if (e.vinculado_a) hist(e.vinculado_a, 'Item ' + e.codigo + ' (' + e.tipo + ') removido', d); if (vinc) hist(vinc, 'Item ' + e.codigo + ' (' + e.tipo + ') instalado', d); }
      if (!vinc && v.usuario !== e.usuario) ev.push('Usuário: ' + (e.usuario || '—') + ' → ' + (v.usuario || '—'));
      if (v.situacao !== e.situacao) ev.push('Situação: ' + e.situacao + ' → ' + v.situacao);
      if (v.setor !== e.setor) ev.push('Setor: ' + (e.setor || '—') + ' → ' + (v.setor || '—'));
      Object.assign(e, v, { vinculado_a: vinc, usuario: vinc ? '' : v.usuario });
      for (const x of ev) hist(e.codigo, x, d);
      gravar(); return { data: e, error: null };
    } }) };
  window.__db = db;
})();`;

const PDFMAKE = `window.pdfMake = { vfs: {}, createPdf: def => ({ download: nome => { window.__pdf = { nome, def }; } }) };`;

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/config.js') { res.end('window.NERVIA_CONFIG={SUPABASE_URL:"http://x",SUPABASE_ANON_KEY:"anon"};'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(RAIZ, 'site', p);
    if (!f.startsWith(path.join(RAIZ, 'site')) || !fs.existsSync(f)) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  }).listen(PORTA);
}

let falhas = 0, oks = 0;
function ok(cond, nome) { if (cond) { oks++; console.log('ok  ' + nome); } else { falhas++; console.log('FALHOU  ' + nome); } }

async function pagina(b, papel, largura = 1300) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('iniciado')) { localStorage.clear(); localStorage.setItem('papel_teste', p); sessionStorage.setItem('iniciado', '1'); } }, papel);
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push(String(e)));
  pg.on('dialog', d => d.accept());
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await pg.route('**/pdfmake@*/**', r => r.fulfill({ body: PDFMAKE, contentType: 'text/javascript' }));
  await pg.route('**/fonts.googleapis.com/**', r => r.abort());
  await pg.goto(`http://127.0.0.1:${PORTA}/apps/atendimentos/`);
  await pg.waitForTimeout(500);
  return { pg, erros, ctx };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    // ---------------- equipe Nervia
    const { pg, erros } = await pagina(b, 'admin');
    ok((await pg.locator('#count').innerText()).startsWith('Mostrando todos os 2'), 'admin: lista com os 2 chamados');
    ok(await pg.locator('a[data-v=novo]').isVisible() && await pg.locator('a[data-v=empreendimentos]').isVisible(), 'admin: vê Novo atendimento e Empreendimentos');
    ok((await pg.locator('[data-versao=atendimentos]').count()) === 1, 'topo com a versão do app');
    // novo chamado com andamento aberto e equipamento
    await pg.click('a[data-v=novo]');
    await pg.selectOption('#n-emp', 'SVS');
    await pg.fill('#n-resumo', 'Notebook sem rede');
    await pg.fill('#n-desc', 'O notebook do Robson não conecta na rede');
    await pg.fill('#n-tipo', 'Suporte TI');
    await pg.fill('#n-sol', 'Robson');
    await pg.selectOption('#n-ativos select', 'NBSVS0001');
    await pg.waitForTimeout(200);
    await pg.fill('#n-and', 'Verificado cabo; aguardando troca do adaptador');
    await pg.selectOption('#n-and-st', '0');
    await pg.click('#n-save');
    await pg.waitForTimeout(1300);
    const c3 = await pg.evaluate(() => window.__db.atd_chamados.find(c => c.numero === 3));
    ok(c3 && c3.sigla === 'SVS' && c3.status === 'Aberto', 'novo chamado #3 gravado e aberto');
    ok(await pg.evaluate(() => window.__db.atd_andamentos.some(a => a.numero === 3 && !a.fechado) && window.__db.atd_chamado_equip.some(x => x.numero === 3 && x.codigo === 'NBSVS0001')),
      'novo chamado com primeiro andamento e equipamento vinculado');
    ok(await pg.locator('#r3.open').isVisible(), 'volta para a lista com o chamado aberto');
    await print(pg, 'atd_chamado_aberto');
    // andamento fechado: chamado continua aberto (há um aberto); editar o aberto para fechado fecha
    const ficha = pg.locator('#r3 .ficha');
    await ficha.locator('textarea[id^=na-t-]').fill('Adaptador trocado, rede ok');
    await ficha.locator('button:has-text("Registrar andamento")').click();
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => window.__db.atd_chamados.find(c => c.numero === 3).status) === 'Aberto', 'com um andamento aberto o chamado continua aberto');
    await pg.locator('#r3 .timeline li').first().locator('button:has-text("Editar")').click();
    await pg.locator('#r3 .timeline select').selectOption('1');
    await pg.locator('#r3 .timeline button:has-text("Salvar")').click();
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => window.__db.atd_chamados.find(c => c.numero === 3).status) === 'Fechado', 'corrigir o andamento para fechado fecha o chamado');
    ok((await pg.locator('#r3 .rhead .pill').innerText()) === 'Fechado', 'lista mostra Fechado');
    // excluir andamento
    await pg.locator('#r3 .timeline li').last().locator('button:has-text("Editar")').click();
    await pg.locator('#r3 .timeline button:has-text("Excluir andamento")').click();
    await pg.locator('#r3 .timeline button:has-text("Confirmar exclusão")').click();
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => window.__db.atd_andamentos.filter(a => a.numero === 3).length) === 1, 'excluir andamento (com confirmação)');
    // editar dados do chamado
    await pg.locator('#r3 button:has-text("Editar")').first().click();
    await pg.fill('#ed-so-3', 'Robson Operação');
    await pg.locator('#r3 button:has-text("Salvar")').first().click();
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => window.__db.atd_chamados.find(c => c.numero === 3).solicitante) === 'Robson Operação', 'editar o chamado');
    // ficha em PDF
    await pg.locator('#r3 .rhead .fbtn').click();
    ok(await pg.locator('.fdoc').isVisible() && (await pg.locator('.fdoc').innerText()).includes('NBSVS0001'), 'ficha do atendimento com o equipamento');
    await pg.click('#fd-pdf'); await pg.waitForTimeout(200);
    ok((await pg.evaluate(() => window.__pdf && window.__pdf.nome)) === 'Ficha atendimento 3 - SVS.pdf', 'Baixar PDF gera o arquivo da ficha');
    await print(pg, 'atd_ficha');
    await pg.keyboard.press('Escape');
    // filtros
    await pg.selectOption('#f-st', 'Aberto');
    ok((await pg.locator('#count').innerText()).startsWith('1 de 3 chamados'), 'filtro por situação');
    await pg.selectOption('#f-st', '');
    await pg.fill('#f-q', 'wi-fi');
    ok((await pg.locator('#count').innerText()).startsWith('1 de 3 chamados'), 'busca por texto');
    await pg.fill('#f-q', '');
    // equipamentos: cadastrar item instalado e trocar usuário com data
    await pg.click('a[data-v=equipamentos]');
    await pg.click('#eq-new');
    await pg.selectOption('#af-new-emp', 'SVS');
    await pg.selectOption('#af-new-tipo', 'MM');
    await pg.fill('#af-new-marca', 'Kingston');
    await pg.selectOption('#af-new-vinc', 'NBSVS0001');
    ok((await pg.locator('#eq-form .hint').first().innerText()).includes('MMSVS0001'), 'mostra o código que será gerado');
    await pg.click('#eq-form button:has-text("Cadastrar")');
    await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => window.__db.atd_equipamentos.some(e => e.codigo === 'MMSVS0001' && e.vinculado_a === 'NBSVS0001')), 'item cadastrado e instalado no notebook');
    if (!(await pg.locator('#a-NBSVS0001.open').count())) await pg.locator('#a-NBSVS0001 .eqrow').click();
    await pg.locator('#a-NBSVS0001 button:has-text("Editar / trocar usuário")').click();
    await pg.fill('#af-ed-NBSVS0001-user', 'Carla');
    await pg.fill('#af-ed-NBSVS0001-data', '2026-10-20');
    await pg.locator('#a-NBSVS0001 button:has-text("Salvar")').click();
    await pg.waitForTimeout(500);
    const hist = await pg.locator('#a-NBSVS0001 .timeline').innerText();
    ok(hist.includes('Usuário: Robson → Carla') && hist.includes('20/10/2026') && hist.includes('Item MMSVS0001 (Memória) instalado'), 'histórico do equipamento (troca de usuário com a data e item instalado)');
    ok((await pg.locator('#a-NBSVS0001').innerText()).includes('#3'), 'equipamento mostra os chamados dele');
    await print(pg, 'atd_equipamentos');
    // empreendimentos e quem vê
    await pg.click('a[data-v=empreendimentos]');
    ok((await pg.locator('#emp-body').innerText()).includes('1 login'), 'empreendimentos: quantos logins veem');
    await pg.locator('#emp-body tr', { hasText: 'Rio2Pom' }).locator('button:has-text("ninguém")').click();
    await pg.locator('#dlg label', { hasText: 'ti@vogue.com.br' }).locator('input').check();
    await pg.locator('#dlg button:has-text("Salvar")').click();
    await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => window.__db.atd_acessos.some(a => a.user_id === 'u-cli' && a.sigla === 'Rio2Pom') && window.__db.app_acessos.some(a => a.user_id === 'u-cli' && a.app_id === 'atendimentos')),
      'quem vê: libera o empreendimento e o app para o login');
    ok(!(await pg.locator('#dlg label', { hasText: 'marco@nervia.com.br' }).count()), 'quem vê: equipe Nervia não aparece na lista');
    await pg.fill('#e-sigla', 'SPS'); await pg.fill('#e-nome', 'Park Sul'); await pg.fill('#e-cod', 'SPS');
    await pg.click('#emp-form button[type=submit]'); await pg.waitForTimeout(400);
    ok(await pg.evaluate(() => window.__db.atd_empreendimentos.some(e => e.sigla === 'SPS' && e.cod_equip === 'SPS')), 'novo empreendimento');
    await pg.fill('#e-sigla', 'sps'); await pg.fill('#e-nome', 'Outro'); await pg.fill('#e-cod', 'XYZ');
    await pg.click('#emp-form button[type=submit]'); await pg.waitForTimeout(200);
    ok((await pg.locator('#e-msg').innerText()).includes('já existe'), 'sigla repetida recusada');
    // painel
    await pg.click('a[data-v=painel]');
    ok((await pg.locator('#kpis').textContent()).includes('Em aberto') && (await pg.locator('#ch-mes svg').count()) === 1, 'painel com números e gráficos');
    const anoAtual = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 4);
    ok(await pg.inputValue('#f-ano') === anoAtual && await pg.inputValue('#f-mes') === '', 'painel já vem filtrado no ano em curso');
    await pg.selectOption('#f-ano', '2026'); await pg.selectOption('#f-mes', '08');
    ok((await pg.locator('#oldest').innerText()).includes('Wi-Fi lento') && (await pg.locator('#kpis .kpi').nth(2).locator('.v').innerText()) === '1',
      'ago/2026: o chamado em aberto de setembro continua aparecendo e 1 fechado no período');
    await pg.selectOption('#f-emp', 'SVS');
    ok(!(await pg.locator('#oldest').innerText()).includes('Wi-Fi lento'), 'o em aberto respeita o filtro de empreendimento');
    await pg.selectOption('#f-emp', '');
    await pg.selectOption('#f-ano', ''); await pg.selectOption('#f-mes', '');
    ok((await pg.locator('#painel-sub').innerText()).includes('todos os anos · 3 chamados'), 'todos os anos: os 3 chamados');
    await pg.selectOption('#f-ano', '2026'); await pg.selectOption('#f-mes', '08');
    await pg.click('a[data-v=atendimentos]');
    const lista = await pg.locator('#v-atendimentos').innerText();
    ok(lista.includes('Impressora do financeiro') && lista.includes('Wi-Fi lento') && await pg.inputValue('#f-mes') === '08' && (await pg.locator('#v-atendimentos #filtros').count()) === 1,
      'o mesmo filtro vale na lista de chamados (agosto: o fechado de agosto e o em aberto de setembro)');
    await pg.selectOption('#f-tp', 'Suporte TI'); await pg.click('a[data-v=painel]');
    ok((await pg.locator('#v-painel #filtros').count()) === 1 && await pg.inputValue('#f-tp') === 'Suporte TI', 'e o filtro da lista vale no Painel');
    await pg.selectOption('#f-mes', ''); await pg.selectOption('#f-tp', '');
    await print(pg, 'atd_painel');
    ok(!erros.length, 'admin: sem erro de JavaScript ' + erros.join(' | '));
    const estado = await pg.evaluate(() => localStorage.getItem('db_teste'));

    // ---------------- cliente: só lê os empreendimentos liberados
    const cli = await pagina(b, 'cliente');
    await cli.pg.evaluate(e => { localStorage.setItem('db_teste', e); }, estado); await cli.pg.reload(); await cli.pg.waitForTimeout(500);
    ok((await cli.pg.locator('#count').innerText()).startsWith('Mostrando todos os 3'), 'cliente: vê os chamados dos empreendimentos liberados (SVS e Rio2Pom)');
    ok(!(await cli.pg.locator('a[data-v=novo]').isVisible()) && !(await cli.pg.locator('a[data-v=empreendimentos]').isVisible()), 'cliente: sem Novo atendimento e Empreendimentos');
    await cli.pg.locator('#r3 .rhead').click();
    ok(!(await cli.pg.locator('#r3 button:has-text("Editar")').count()) && !(await cli.pg.locator('#r3 button:has-text("Registrar andamento")').count()), 'cliente: sem editar nem registrar andamento');
    ok((await cli.pg.locator('#r3 .timeline').innerText()).includes('Verificado cabo'), 'cliente: lê os andamentos');
    await cli.pg.locator('#r3 .rhead .fbtn').click(); await cli.pg.click('#fd-pdf'); await cli.pg.waitForTimeout(200);
    ok(!!(await cli.pg.evaluate(() => window.__pdf)), 'cliente: baixa a ficha em PDF');
    await cli.pg.keyboard.press('Escape');
    await cli.pg.click('a[data-v=equipamentos]');
    ok(!(await cli.pg.locator('#eq-new').isVisible()), 'cliente: não cadastra equipamento');
    await cli.pg.evaluate(() => { location.hash = ''; });
    ok(!cli.erros.length, 'cliente: sem erro de JavaScript ' + cli.erros.join(' | '));
    // celular
    const cel = await pagina(b, 'cliente', 390);
    await cel.pg.evaluate(e => { localStorage.setItem('db_teste', e); }, estado); await cel.pg.reload(); await cel.pg.waitForTimeout(500);
    ok(await cel.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral');
    await print(cel.pg, 'atd_celular');

    // ---------------- sem empreendimento liberado / sem login
    const sem = await pagina(b, 'sem');
    ok((await sem.pg.locator('#notice').innerText()).includes('Nenhum empreendimento liberado'), 'login sem empreendimento: aviso');
    const anon = await pagina(b, 'anon');
    ok((await anon.pg.locator('#at-sub').innerText()).includes('Área do Cliente'), 'sem login: pede para entrar na Área do Cliente');

    // ---------------- embutido na Área do Cliente (iframe): esconde a marca do topo
    const emb = await pagina(b, 'admin');
    await emb.pg.setContent(`<iframe src="http://127.0.0.1:${PORTA}/apps/atendimentos/" style="width:1200px;height:800px"></iframe>`);
    await emb.pg.waitForTimeout(800);
    const fr = emb.pg.mainFrame().childFrames()[0];
    ok(fr && await fr.evaluate(() => document.documentElement.classList.contains('embutido')), 'no iframe esconde o topo próprio');
  } finally {
    await b.close(); srv.close();
  }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
