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
    mi_contas: [{ id: 'c1', nome: 'Loja Exemplo', pasta_url: 'https://drive.google.com/drive/folders/PASTA1', pasta_id: 'PASTA1', pasta_chave: '', tempo_imagem_s: 10, limite_mb: 5000, tolerancia_dias: 3, ativo: true, sincronizado_em: min(3), sinc_erro: '' }],
    mi_acessos: [{ user_id: 'u-cli', conta_id: 'c1' }],
    mi_playlists: [{ id: 'p1', conta_id: 'c1', drive_id: 'S1', nome: 'Hall', raiz: false }, { id: 'p2', conta_id: 'c1', drive_id: 'S2', nome: 'Praça de alimentação', raiz: false }],
    mi_midias: [
      { id: 'm1', playlist_id: 'p1', drive_id: 'F1', nome: '01_black-friday.mp4', tipo: 'video', situacao: 'ok', motivo: '', tamanho: 44040192, codec: 'H.264', largura: 1920, altura: 1080, duracao_s: 30, posicao: 1, tempo_s: null },
      { id: 'm2', playlist_id: 'p1', drive_id: 'F2', nome: '02_horario.png', tipo: 'imagem', situacao: 'ok', motivo: '', tamanho: 838860, largura: 1920, altura: 1080, duracao_s: null, posicao: 2, tempo_s: null },
      { id: 'm3', playlist_id: 'p1', drive_id: 'F3', nome: '03_iphone.mp4', tipo: 'video', situacao: 'recusado', motivo: 'vídeo em H.265 (HEVC): exporte em MP4 com H.264', tamanho: 9000000, codec: 'H.265 (HEVC)', largura: 1920, altura: 1080, duracao_s: 15, posicao: 3, tempo_s: null },
      { id: 'm4', playlist_id: 'p2', drive_id: 'F4', nome: '01_cardapio.jpg', tipo: 'imagem', situacao: 'ok', motivo: '', tamanho: 2202009, largura: 1920, altura: 1080, posicao: 1, tempo_s: 12 }],
    mi_telas: [
      { id: 't1', conta_id: 'c1', isenta: true, nome: 'Hall de entrada', playlist_id: 'p1', tela_largura: 3840, tela_altura: 2160, ultimo_sinal: min(1), versao_app: '1.0', modelo: 'TV box X96', android: '9', tocando: '01_black-friday.mp4', espaco_livre_mb: 6200, baixando: 0, erros: [] },
      { id: 't2', conta_id: 'c1', isenta: true, nome: 'Estacionamento', playlist_id: 'p2', ultimo_sinal: min(190), versao_app: '1.0', modelo: 'Google TV', android: '12', tocando: '', espaco_livre_mb: 300, baixando: 0, erros: [{ nome: 'promo.mp4', erro: 'este aparelho não toca o vídeo' }] },
      { id: 't3', conta_id: 'c1', isenta: true, nome: 'Vitrine da loja', playlist_id: 'p1', ultimo_sinal: min(2), versao_app: '1.3', modelo: 'TCL Smart TV', android: '14', tocando: '', espaco_livre_mb: 2400, baixando: 2, erros: [{ nome: '01_black-friday.mp4', erro: 'não baixou: Google Drive respondeu 403' }, { nome: '02_cardapio.jpg', erro: 'não baixou: Google Drive respondeu 403' }] }],
    codigos: { 'ABC234': 'livre', 'NOV234': 'livre' },
    mi_creditos: [],
    mi_exibicoes: (() => {
      const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
      return [
        { conta_id: 'c1', tela_id: 't1', tela_nome: 'Hall de entrada', dia: mes + '-01', drive_id: 'F1', nome: '01_black-friday.mp4', tipo: 'video', vezes: 100, segundos: 3000 },
        { conta_id: 'c1', tela_id: 't1', tela_nome: 'Hall de entrada', dia: mes + '-01', drive_id: 'F2', nome: '02_horario.png', tipo: 'imagem', vezes: 100, segundos: 1000 },
        { conta_id: 'c1', tela_id: 't1', tela_nome: 'Hall de entrada', dia: mes + '-02', drive_id: 'F1', nome: '01_black-friday.mp4', tipo: 'video', vezes: 50, segundos: 1500 },
        { conta_id: 'c1', tela_id: 'tX', tela_nome: 'Vitrine antiga', dia: mes + '-01', drive_id: 'F1', nome: '01_black-friday.mp4', tipo: 'video', vezes: 10, segundos: 300 },
        { conta_id: 'c2', tela_id: 'tY', tela_nome: 'Outra conta', dia: mes + '-01', drive_id: 'F9', nome: 'nao-aparece.mp4', tipo: 'video', vezes: 1, segundos: 99999 }];
    })(),
    log: []
  };
  const gravar = () => localStorage.setItem('db_teste', JSON.stringify(db));
  const admin = () => EU === 'u-admin';
  const pode = c => admin() || db.mi_acessos.some(a => a.user_id === EU && a.conta_id === c);
  const conta = id => db.mi_contas.find(c => c.id === id), pl = id => db.mi_playlists.find(p => p.id === id);
  const ver = { perfis: r => admin() || r.user_id === EU, app_acessos: r => admin() || r.user_id === EU, mi_contas: r => pode(r.id),
    mi_acessos: r => admin() || r.user_id === EU, mi_playlists: r => pode(r.conta_id), mi_midias: r => pode((pl(r.playlist_id) || {}).conta_id), mi_telas: r => pode(r.conta_id), mi_exibicoes: r => pode(r.conta_id) };
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
    gte(c, v) { this.f.push(r => r[c] >= v); return this; }
    lte(c, v) { this.f.push(r => r[c] <= v); return this; }
    range(a, b) { this.rg = [a, b]; return this; }
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
      let d = JSON.parse(JSON.stringify(sel()));
      if (this.rg) d = d.slice(this.rg[0], this.rg[1] + 1);
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
      db.mi_telas.push({ id, conta_id: p.p_conta, isenta: false, valida_ate: null, nome: p.p_nome, playlist_id: p.p_playlist, ultimo_sinal: null, versao_app: '', modelo: '', android: '', tocando: '', espaco_livre_mb: null, baixando: 0, erros: [] });
      db.log.push('vincular'); return ok(id);
    },
    mi_tela_salvar(p) { const t = db.mi_telas.find(x => x.id === p.p_tela); if (!t || !pode(t.conta_id)) return erro('TV não encontrada.'); t.nome = p.p_nome; t.playlist_id = p.p_playlist; db.log.push('tela'); return ok(null); },
    mi_tela_girar(p) { const t = db.mi_telas.find(x => x.id === p.p_tela); if (!t || !pode(t.conta_id)) return erro('TV não encontrada.'); t.rotacao = p.p_rotacao; return ok(null); },
    mi_desvincular(p) { const t = db.mi_telas.find(x => x.id === p.p_tela); if (!t || !pode(t.conta_id)) return erro('TV não encontrada.'); db.mi_telas = db.mi_telas.filter(x => x !== t); return ok(null); },
    mi_creditos_adicionar(p) {
      if (!admin()) return erro('Somente a equipe Nervia põe ou tira dias das TVs.');
      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const soma = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
      const lote = 'L' + db.mi_creditos.length;
      p.p.telas.forEach((id, i) => {
        const t = db.mi_telas.find(x => x.id === id), tol = conta(t.conta_id).tolerancia_dias;
        const base = !t.valida_ate || hoje > soma(t.valida_ate, tol) ? soma(hoje, -1) : t.valida_ate, antes = t.valida_ate;
        t.valida_ate = p.p.dias < 0 ? soma(t.valida_ate, p.p.dias) : soma(base, p.p.dias);
        db.mi_creditos.push({ id: db.mi_creditos.length + 1, lote, conta_id: t.conta_id, tela_id: id, tela_nome: t.nome, tipo: 'dias', dias: p.p.dias, antes, depois: t.valida_ate,
          valor: i === 0 && p.p.valor !== '' ? Number(p.p.valor) : null, obs: p.p.obs, user_nome: 'Marco', criado_em: new Date().toISOString() });
      });
      db.log.push('creditos:' + JSON.stringify(p.p)); return ok({ lote, telas: p.p.telas.length });
    },
    mi_tela_isenta(p) { if (!admin()) return erro('Somente a equipe Nervia muda a cobrança da TV.'); if ((p.p_motivo || '').trim().length < 5) return erro('Escreva o motivo.');
      db.mi_telas.find(x => x.id === p.p_tela).isenta = p.p_isenta; db.log.push('isenta:' + p.p_isenta); return ok(null); },
    mi_conta_tolerancia(p) { if (!admin()) return erro('Somente a equipe Nervia muda a tolerância.'); conta(p.p_conta).tolerancia_dias = p.p_dias; db.log.push('tolerancia:' + p.p_dias); return ok(null); },
    mi_creditos_extrato(p) { if (!pode(p.p_conta)) return ok([]);
      return ok(db.mi_creditos.filter(e => e.conta_id === p.p_conta).reverse().map(e => ({ ...e, valor: admin() ? e.valor : null, user_nome: admin() ? e.user_nome : 'Nervia' }))); },
    mi_tela_atualizar(p) { if (!admin()) return erro('Somente a equipe Nervia pede a atualização do app da TV.');
      let n = 0; p.p_telas.forEach(id => { const t = db.mi_telas.find(x => x.id === id); if (p.p_versao && t.versao_app === p.p_versao.nome) return;
        t.atualizar = p.p_versao ? { ...p.p_versao, pedido_em: new Date().toISOString() } : null; n++; });
      db.log.push('atualizar:' + p.p_telas.join(',') + ':' + (p.p_versao ? p.p_versao.nome : 'cancelar')); return ok(n); },
    mi_avisos_destinos(p) { if (!pode(p.p_conta)) return ok([]);
      return ok([...new Set(db.perfis.filter(x => x.admin || db.mi_acessos.some(a => a.user_id === x.user_id && a.conta_id === p.p_conta)).map(x => x.email))]); },
    mi_tela_trocar_aparelho(p) { const t = db.mi_telas.find(x => x.id === p.p_tela); if (!t || !pode(t.conta_id)) return erro('TV não encontrada.');
      if (db.codigos[p.p_codigo] !== 'livre') return erro('Código não encontrado. Confira o que aparece na TV nova.');
      db.codigos[p.p_codigo] = 'usado'; Object.assign(t, { modelo: '', ultimo_sinal: null, versao_app: '' }); db.log.push('trocar:' + t.id); return ok(null); },
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
  pg.on('pageerror', e => { erros.push(String(e)); if (process.env.DEPURAR) console.log('ERRO PAGINA', String(e)); });
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
    if (process.env.DEPURAR) console.log('AVISO', await pg.locator('#aviso').innerText(), await pg.locator('body').innerText().then(t => t.slice(0, 300)));
    const kpi = await pg.locator('.kpi').first().innerText();
    ok(kpi.includes('2 de 3'), 'KPI: 2 de 3 TVs online');
    const crit = await pg.locator('.aviso.crit').innerText();
    ok(crit.includes('Vitrine da loja') && crit.includes('403') && crit.includes('www.googleapis.com') && crit.includes('Não adianta esperar'), 'aviso: TV que não consegue baixar (403), com o que fazer');
    ok((await pg.locator('tr', { has: pg.locator('select[data-pl=t3]') }).innerText()).includes('não consegue baixar 2 arquivo(s)'), 'situação da TV: não consegue baixar (em vez de "baixando")');
    ok((await pg.locator('.aviso.warn').innerText()).includes('Estacionamento'), 'aviso da TV offline');
    ok((await pg.locator('#tela').innerText()).includes('este aparelho não toca o vídeo'), 'erro informado pela TV aparece');
    ok((await pg.locator('#tela').innerText()).includes('pouco espaço: 0,3 GB livres'), 'aviso de pouco espaço na TV');
    await print(pg, 'midia_tvs');
    // ---- Ver a mídia (player do Drive)
    await pg.route('https://drive.google.com/**', r => r.fulfill({ body: '<html><body>player do Drive</body></html>', contentType: 'text/html' }));
    await pg.locator('tr', { has: pg.locator('select[data-pl=t1]') }).locator('[data-acao=ver]').click();
    ok(await pg.locator('#dlg[open] iframe[src*="drive.google.com/file/d/F1/preview"]').count() === 1 && (await pg.locator('#dlg h3').innerText()) === '01_black-friday.mp4',
      'ver: o que a TV está tocando abre no player do Drive');
    await print(pg, 'midia_ver');
    await pg.click('#dlg button[value=x]'); await pg.waitForTimeout(100);
    ok(!(await pg.locator('#dlg').evaluate(d => d.open)) && (await pg.locator('#dlg iframe').count()) === 0, 'ver: fechar para o vídeo');
    await pg.click('.aba[data-v=playlists]'); await pg.waitForTimeout(150);
    ok(await pg.locator('.item [data-acao=ver]').count() >= 2, 'ver: cada mídia da playlist tem o ▶ Ver');
    await pg.click('.aba[data-v=telas]'); await pg.waitForTimeout(150);
    // ---- Relatório (tempo de tela)
    await pg.click('.aba[data-v=relatorio]'); await pg.waitForTimeout(300);
    const rel = await pg.locator('#tela').innerText();
    ok(rel.includes('1 h 36 min') && rel.includes('260') && !rel.includes('nao-aparece'), 'relatório: tempo total (5.800 s = 1 h 36 min) e exibições só da conta');
    ok(rel.includes('Vitrine antiga') && rel.includes('(desvinculada)'), 'relatório: TV desvinculada continua no relatório');
    const linhaVideo = await pg.locator('tr', { hasText: '01_black-friday.mp4' }).first().innerText();
    ok(linhaVideo.includes('1 h 20 min') && linhaVideo.includes('82,8%'), 'relatório: por mídia com tempo e % (4.800 de 5.800 s)');
    ok(rel.includes('% DO TEMPO DA TV') || rel.toLowerCase().includes('% do tempo da tv'), 'relatório: cada mídia em cada TV');
    await pg.selectOption('#relTela', 't1'); await pg.waitForTimeout(150);
    const rel2 = await pg.locator('.kpis').innerText(), tabelas2 = await pg.locator('#tela table').allInnerTexts();
    ok(rel2.includes('1 h 31 min') && rel2.includes('média por dia') && !tabelas2.join(' ').includes('Vitrine antiga') && tabelas2.length === 1, 'relatório: filtro por TV (5.500 s) com média por dia');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('[data-acao=relCsv]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(csv.charCodeAt(0) === 0xfeff && csv.includes('Dia;TV;Mídia;Tipo;Exibições;Segundos;Tempo de tela') && csv.split('\r\n').length === 4 && csv.includes('Hall de entrada;01_black-friday.mp4;vídeo;100;3000;50 min 00 s'),
      'relatório: CSV por dia da TV escolhida, para o Excel');
    const [jan] = await Promise.all([pg.waitForEvent('popup'), pg.click('[data-acao=relImprimir]')]);
    await jan.waitForLoadState();
    const html = await jan.content(), txtJan = await jan.locator('body').innerText();
    ok(txtJan.includes('Relatório de tempo de tela') && txtJan.includes('Hall de entrada') && txtJan.includes('1 h 31 min') && txtJan.includes('Tempo em que cada mídia ficou'),
      'relatório: impressão numa janela só com o relatório (cabeçalho, números e nota)');
    ok(!/Mídia Indoor<\/b>|class="barra|data-v="telas"|Imprimir \/ PDF|<select|<button/.test(html) && /@page\{size:A4;margin:0\}/.test(html),
      'relatório: impressão sem o topo do site, sem menu e sem botões; margem da folha zero (sem cabeçalho do navegador)');
    if (SAIDA) { await jan.setViewportSize({ width: 794, height: 1123 }); await jan.screenshot({ path: path.join(SAIDA, 'midia_relatorio_impressao.png'), fullPage: true }); }
    await jan.close();
    await pg.fill('#relMes', '2020-01'); await pg.dispatchEvent('#relMes', 'change'); await pg.waitForTimeout(200);
    ok((await pg.locator('#tela').innerText()).includes('Nenhuma exibição registrada em janeiro de 2020'), 'relatório: mês sem exibições avisa');
    await pg.click('.aba[data-v=telas]'); await pg.waitForTimeout(150);
    // trocar playlist
    await pg.selectOption('select[data-pl=t1]', 'p2');
    await pg.waitForTimeout(200);
    ok((await db(pg)).mi_telas.find(t => t.id === 't1').playlist_id === 'p2', 'troca de playlist grava pela rpc');
    ok((await pg.locator('#msg').innerText()).includes('no fim do item'), 'mensagem da troca no fim do item');
    // posição da TV
    await pg.selectOption('select[data-rot=t1]', '90');
    await pg.waitForTimeout(200);
    ok((await db(pg)).mi_telas.find(t => t.id === 't1').rotacao === 90 && (await pg.locator('#msg').innerText()).includes('em pé'), 'posição da TV (em pé) grava pela rpc');
    ok(!(await pg.locator('tr', { has: pg.locator('select[data-rot=t1]') }).innerText()).includes('pouco espaço'), 'sem aviso de espaço na TV com espaço sobrando');
    const linhaT1 = await pg.locator('tr', { has: pg.locator('select[data-rot=t1]') }).innerText();
    ok(linhaT1.includes('Formato ideal: em pé 9:16') && linhaT1.includes('vídeo 1080×1920') && linhaT1.includes('até 2160×3840'),
      'formato ideal: TV 4K em pé → vídeo 1080×1920, foto até 2160×3840');
    ok((await pg.locator('tr', { has: pg.locator('select[data-rot=t2]') }).innerText()).includes('aparece quando a TV tiver o app 1.9'), 'formato ideal: TV sem a resolução avisa');
    await pg.locator('tr', { has: pg.locator('select[data-rot=t1]') }).locator('[data-acao=copiarFormato]').click(); await pg.waitForTimeout(150);
    const copia = await pg.locator('#msg').innerText();
    ok(copia.includes('EM PÉ (vertical)') && copia.includes('Vídeo: MP4 (H.264), 1080×1920') && copia.includes('fundo desfocado'), 'formato ideal: mensagem pronta para o cliente');
    await pg.click('.aba[data-v=playlists]'); await pg.waitForTimeout(150);
    await pg.click('[data-plsel=p2]'); await pg.waitForTimeout(150);   // a TV Hall de entrada foi trocada para esta playlist acima
    const plTxt = await pg.locator('#tela').innerText();
    ok(plTxt.includes('Formato diferente da TV "Hall de entrada" (em pé 9:16): aparece com fundo desfocado'),
      'playlist: foto deitada numa TV em pé avisa (fundo desfocado)');
    await pg.click('[data-plsel=p1]'); await pg.waitForTimeout(150);
    ok(!(await pg.locator('#tela').innerText()).includes('Formato diferente'), 'playlist: sem TV em pé nesta playlist, sem aviso');
    await pg.click('.aba[data-v=telas]'); await pg.waitForTimeout(150);
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
    ok((await pg.locator('#msg').innerText()).includes('qualquer pessoa com o link') && (await pg.locator('.aviso.crit', { hasText: 'Não foi possível ler a pasta' }).count()) === 1, 'pasta não compartilhada: erro claro no painel');

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

    // ---------------- dias de uso (créditos por TV)
    await adm.pg.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('db_teste')), hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      const soma = n => { const x = new Date(hoje + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
      const t = id => d.mi_telas.find(x => x.id === id);
      Object.assign(t('t1'), { isenta: false, valida_ate: soma(4) });     // acabando (5 dias com hoje)
      Object.assign(t('t3'), { isenta: false, valida_ate: soma(-10) });   // pausada (tolerância de 3)
      localStorage.setItem('db_teste', JSON.stringify(d)); localStorage.setItem('midia-conta', 'c1');
    });
    await adm.pg.reload(); await adm.pg.waitForTimeout(400);
    const avCrit = await adm.pg.locator('.aviso.crit', { hasText: 'dias de uso' }).innerText(), avWarn = await adm.pg.locator('.aviso.warn', { hasText: 'Dias de uso acabando' }).innerText();
    ok(avCrit.includes('Vitrine da loja') && avCrit.includes('pausada') && avWarn.includes('Hall de entrada') && avWarn.includes('5 dias'), 'dias de uso: avisos de TV pausada e de dias acabando');
    const linhaCr = await adm.pg.locator('tr', { has: adm.pg.locator('select[data-pl=t1]') }).innerText();
    ok(linhaCr.includes("acabando") && linhaCr.includes('pôr dias'), 'dias de uso: coluna na TV com o botão da Nervia');
    ok((await adm.pg.locator('tr', { has: adm.pg.locator('select[data-pl=t2]') }).innerText()).includes('isenta'), 'dias de uso: TV isenta');
    await adm.pg.click('[data-acao=porDias]:not([data-id])'); await adm.pg.waitForTimeout(150);
    ok((await adm.pg.locator('#dlgf .pTv:checked').count()) === 3, 'pôr dias: sem TV escolhida, todas vêm marcadas');
    await adm.pg.uncheck('#dlgf .pTv[value=t2]');
    await adm.pg.click('#dlgf [data-pd="90"]');
    await print(adm.pg, 'midia_por_dias');
    ok((await adm.pg.locator('#pDep-t3').innerText()).includes('até ' + (() => { const x = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 89); return x.toISOString().slice(0, 10).split('-').reverse().join('/'); })()),
      'pôr dias: prévia — TV pausada conta a partir de hoje');
    await adm.pg.fill('#pValor', '149,70'); await adm.pg.fill('#pObs', 'Pix 19/11');
    await adm.pg.click('#pOk'); await adm.pg.waitForTimeout(300);
    const dc = await db(adm.pg), lg = dc.log.find(l => l.startsWith('creditos:'));
    ok(lg && JSON.parse(lg.slice(9)).telas.join() === 't1,t3' && JSON.parse(lg.slice(9)).dias === 90 && JSON.parse(lg.slice(9)).valor === '149.70', 'pôr dias: 90 dias em duas TVs de uma vez, valor em reais lido certo');
    ok((await adm.pg.locator('.aviso.crit', { hasText: 'dias de uso' }).count()) === 0 && (await adm.pg.locator('#msg').innerText()).includes('2 TVs'), 'pôr dias: TV volta a ficar em dia');
    await adm.pg.click('[data-acao=extrato]'); await adm.pg.waitForTimeout(200);
    const ext = await adm.pg.locator('#dlgf').innerText();
    ok((await adm.pg.locator('#avDest').innerText()).includes('mkt@lojaexemplo.com.br') && (await adm.pg.locator('#avDest').innerText()).includes('7, 3 e 1 dia'),
      'extrato: mostra quem recebe o aviso por e-mail');
    ok(ext.includes('+90') && /R\$\s149,70/.test(ext) && ext.includes('Pix 19/11'), 'extrato: Nervia vê dias, valor e observação');
    await adm.pg.click('#dlg button[value=x]'); await adm.pg.waitForTimeout(100);
    await adm.pg.click('[data-acao=trocarAparelho][data-id=t1]'); await adm.pg.fill('#tCod', 'nov234'); await adm.pg.click('#tOk'); await adm.pg.waitForTimeout(250);
    ok((await db(adm.pg)).log.includes('trocar:t1') && (await adm.pg.locator('#msg').innerText()).includes('trocado'), 'trocar aparelho pelo código, mantendo a TV');
    await print(adm.pg, 'midia_creditos');
    // ---------------- atualização do app pelo painel
    const adm2 = await pagina(b, 'admin');
    await adm2.ctx.route('**/tv.json', r => r.fulfill({ body: JSON.stringify({ codigo: 13, nome: '1.12', sha256: 'c'.repeat(64) }), contentType: 'application/json' }));
    await adm2.pg.evaluate(() => { const d = window.__db; d.mi_telas[0].versao_app = '1.11'; d.mi_telas[2].versao_app = '1.12'; localStorage.setItem('db_teste', JSON.stringify(d)); });
    await adm2.pg.reload(); await adm2.pg.waitForTimeout(500);
    const lApp = t => adm2.pg.locator('tr', { has: adm2.pg.locator(`select[data-pl=${t}]`) }).innerText();
    ok((await lApp('t1')).includes('app desatualizado (1.12 disponível)') && (await lApp('t1')).includes('atualizar app'), 'app: TV 1.11 desatualizada com o botão');
    ok((await lApp('t2')).includes('instale à mão'), 'app: TV antiga (sem atualizador) pede a instalação à mão');
    ok(!(await lApp('t3')).includes('desatualizado'), 'app: TV já na versão publicada não mostra aviso');
    ok((await adm2.pg.locator('[data-acao=appAtualizarTodas]').innerText()).includes('1 TV'), 'app: "Atualizar app" conta só as TVs que se atualizam');
    adm2.pg.removeAllListeners('dialog'); adm2.pg.on('dialog', d => d.accept());
    await adm2.pg.click('[data-acao=appAtualizar][data-id=t1]'); await adm2.pg.waitForTimeout(300);
    ok((await db(adm2.pg)).log.includes('atualizar:t1:1.12') && (await lApp('t1')).includes('atualização para 1.12 pedida'), 'app: pedido gravado e mostrado na TV');
    await adm2.pg.evaluate(() => { const d = window.__db; d.mi_telas[0].erros = [{ nome: 'Atualização do app', erro: 'versão 1.12: tela de instalação aberta na TV, falta apertar Instalar' }]; localStorage.setItem('db_teste', JSON.stringify(d)); });
    await adm2.pg.reload(); await adm2.pg.waitForTimeout(500);
    ok((await lApp('t1')).includes('falta apertar Instalar') && !(await lApp('t1')).includes('Atualização do app:'), 'app: situação da TV na coluna Aparelho, fora dos erros');
    await adm2.pg.click('[data-acao=appCancelar][data-id=t1]'); await adm2.pg.waitForTimeout(300);
    ok((await db(adm2.pg)).log.includes('atualizar:t1:cancelar'), 'app: cancelar o pedido');
    await print(adm2.pg, 'midia_atualizar');
    ok(adm2.erros.length === 0, 'app: sem erros de JavaScript ' + adm2.erros.join(' | '));
    await adm.pg.click('#abaAdmin'); await adm.pg.waitForTimeout(250);
    await adm.pg.click('[data-acao=editConta][data-id=c1]'); await adm.pg.fill('#aTol', '7'); await adm.pg.click('#aOk'); await adm.pg.waitForTimeout(300);
    ok((await db(adm.pg)).log.includes('tolerancia:7'), 'conta: tolerância dos dias de uso');
    // cliente vê os dias e o extrato, sem valor e sem o botão
    const cli2 = await pagina(b, 'cliente');
    await cli2.pg.evaluate(() => { const d = window.__db; d.mi_telas[0].isenta = false; d.mi_telas[0].valida_ate = '2000-01-01';
      d.mi_creditos.push({ id: 1, lote: 'L', conta_id: 'c1', tela_id: 't1', tela_nome: 'Hall de entrada', tipo: 'dias', dias: 30, antes: null, depois: '2000-01-01', valor: 99, obs: 'Pix', user_nome: 'Marco', criado_em: new Date().toISOString() });
      localStorage.setItem('db_teste', JSON.stringify(d)); });
    await cli2.pg.reload(); await cli2.pg.waitForTimeout(400);
    ok((await cli2.pg.locator('.aviso.crit', { hasText: 'dias de uso' }).innerText()).includes('Fale com a Nervia') && (await cli2.pg.locator('[data-acao=porDias]').count()) === 0,
      'cliente: vê a TV pausada e não põe dias');
    await cli2.pg.click('[data-acao=extrato]'); await cli2.pg.waitForTimeout(200);
    const ext2 = await cli2.pg.locator('#dlgf').innerText();
    ok(ext2.includes('+30') && !ext2.includes('R$') && !ext2.includes('Marco'), 'cliente: extrato sem valor e sem quem lançou');
    ok(cli2.erros.length === 0, 'cliente (dias de uso): sem erros de JavaScript ' + cli2.erros.join(' | '));
    ok(adm.erros.length === 0, 'admin: sem erros de JavaScript ' + adm.erros.join(' | '));

    // ---------------- ajuda
    for (const f of ['cartao', 'manual', 'instalacao', 'compatibilidade']) {
      const a = await pagina(b, 'cliente', 1100, `/apps/midia/ajuda/${f}.html`);
      ok((await a.pg.title()).includes('Mídia Indoor') && a.erros.length === 0, `ajuda: ${f} abre sem erro`);
      await print(a.pg, 'midia_' + f);
    }
  } finally { await b.close(); srv.close(); }
  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
})();
