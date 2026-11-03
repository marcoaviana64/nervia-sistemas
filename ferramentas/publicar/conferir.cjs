// Confere a pasta publicado/ contra site/: cada arquivo tem de ter a MESMA estrutura (JavaScript pelo
// acorn, HTML pelo parse5, CSS e o resto byte a byte), só sem comentários. Diferenças aceitas, que não
// mudam nada no navegador: {a} = {a: a}; chave {"1": x} = {1: x}; defer = defer="defer";
// espaços no content do meta viewport. Roda depois do limpar.mjs em todo deploy: diferença = erro,
// a publicação para e o site no ar continua o anterior.
// Uso: node ferramentas/publicar/conferir.cjs [site] [publicado]
const fs=require('fs'),path=require('path'),acorn=require('acorn'),parse5=require('parse5');
const raiz=path.resolve(__dirname,'..','..');
const A=process.argv[2]||path.join(raiz,'site'),B=process.argv[3]||path.join(raiz,'publicado');
function ast(code){for(const st of ['script','module']){try{return JSON.stringify(acorn.parse(code,{ecmaVersion:'latest',sourceType:st,allowHashBang:true}),(k,v)=>{if(['start','end','loc','range','raw','shorthand'].includes(k))return undefined; if(v&&v.type==='Property'&&!v.computed&&v.key&&(v.key.type==='Identifier'||v.key.type==='Literal')){return {...v,key:{chave:String(v.key.type==='Identifier'?v.key.name:v.key.value)}}} return v})}catch(e){}}throw new Error('parse')}
const isJs=n=>{const t=(n.attrs.find(a=>a.name==='type')||{}).value;return !t||/javascript|module/i.test(t)};
function walk(n,out){ // estrutura do HTML sem comentários; scripts JS comparados pelo AST; style sem /* */
  if(n.nodeName==='#comment')return;
  if(n.nodeName==='#text'){out.push(['t',n.value]);return}
  const nome=n.tagName||n.nodeName; out.push(['<',nome,JSON.stringify((n.attrs||[]).map(a=>[a.name,a.value===a.name?'':a.name==='style'?a.value.replace(/\/\*[\s\S]*?\*\//g,''):(a.name==='content'?a.value.replace(/,\s+/g,',').replace('scale=1.0','scale=1'):a.value)]))]);
  if(nome==='script'&&isJs(n)){const code=(n.childNodes||[]).map(c=>c.value).join('');out.push(['js',code.trim()?ast(code):'']);out.push(['>',nome]);return}
  if(nome==='style'){out.push(['css',(n.childNodes||[]).map(c=>c.value).join('').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,' ').trim()]);out.push(['>',nome]);return}
  const kids=n.content?n.content.childNodes:(n.childNodes||[]);for(const c of kids)walk(c,out);out.push(['>',nome]);}
let ok=0,dif=[];
function files(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)])}
for(const f of files(A)){const r=path.relative(A,f),g=path.join(B,r),ext=path.extname(f);
  try{ if(ext==='.js'){ if(ast(fs.readFileSync(f,'utf8'))!==ast(fs.readFileSync(g,'utf8')))throw 0 }
  else if(ext==='.html'){const o=[],l=[];walk(parse5.parse(fs.readFileSync(f,'utf8')),o);walk(parse5.parse(fs.readFileSync(g,'utf8')),l);
     // texto: junta nós de texto vizinhos (tirar comentário pode unir dois textos)
     const norm=a=>{const r=[];for(const x of a){if(x[0]==='t'&&r.length&&r[r.length-1][0]==='t')r[r.length-1]=['t',r[r.length-1][1]+x[1]];else r.push(x)}return JSON.stringify(r)};
     if(norm(o)!==norm(l))throw 0}
  else if(ext==='.css'){const n=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,' ').trim(); if(n(fs.readFileSync(f,'utf8'))!==n(fs.readFileSync(g,'utf8')))throw 0}
  else { if(!fs.readFileSync(f).equals(fs.readFileSync(g)))throw 0 }
  ok++}catch(e){dif.push(r+(e&&e.message?' '+e.message:''))}}
console.log('conferência: '+ok+' arquivos com a mesma estrutura; diferentes: '+dif.length);dif.forEach(d=>console.log('  '+d));
if(dif.length||!ok)process.exit(1);
