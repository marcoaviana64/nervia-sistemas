"""Exporta o que a versão local gravou (notas.db) para conferir a leitura da versão web.
Uso: python3 testes/exportar_esperado.py versao-local/dados/notas.db > esperado.json"""
import json, sqlite3, sys

c = sqlite3.connect(sys.argv[1])
c.row_factory = sqlite3.Row
out = {}
for r in c.execute("select * from notas"):
    out[f"{r['cnpj_consulta']}|{r['tipo']}|{r['chave']}"] = {
        "numero": r["numero"] or "", "emit_cnpj": r["emit_cnpj"], "emit_nome": r["emit_nome"],
        "dest_cnpj": r["dest_cnpj"] or "", "dest_nome": r["dest_nome"] or "", "valor": r["valor"],
        "completo": bool(r["completo"]), "data_emissao": r["data_emissao"], "situacao": r["situacao"],
    }
json.dump(out, sys.stdout, ensure_ascii=False)
