// Monta a pasta publicada na Cloudflare (publicado/) a partir de site/, SEM os comentários
// do código (pedido do Marco em 02/11/2026: o público não precisa ver como o sistema é feito).
// Roda sozinho em todo "wrangler deploy" / "wrangler dev" (build.command no wrangler.jsonc).
// O código continua comentado no GitHub; só a cópia publicada sai limpa.
//
// - .js: reimpresso pelo terser SEM compressão e SEM troca de nomes (o código é o mesmo, só
//   sem comentários e sem espaços extras).
// - .html: comentários <!-- --> fora; <script> de JavaScript pelo mesmo terser; <style> e
//   style="" sem /* */.
// - .css: sem /* */.
// - O resto (imagens, _headers, .json…) é copiado igual.
// Qualquer erro interrompe a publicação (a versão no ar continua a anterior).
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify as terser } from "terser";
import { minify as htmlMin } from "html-minifier-terser";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGEM = path.join(RAIZ, "site");
const DESTINO = path.join(RAIZ, "publicado");

// ecma 2020 + keep_quoted_props: mantém {a} e {"a": 1} como estão (sem isso o terser reescreve).
const OPC_JS = { compress: false, mangle: false, ecma: 2020, format: { comments: false, ecma: 2020, keep_quoted_props: true } };

async function limparJs(codigo, nome) {
  let erro;
  for (const module of [false, true]) {          // script comum primeiro; import/export = módulo
    try {
      const r = await terser(codigo, { ...OPC_JS, module });
      if (typeof r.code !== "string") throw new Error("terser sem saída");
      return r.code;
    } catch (e) { erro = e; }
  }
  throw new Error(`${nome}: JavaScript não reconhecido (${erro.message})`);
}

// Tira /* … */ do CSS respeitando textos entre aspas.
function limparCss(css) {
  let out = "", i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1); i = j + 1;
    } else if (c === "/" && css[i + 1] === "*") {
      const fim = css.indexOf("*/", i + 2);
      if (fim < 0) throw new Error("comentário de CSS sem fechamento");
      i = fim + 2;
    } else { out += c; i++; }
  }
  return out;
}

async function limparHtml(html, nome) {
  const pendentes = [];
  // html-minifier-terser chama minifyJS de forma síncrona; o terser é assíncrono. Então:
  // 1ª passada marca cada script, depois troca pelos resultados.
  const marcados = await htmlMin(html, {
    removeComments: true,
    continueOnParseError: false,
    minifyCSS: (css) => limparCss(css),
    minifyJS: (js, inline) => {
      if (inline) return js;                      // onclick="…" etc.: fica como está
      const id = `__NERVIA_JS_${pendentes.length}__`;
      pendentes.push(limparJs(js, `${nome} <script> nº ${pendentes.length + 1}`));
      return id;
    },
  });
  const prontos = await Promise.all(pendentes);
  let out = marcados;
  prontos.forEach((js, n) => {
    const id = `__NERVIA_JS_${n}__`;
    if (out.split(id).length !== 2) throw new Error(`${nome}: marcador do script ${n + 1} não encontrado`);
    out = out.replace(id, () => js);
  });
  return out;
}

async function percorrer(dir) {
  const itens = await fs.readdir(dir, { withFileTypes: true });
  const lista = [];
  for (const it of itens) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) lista.push(...await percorrer(p)); else lista.push(p);
  }
  return lista;
}

const inicio = Date.now();
await fs.rm(DESTINO, { recursive: true, force: true });
const arquivos = await percorrer(ORIGEM);
const conta = { js: 0, html: 0, css: 0, outros: 0, antes: 0, depois: 0 };
for (const arq of arquivos) {
  const rel = path.relative(ORIGEM, arq);
  const alvo = path.join(DESTINO, rel);
  await fs.mkdir(path.dirname(alvo), { recursive: true });
  const ext = path.extname(arq).toLowerCase();
  if (![".js", ".mjs", ".html", ".htm", ".css"].includes(ext)) {
    await fs.copyFile(arq, alvo); conta.outros++; continue;
  }
  const texto = await fs.readFile(arq, "utf8");
  let saida;
  if (ext === ".js" || ext === ".mjs") { saida = await limparJs(texto, rel); conta.js++; }
  else if (ext === ".css") { saida = limparCss(texto); conta.css++; }
  else { saida = await limparHtml(texto, rel); conta.html++; }
  conta.antes += Buffer.byteLength(texto); conta.depois += Buffer.byteLength(saida);
  await fs.writeFile(alvo, saida);
}
console.log(`publicado/: ${conta.html} html, ${conta.js} js, ${conta.css} css limpos; ${conta.outros} copiados; ` +
  `${(conta.antes / 1024).toFixed(0)} KB → ${(conta.depois / 1024).toFixed(0)} KB em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
