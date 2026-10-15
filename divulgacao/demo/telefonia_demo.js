// Monta os dados da demonstração da Auditoria de Telefonia Móvel (/demo/telefonia/) a partir das
// exportações FICTÍCIAS de testes/telefonia/exemplo, usando o mesmo processar.js do app.
// Uso: python3 testes/telefonia/gerar_exemplo.py && node divulgacao/demo/telefonia_demo.js
const fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..", "..");
const P = require(path.join(RAIZ, "site/apps/telefonia/processar.js"));
const dir = path.join(RAIZ, "testes/telefonia/exemplo");
const arqs = fs.readdirSync(dir).filter(f => f.endsWith(".csv")).sort().map(f => ({ nome: f, texto: fs.readFileSync(path.join(dir, f), "utf8") }));
const c = P.processar(arqs, 6);
const DONOS = { "5521990000101": "Ana", "5521990000102": "Bruno", "5521990000103": "Carla", "5521990000104": "Diego", "5521990000105": "Elisa", "5521990000106": "Fábio" };
const rel = {
  id: "demo", titulo: "Exemplo Engenharia", empresa: "EXEMPLO ENGENHARIA LTDA (empresa fictícia)", cliente_num: "100000001", conta: c.conta,
  operadora: "Claro Empresas", perfil: c.perfil,
  linhas: c.linhas.map(l => ({ n: l.n, dono: DONOS[l.n], ...(l.n.endsWith("105") ? { sub: "linha reserva" } : {}), plano: l.plano, fr: l.fr, iccid: l.iccid, add: l.add })),
  dados: c.dados, fontes: `exportações fictícias no formato do portal Claro Empresas (${c.exportacoes.join(" e ")}).`,
  notas: ["Demonstração: empresa, pessoas, números e consumo são fictícios."], atualizado_em: "2026-10-15T12:00:00-03:00",
};
fs.writeFileSync(path.join(RAIZ, "site/demo/telefonia/exemplo.js"),
  "// GERADO por divulgacao/demo/telefonia_demo.js — não editar. Dados fictícios.\nwindow.EXEMPLO_TELEFONIA = " + JSON.stringify(rel) + ";\n");
console.log("ok", c.dados.inicio, c.dados.fim, c.linhas.length, "linhas");
