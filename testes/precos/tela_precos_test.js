// Teste de tela da aba Administração → Preços da Área do Cliente, com o Supabase falso (testes/supabase_falso.js)
// acrescido das tabelas de preço e das rpcs (imitação das regras de ..._precos.sql; as regras em si estão no teste SQL).
// Uso: node testes/precos/tela_precos_test.js [pasta_prints]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..', '..');
const PRINTS = process.argv[2];
let FALSO = fs.readFileSync(path.join(RAIZ, 'testes', 'supabase_falso.js'), 'utf8');
const TABELAS = `const db = {
    salario_minimo: [{ vigencia: "2025-01-01", valor: 1518, fonte: "Decreto 12.342/2024" }, { vigencia: "2026-01-01", valor: 1621, fonte: "Decreto 12.797/2025 (DOU 24/12/2025)" }],
    preco_itens: [
      { id: "notas", app_id: "notas", nome: "Buscador de NF", unidade: "CNPJ / mês", cobranca: "mensal", modo: "percentual", percentual: 2.5, valor: 39.9, valor_desde: "2026-11-04", sm_referencia: 1621, obs: "", ordem: 10, ativo: true },
      { id: "compras", app_id: null, nome: "Orçamentos de Compras", unidade: "unidade / mês", cobranca: "mensal", modo: "percentual", percentual: 6, valor: 94.9, valor_desde: "2026-11-04", sm_referencia: 1621, obs: "", ordem: 40, ativo: true },
      { id: "linum", app_id: null, nome: "Sistema Linum", unidade: "contrato próprio", cobranca: "negociar", modo: "percentual", percentual: null, valor: null, valor_desde: null, sm_referencia: null, obs: "App exclusivo da Linum.", ordem: 110, ativo: true }],
    preco_historico: [],`;
const RPC = `
  const arred = (x) => Math.round((Math.max(Math.round(x / 5) * 5, 5) - 0.10) * 100) / 100;
  const smHoje = () => db.salario_minimo.filter((s) => s.vigencia <= new Date().toISOString().slice(0, 10)).sort((a, b) => a.vigencia < b.vigencia ? 1 : -1)[0].valor;
  const hist = (i, motivo, antes) => db.preco_historico.push({ id: db.preco_historico.length + 1, item_id: i.id, em: new Date().toISOString(), quem: "Marco", motivo, antes, depois: { valor: i.valor, percentual: i.percentual } });
  window.__rpc = async (nome, args) => {
    window.__chamadas.push(["rpc:" + nome, args]);
    if (nome === "apps_vitrine") return { data: [], error: null };
    if (papel !== "admin") return { data: null, error: { message: "Só a equipe Nervia vê os preços." } };
    const sm = smHoje();
    if (nome === "precos_lista") return { data: db.preco_itens.map((i) => { const sug = i.modo === "percentual" && i.percentual != null ? arred(sm * i.percentual / 100) : null;
      return { ...i, sm_atual: sm, sugerido: sug, percentual_efetivo: i.valor != null ? Math.round(i.valor / sm * 100000) / 1000 : null,
        reajuste: i.ativo && sug != null && ["mensal", "avulso"].includes(i.cobranca) && i.valor !== sug }; }).sort((a, b) => a.ordem - b.ordem), error: null };
    if (nome === "preco_salvar") { const p = args.p; let i = db.preco_itens.find((x) => x.id === p.id); const novo = !i;
      if (novo) { i = { id: p.id, app_id: null, nome: "", unidade: "", cobranca: "mensal", modo: "percentual", percentual: null, valor: null, obs: "", ordem: 0, ativo: true }; }
      const antes = { valor: i.valor, percentual: i.percentual }, pctAntes = i.percentual;
      for (const k of ["nome", "app_id", "unidade", "cobranca", "modo", "obs", "ativo"]) if (k in p) i[k] = p[k];
      if ("percentual" in p) i.percentual = p.percentual === "" ? null : p.percentual;
      if ("ordem" in p) i.ordem = Number(p.ordem) || 0;
      if (p.valor != null && p.valor !== "") { if (p.valor <= 0) return { data: null, error: { message: "O valor precisa ser maior que zero." } }; i.valor = p.valor; }
      else if (i.modo === "percentual" && (novo || i.percentual !== pctAntes)) { if (i.percentual == null) return { data: null, error: { message: "Informe o percentual do salário mínimo." } }; i.valor = arred(sm * i.percentual / 100); }
      if (i.valor !== antes.valor) { i.valor_desde = p.vale_desde; i.sm_referencia = sm; }
      if (novo) db.preco_itens.push(i);
      hist(i, novo ? "item criado" : (p.motivo || "alterado pela Nervia"), novo ? null : antes);
      return { data: null, error: null }; }
    if (nome === "precos_aprovar_reajuste") { let n = 0;
      for (const i of db.preco_itens.filter((x) => args.p_ids.includes(x.id) && x.modo === "percentual" && x.percentual != null)) {
        const v = arred(sm * i.percentual / 100); if (v === i.valor) continue; const antes = { valor: i.valor, percentual: i.percentual };
        i.valor = v; i.sm_referencia = sm; i.valor_desde = args.p_vale_desde; hist(i, "reajuste pelo salário mínimo de R$ " + sm, antes); n++; }
      return { data: n, error: null }; }
    if (nome === "salario_minimo_salvar") { db.salario_minimo.push({ vigencia: args.p_vigencia, valor: args.p_valor, fonte: args.p_fonte }); return { data: null, error: null }; }
    return { data: null, error: { message: "rpc desconhecida " + nome } };
  };`;
