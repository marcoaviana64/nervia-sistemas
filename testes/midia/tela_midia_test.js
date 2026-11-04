// Teste de tela do Mídia Indoor (site/apps/midia/) com o Playwright do Node e um Supabase IMITADO no navegador
// (dados em memória; reproduz o que a tela usa: leitura por conta, rpcs mi_* e a função "midia"). As regras do banco
// de verdade estão em testes/teste_sql.sql; as da leitura do Drive em testes/midia/midia_test.ts.
// Uso: node testes/midia/tela_midia_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = process.argv[2] || null;
const PORTA = 8841;

const FALSO = `(() => {
  const papel = localStorage.getItem('papel_teste') || 'admin';
  const EU = { admin: 'u-admin', cliente: 'u-cli', sem: 'u-sem', anon: null }[papel];
  const agora = Date.now(), min = m => new Date(agora - m * 60000).toISOString();
  const salvo = localStorage.getItem('db_teste');
  const db = salvo ? JSON.parse(salvo) : {
    perfis: [{ user_id: 'u-admin', email: 'marco@nervia.com.br', nome: 'Marco', admin: true },
             { user_id: 'u-cli', email: 'mkt@lojaexemplo.com.br', nome: 'Marketing', admin: false },
             { user_id: 'u-sem', email: 'outro@x.com', nome: 'Outro', admin: false }],
    app_acessos: [],
    mi_contas: [{ id: 'c1', nome: 'Loja Exemplo', pasta_url: 'https://drive.google.com/drive/folders/PASTA1', pasta_id: 'PASTA1', pasta_chave: '', tempo_imagem_s: 10, limite_mb: 5000, ativo: true, sincronizado_em: min(3), sinc_erro: '' }],
    mi_acessos: [{ user_id: 'u-cli', conta_id: 'c1' }],
    mi_playlists: [{ id: 'p1', conta_id: 'c1', drive_id: 'S1', nome: 'Hall', raiz: false }, { id: 'p2', conta_id: 'c1', drive_id: 'S2', nome: 'Praça de alimentação', raiz: false }],
    mi_midias: [
      { id: 'm1', playlist_id: 'p1', drive_id: 'F1', nome: '01_black-friday.mp4', tipo: 'video', situacao: 'ok', motivo: '', tamanho: 44040192, codec: 'H.264', largura: 1920, altura: 1080, duracao_s: 30, posicao: 1, tempo_s: null },
      { id: 'm2', playlist_id: 'p1', drive_id: 'F2', nome: '02_horario.png', tipo: 'imagem', situacao: 'ok', motivo: '', tamanho: 838860, largura: 1920, altura: 1080, duracao_s: null, posicao: 2, tempo_s: null },
      { id: 'm3', playlist_id: 'p1', drive_id: 'F3', nome: '03_iphone.mp4', tipo: 'video', situacao: 'recusado', motivo: 'vídeo em H.265 (HEVC): exporte em MP4 com H.264', tamanho: 9000000, codec: 'H.265 (HEVC)', largura: 1920, altura: 1080, duracao_s: 15, posicao: 3, tempo_s: null },
      { id: 'm4', playlist_id: 'p2', drive_id: 'F4', nome: '01_cardapio.jpg', tipo: 'imagem', situacao: 'ok', motivo: '', tamanho: 2202009, posicao: 1, tempo_s: 12 }],
    mi_telas: [
      { id: 't1', conta_id: 'c1', nome: 'Hall de entrada', playlist_id: 'p1', ultimo_sinal: min(1), versao_app: '1.0', modelo: 'TV box X96', android: '9', tocando: '01_black-friday.mp4', espaco_livre_mb: 6200, baixando: 0, erros: [] },
      { id: 't2', conta_id: 'c1', nome: 'Estacionamento', playlist_id: 'p2', ultimo_sinal: min(190), versao_app: '1.0', modelo: 'Google TV', android: '12', tocando: '', espaco_livre_mb: 3000, baixando: 0, erros: [{ nome: 'promo.mp4', erro: 'este aparelho não toca o vídeo' }] }],
    codigos: { 'ABC234': 'livre' },
    log: []
  };
  const gravar = () => localStorage.setItem('db_teste', JSON.stringify(db));
  const admin = () => EU === 'u-admin';
  const pode = c => admin() || db.mi_acessos.some(a => a.user_id === EU && a.conta_id === c);
  const conta = id => db.mi_contas.find(c => c.id === id), pl = id => db.mi_playlists.find(p => p.id === id);
  const ver = { perfis: r => admin() || r.user_id === EU, app_acessos: r => admin() || r.user_id === EU, mi_contas: r => pode(r.id),
    mi_acessos: r => admin() || r.user_id === EU, mi_playlists: r => pode(r.conta_id), mi_midias: r => pode((pl(r.playlist_id) || {}).conta_id), mi_telas: r => pode(r.conta_id) };
  const erro = m => ({ data: null, error: { message: m } });
  const ok = d => ({ data: d, error: null });
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select() { return this; }
    insert(r) { this.op = 'insert'; this.rows = [].concat(r); return this; }
    upsert(r) { this.op = 'upsert'; this.rows = [].concat(r); return this; }
    update(v) { this.op = 'update'; this.vals = v; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push(r => r[c] === v); return this; }
    in(c, v) { this.f.push(r => v.includes(r[c])); return this; }
    order() { return this; }
    single() { this.um = true; return this; }
    maybeSingle() { this.um = true; return this; }
    then(a, b) { return Promise.resolve(this.run()).then(a, b); }
    run() {
      const t = this.t, sel = () => db[t].filter(r => ver[t](r) && this.f.every(f => f(r)));
      if (this.op === 'insert' || this.op === 'upsert') {
        if (!admin()) return erro('new row violates row-level security policy');
        for (const r of this.rows) { if (t === 'app_acessos' && db.app_acessos.some(x => x.user_id === r.user_id && x.app_id === r.app_id)) continue;
          db[t].push(t === 'mi_contas' ? { pasta_url: '', pasta_id: '', pasta_chave: '', tempo_imagem_s: 10, ativo: true, sincronizado_em: null, sinc_erro: '', ...r } : { ...r }); }
        gravar(); return ok([]);
      }
      if (this.op === 'update') { if (!admin()) return erro('permission denied for table ' + t); sel().forEach(r => Object.assign(r, this.vals)); gravar(); return ok([]); }
      if (this.op === 'delete') { if (!admin()) return erro('permission denied'); const fora = new Set(sel()); db[t] = db[t].filter(r => !fora.has(r)); gravar(); return ok([]); }
      const d = JSON.parse(JSON.stringify(sel()));
      return ok(this.um ? d[0] || null : d);
    }
  }
  const rpcs = {
    mi_vincular(p) {
      if (!pode(p.p_conta)) return erro('Sem acesso a esta conta.');
      const s = db.codigos[p.p_codigo];
      if (!s) return erro('Código não encontrado. Confira o que aparece na TV.');
      if (s === 'usado') return erro('Este código já foi usado. Aguarde a TV mostrar um código novo.');
      db.codigos[p.p_codigo] = 'usado';
      const id = 't' + (db.mi_telas.length + 1);
      db.mi_telas.push({ id, conta_id: p.p_conta, nome: p.p_nome, playlist_id: p.p_playlist, ultimo_sinal: null, versao_app: '', modelo: '', android: '', tocando: '', espaco_livre_mb: null, baixando: 0, erros: [] });
      db.log.push('vincular'); return ok(id);
    },
    mi_tela_salvar(p) { const t = db.mi_telas.find(x => x.id === p.p_tela); if (!t || !pode(t.conta_id)) return erro('TV não encontrada.'); t.nome = p.p_nome; t.playlist_id = p.p_playlist; db.log.push('tela'); return ok(null); },
    mi_desvincular(p) { const t = db.mi_telas.find(x => x.id === p.p_tela); if (!t || !pode(t.conta_id)) return erro('TV não encontrada.'); db.mi_telas = db.mi_telas.filter(x => x !== t); return ok(null); },
    mi_midia_tempo(p) { const m = db.mi_midias.find(x => x.id === p.p_midia); m.tempo_s = p.p_tempo; return ok(null); },
    mi_conta_salvar(p) {
      if (!pode(p.p_conta)) return erro('Sem acesso a esta conta.');
      const id = (p.p_pasta_url.match(/folders\\/([A-Za-z0-9_-]+)/) || [])[1] || '';
      if (p.p_pasta_url && !id) return erro('Link de pasta do Google Drive não reconhecido. No Drive, clique com o botão direito na pasta → Compartilhar → Copiar link.');
      const c = conta(p.p_conta);
      if (id !== c.pasta_id) { db.mi_playlists = db.mi_playlists.filter(x => x.conta_id !== c.id); db.mi_telas.forEach(t => { if (t.conta_id === c.id) t.playlist_id = null; }); c.sincronizado_em = null; }
      Object.assign(c, { pasta_url: p.p_pasta_url, pasta_id: id, tempo_imagem_s: p.p_tempo }); return ok(null);
    } };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: EU ? { user: { id: EU } } : null } }) },
    from: t => new Q(t),
    rpc: async (fn, p) => { const r = rpcs[fn] ? rpcs[fn](p) : erro('rpc desconhecida ' + fn); gravar(); return r; },
    functions: { invoke: async (nome, { body }) => {
      if (nome !== 'midia' || body.acao !== 'sincronizar') return { data: null, error: { message: 'função desconhecida', context: { json: async () => ({}) } } };
      const c = conta(body.conta);
      if (c.pasta_id === 'PRIVADA') { c.sinc_erro = 'Pasta não encontrada no Google Drive. Confira o link e se a pasta está compartilhada com "qualquer pessoa com o link".';
        gravar(); return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ ok: false, mensagem: c.sinc_erro }) } } }; }
      if (!db.mi_playlists.some(x => x.conta_id === c.id)) { db.mi_playlists.push({ id: 'p9', conta_id: c.id, drive_id: 'S9', nome: 'Vitrine', raiz: false });
        db.mi_midias.push({ id: 'm9', playlist_id: 'p9', drive_id: 'F9', nome: '01_vitrine.mp4', tipo: 'video', situacao: 'ok', motivo: '', tamanho: 1000000, codec: 'H.264', largura: 1280, altura: 720, duracao_s: 20, posicao: 1 }); }
      c.sincronizado_em = new Date().toISOString(); c.sinc_erro = ''; gravar();
      return { data: { ok: true, mensagem: 'Pasta lida: 1 playlist(s), 1 arquivo(s).' }, error: null };
    } } }) };
  window.__db = db;
})();`;

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

async function pagina(b, papel, largura = 1300, url = '/apps/midia/') {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 } });
  await ctx.addInitScript(p => { if (!sessionStorage.getItem('iniciado')) { localStorage.clear(); localStorage.setItem('papel_teste', p); sessionStorage.setItem('iniciado', '1'); } }, papel);
  const pg = await ctx.newPage(); const erros = [];
  pg.on('pageerror', e => erros.push(String(e)));
  pg.on('dialog', d => d.type() === 'prompt' ? d.accept('Hall L1') : d.accept());
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await pg.goto(`http://127.0.0.1:${PORTA}${url}`);
  await pg.waitForTimeout(400);
  return { pg, erros, ctx };
}
const print = async (pg, nome) => { if (SAIDA) await pg.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true }); };
const db = pg => pg.evaluate(() => window.__db);

(async () => {
  const srv = servidor();
  const b = await chromium.launch();
  try {
    // ---------------- cliente
    const { pg, erros } = await pagina(b, 'cliente');
    ok((await pg.locator('[data-versao=midia]').count()) === 1, 'topo com a versão do app');
    ok(await pg.locator('#abaAdmin').isHidden(), 'cliente não vê a aba Contas');
    const kpi = await pg.locator('.kpi').first().innerText();
    ok(kpi.includes('1 de 2'), 'KPI: 1 de 2 TVs online');
    ok((await pg.locator('.aviso.warn').innerText()).includes('Estacionamento'), 'aviso da TV offline');
    ok((await pg.locator('#tela').innerText()).includes('este aparelho não toca o vídeo'), 'erro informado pela TV aparece');
    await print(pg, 'midia_tvs');
    // trocar playlist
    await pg.selectOption('select[data-pl=t1]', 'p2');
    await pg.waitForTimeout(200);
    ok((await db(pg)).mi_telas.find(t => t.id === 't1').playlist_id === 'p2', 'troca de playlist grava pela rpc');
    ok((await pg.locator('#msg').innerText()).includes('no fim do item'), 'mensagem da troca no fim do item');
    // adicionar TV: código inválido, código usado, ok
    await pg.click('[data-acao=addTv]');
    await pg.fill('#fCod', 'AB'); await pg.fill('#fNome', 'Vitrine'); await pg.click('#fOk');
    ok((await pg.locator('#fErr').innerText()).includes('6 letras'), 'código curto é recusado na tela');
    await pg.fill('#fCod', 'zzz999'); await pg.click('#fOk'); await pg.waitForTimeout(150);
    ok((await pg.locator('#fErr').innerText()).includes('não encontrado'), 'código inexistente mostra o erro do servidor');
    await pg.fill('#fCod', 'abc234'); await pg.selectOption('#fPl', 'p1'); await pg.click('#fOk'); await pg.waitForTimeout(250);
    const d1 = await db(pg);
    ok(d1.mi_telas.some(t => t.nome === 'Vitrine' && t.playlist_id === 'p1'), 'TV vinculada pelo código (letras minúsculas viram maiúsculas)');
    ok((await pg.locator('#tela').innerText()).includes('aguardando 1º sinal'), 'TV nova aparece aguardando o 1º sinal');
    // renomear e desvincular
    await pg.click('[data-acao=renomear][data-id=t1]'); await pg.waitForTimeout(200);
    ok((await db(pg)).mi_telas.find(t => t.id === 't1').nome === 'Hall L1', 'renomear a TV');
    await pg.click('[data-acao=desvincular][data-id=t2]'); await pg.waitForTimeout(200);
    ok(!(await db(pg)).mi_telas.some(t => t.id === 't2'), 'desvincular a TV');
    // playlists
    await pg.click('.aba[data-v=playlists]');
    const txt = await pg.locator('#tela').innerText();
    ok(txt.includes('01_black-friday.mp4') && txt.includes('H.264 · 1920×1080'), 'playlist mostra os arquivos com codec e resolução');
    ok(txt.includes('Não vai para a TV: vídeo em H.265'), 'arquivo recusado com o motivo');
    ok(txt.includes('ciclo completo: 40 s'), 'ciclo = vídeo 30 s + imagem 10 s (o recusado não conta)');
    await print(pg, 'midia_playlists');
    await pg.fill('input[data-tempo=m2]', '15'); await pg.locator('input[data-tempo=m2]').press('Tab'); await pg.waitForTimeout(200);
    ok((await db(pg)).mi_midias.find(m => m.id === 'm2').tempo_s === 15, 'tempo próprio da imagem salvo');
    ok((await pg.locator('#tela').innerText()).includes('ciclo completo: 45 s'), 'ciclo atualizado com o tempo novo');
    await pg.click('[data-plsel=p2]');
    ok((await pg.locator('input[data-tempo=m4]').inputValue()) === '12', 'outra playlist com o tempo próprio da imagem');
    await pg.click('[data-acao=sinc]'); await pg.waitForTimeout(300);
    ok((await pg.locator('#msg').innerText()).includes('Pasta lida'), 'Atualizar agora lê a pasta');
    // pasta do drive
    await pg.click('.aba[data-v=config]');
    await pg.fill('#cUrl', 'https://exemplo.com/nada'); await pg.click('[data-acao=salvarPasta]'); await pg.waitForTimeout(200);
    ok((await pg.locator('#msg').innerText()).includes('não reconhecido'), 'link que não é pasta do Drive é recusado');
    await pg.fill('#cUrl', 'https://drive.google.com/drive/folders/PASTA2?usp=sharing'); await pg.fill('#cTempo', '8');
    await pg.click('[data-acao=salvarPasta]'); await pg.waitForTimeout(400);
    const d2 = await db(pg);
    ok(d2.mi_contas[0].pasta_id === 'PASTA2' && d2.mi_contas[0].tempo_imagem_s === 8, 'pasta nova e tempo padrão salvos');
    ok((await pg.locator('.aba.on').innerText()).startsWith('Playlists') && (await pg.locator('#tela').innerText()).includes('Vitrine'), 'depois de trocar a pasta, lê e mostra as playlists novas');
    ok(erros.length === 0, 'cliente: sem erros de JavaScript ' + erros.join(' | '));

    // ---------------- erro ao ler a pasta
    await pg.evaluate(() => { const d = JSON.parse(localStorage.getItem('db_teste')); d.mi_contas[0].pasta_id = 'PRIVADA'; localStorage.setItem('db_teste', JSON.stringify(d)); });
    await pg.reload(); await pg.waitForTimeout(400);
    await pg.click('.aba[data-v=playlists]'); await pg.click('[data-acao=sinc]'); await pg.waitForTimeout(300);
    ok((await pg.locator('#msg').innerText()).includes('qualquer pessoa com o link') && (await pg.locator('.aviso.crit').count()) === 1, 'pasta não compartilhada: erro claro no painel');

    // ---------------- celular
    const cel = await pagina(b, 'cliente', 390);
    ok(await cel.pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular: sem rolagem lateral');
    await print(cel.pg, 'midia_celular');

    // ---------------- sem acesso / sem login
    const sem = await pagina(b, 'sem');
    ok((await sem.pg.locator('#aviso').innerText()).includes('Nenhuma conta'), 'login sem conta liberada vê o aviso');
    const anon = await pagina(b, 'anon');
    ok((await anon.pg.locator('#aviso').innerText()).includes('Área do Cliente'), 'sem login: manda para a Área do Cliente');

    // ---------------- equipe Nervia
    const adm = await pagina(b, 'admin');
    await adm.pg.click('#abaAdmin'); await adm.pg.waitForTimeout(250);
    ok((await adm.pg.locator('#acc-c1').innerText()).includes('mkt@lojaexemplo.com.br'), 'admin: quem vê cada conta');
    await adm.pg.click('[data-acao=novaConta]');
    await adm.pg.fill('#aNome', 'Cliente Novo'); await adm.pg.fill('#aLim', '2'); await adm.pg.click('#aOk'); await adm.pg.waitForTimeout(300);
    const d3 = await db(adm.pg);
    const nova = d3.mi_contas.find(c => c.nome === 'Cliente Novo');
    ok(nova && nova.limite_mb === 2000, 'admin: cria conta com limite de 2 GB');
    ok((await adm.pg.locator('#selConta').isVisible()), 'com duas contas aparece a escolha de conta');
    await adm.pg.click('#abaAdmin'); await adm.pg.waitForTimeout(250);
    await adm.pg.click(`[data-acao=acessos][data-id="${nova.id}"]`);
    await adm.pg.check(`#dlgf input[value=u-sem]`); await adm.pg.click('#qOk'); await adm.pg.waitForTimeout(300);
    const d4 = await db(adm.pg);
    ok(d4.mi_acessos.some(a => a.user_id === 'u-sem' && a.conta_id === nova.id) && d4.app_acessos.some(a => a.user_id === 'u-sem' && a.app_id === 'midia'), 'admin: quem vê libera a conta e o app');
    await print(adm.pg, 'midia_contas');
    ok(adm.erros.length === 0, 'admin: sem erros de JavaScript ' + adm.erros.join(' | '));

    // ---------------- ajuda
    for (const f of ['cartao', 'manual']) {
      const a = await pagina(b, 'cliente', 1100, `/apps/midia/ajuda/${f}.html`);
      ok((await a.pg.title()).includes('Mídia Indoor') && a.erros.length === 0, `ajuda: ${f} abre sem erro`);
      await print(a.pg, 'midia_' + f);
    }
  } finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