if (!FALSO.includes('const db = {') || !FALSO.includes('from: consulta,') || !FALSO.includes('window.__chamadas = [];')) throw new Error('supabase_falso.js mudou');
FALSO = FALSO.replace('const db = {', TABELAS).replace('window.__chamadas = [];', 'window.__chamadas = [];' + RPC).replace('from: consulta,', 'from: consulta, rpc: (n, a) => window.__rpc(n, a),');
const CONFIG = 'window.NERVIA_CONFIG={SUPABASE_URL:"https://teste.supabase.co",SUPABASE_ANON_KEY:"x"};';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let f = path.join(RAIZ, 'site', decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});

const falhas = [];
const ok = (c, nome) => { console.log((c ? 'ok  ' : 'FALHOU ') + nome); if (!c) falhas.push(nome); };

(async () => {
  await new Promise(r => srv.listen(8824, '127.0.0.1', r));
  const nav = await chromium.launch();
  const pg = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = []; pg.on('pageerror', e => erros.push(String(e)));
  pg.on('dialog', d => d.accept());
  await pg.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await pg.route('**/config.js', r => r.fulfill({ body: CONFIG, contentType: 'text/javascript' }));
  await pg.goto('http://127.0.0.1:8824/cliente/?papel=admin#admin');
  await pg.waitForSelector('#abaPrc');
  ok(await pg.isVisible('#abaPrc'), 'aba Preços aparece para a equipe Nervia');
  await pg.click('#abaPrc');
  await pg.waitForSelector('#tPrecos');
  let t = await pg.innerText('#admConteudo');
  ok(t.includes('R$ 1.621,00') && t.includes('Decreto 12.797/2025'), 'mostra o salário mínimo em vigor e a fonte');
  ok(t.includes('Buscador de NF') && t.includes('2,5% do mínimo') && t.includes('R$ 39,90'), 'mostra percentual e valor aprovado');
  ok(t.includes('A negociar') && t.includes('Sistema Linum'), 'item a negociar sem valor');
  ok(t.includes('em dia com o salário mínimo') && (await pg.$$('.pMarca')).length === 0, 'sem reajuste com o mínimo atual');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'precos-lista.png'), fullPage: true });

  // mudar o percentual: prévia e valor recalculado
  await pg.click('#tPrecos tr:has-text("Buscador de NF") button:has-text("editar")');
  await pg.fill('#pPct', '3');
  ok((await pg.innerText('#pPrev')).includes('R$ 49,90'), 'prévia do valor pelo percentual (3% → R$ 49,90)');
  await pg.fill('#pMotivo', 'teste de percentual');
  await pg.click('#pEditor button:has-text("Salvar")');
  await pg.waitForFunction(() => document.querySelector('#msgAdm').innerText.includes('Preço salvo'));
  t = await pg.innerText('#tPrecos');
  ok(t.includes('3% do mínimo') && t.includes('R$ 49,90'), 'novo percentual gravado e valor recalculado');
  ok(await pg.evaluate(() => window.__chamadas.some(c => c[0] === 'rpc:preco_salvar' && c[1].p.id === 'notas' && c[1].p.percentual === 3 && !('valor' in c[1].p) && c[1].p.motivo === 'teste de percentual')), 'envia percentual e motivo, sem valor');

  // valor à mão
  await pg.click('#tPrecos tr:has-text("Orçamentos de Compras") button:has-text("editar")');
  await pg.fill('#pValor', '89,90');
  ok((await pg.innerText('#pPrev')).includes('R$ 89,90') && (await pg.innerText('#pPrev')).includes('o percentual daria R$ 94,90'), 'prévia do valor à mão com o que o percentual daria');
  await pg.click('#pEditor button:has-text("Salvar")');
  await pg.waitForFunction(() => document.querySelector('#tPrecos').innerText.includes('R$ 89,90'));
  ok((await pg.innerText('#tPrecos')).includes('valor ajustado à mão (o percentual daria R$ 94,90)'), 'valor à mão aparece como ajustado, sem pedir reajuste');
  ok((await pg.$$('.pMarca')).length === 0, 'ajuste à mão não vira reajuste a aprovar');

  // item novo com valor fixo
  await pg.click('button:has-text("+ Novo item")');
  await pg.fill('#pId', 'produtos'); await pg.fill('#pNome', 'Controle de Produtos'); await pg.fill('#pUnid', 'loja / mês');
  await pg.selectOption('#pModo', 'fixo'); await pg.fill('#pValor', '45');
  await pg.click('#pEditor button:has-text("Salvar")');
  await pg.waitForFunction(() => document.querySelector('#tPrecos').innerText.includes('Controle de Produtos'));
  ok((await pg.innerText('#tPrecos tr:has-text("Controle de Produtos")')).includes('valor fixo') && (await pg.innerText('#tPrecos')).includes('R$ 45,00'), 'item novo com valor fixo');

  // salário mínimo novo → reajuste sugerido → aprovar
  await pg.fill('#smData', '2026-01-02'); await pg.fill('#smValor', '1.900,00'); await pg.fill('#smFonte', 'Decreto de teste');
  await pg.click('form:has(#smData) button');
  await pg.waitForFunction(() => document.querySelector('#msgAdm').innerText.includes('Salário mínimo cadastrado'));
  t = await pg.innerText('#admConteudo');
  ok(t.includes('R$ 1.900,00') && t.includes('reajuste sugerido: R$ 54,90') && t.includes('reajuste sugerido: R$ 114,90'), 'mínimo novo sugere reajuste (3% de 1.900 → R$ 54,90; 6% → R$ 114,90)');
  ok((await pg.innerText('#tPrecos')).includes('R$ 49,90'), 'preço não muda sozinho');
  const marcas = await pg.$$eval('.pMarca', l => l.map(c => c.value));
  ok(marcas.includes('notas') && marcas.includes('compras') && !marcas.includes('produtos') && !marcas.includes('linum'), 'só itens de percentual podem ser reajustados');
  await pg.uncheck('.pMarca[value=compras]');
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'precos-reajuste.png'), fullPage: true });
  await pg.click('button:has-text("Aprovar o reajuste dos marcados")');
  await pg.waitForFunction(() => document.querySelector('#msgAdm').innerText.includes('reajustado'));
  t = await pg.innerText('#tPrecos');
  ok(t.includes('R$ 54,90') && t.includes('R$ 89,90'), 'aprovado só o marcado');
  const hist = await pg.innerText('#admConteudo');
  ok(hist.includes('Histórico de preços') && hist.includes('reajuste pelo salário mínimo') && hist.includes('teste de percentual'), 'histórico com os motivos');

  // cliente não vê a aba; demo esconde
  const cli = await nav.newPage();
  await cli.route('**/supabase-js@*/**', r => r.fulfill({ body: FALSO, contentType: 'text/javascript' }));
  await cli.route('**/config.js', r => r.fulfill({ body: CONFIG, contentType: 'text/javascript' }));
  await cli.goto('http://127.0.0.1:8824/cliente/?papel=cliente');
  await cli.waitForTimeout(500);
  ok(!(await cli.isVisible('#bAdmin')) && !(await cli.isVisible('#abaPrc')), 'cliente não vê Administração nem Preços');

  // celular sem rolagem lateral da página
  await pg.setViewportSize({ width: 390, height: 800 });
  await pg.click('#abaPrc'); await pg.waitForSelector('#tPrecos');
  const largos = await pg.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('[style*="overflow-x:auto"]')).slice(0, 5).map(e => e.tagName + '#' + e.id + '.' + e.className));
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'celular sem rolagem lateral' + (largos.length ? ' (passam da tela: ' + largos.join(', ') + ')' : ''));
  if (PRINTS) await pg.screenshot({ path: path.join(PRINTS, 'precos-celular.png'), fullPage: true });

  ok(erros.length === 0, 'sem erro de JavaScript' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await nav.close(); srv.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTODOS OK');
  process.exit(falhas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
