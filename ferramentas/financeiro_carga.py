"""Carga da planilha "Plataforma Nervia - Investimento.xlsx" no app Financeiro Nervia (tabelas fin_).

Uso: python3 -I ferramentas/financeiro_carga.py planilha.xlsx saida.sql [--extra extra.json]

- Aba "Custos mensais" → fin_custos (uma linha por serviço, até a linha do total):
  moeda e valor da planilha; em dólar, câmbio e IOF da aba "Premissas" (valor em R$ = valor × câmbio × (1 + IOF),
  igual à fórmula da planilha); valor "=N/12" vira custo ANUAL de N; "Uso" = grupo, e "Empresa" fica fora do custo da
  plataforma (como o total "sem custos da empresa" da planilha).
- Aba "Histórico" → histórico do custo correspondente (pela primeira palavra do serviço).
- Abas "Premissas", "Investimento inicial", "Preço por CNPJ", "Limites" e "Histórico" → fin_planilha, como vieram
  (valores calculados), para a fase 3 (investimento e cenários).
- --extra: lista JSON de custos a acrescentar na mesma carga (mesmas chaves do _fin_carga).

O SQL roda numa transação, chama public._fin_carga (recusa se já houver custos) e confere que o custo mensal da
plataforma bate com o total da planilha (diferença de mais de R$ 0,05 = desfaz tudo). Os dados reais NÃO vão para o
GitHub: rodar com a planilha fora do repositório e aplicar o SQL pelo editor do Supabase.
"""
import datetime as dt
import json
import re
import sys

import openpyxl

INICIO = "2026-10-13"   # início da plataforma (aba Histórico)


def texto(v):
    return "" if v is None else str(v).strip()


def linhas(ws_f, ws_v):
    out = []
    for rf in ws_f.iter_rows():
        lin = []
        for c in rf:
            v = ws_v[c.coordinate].value
            if isinstance(v, (dt.date, dt.datetime)):
                v = v.isoformat()[:10]
            lin.append(v)
        while lin and lin[-1] is None:
            lin.pop()
        if lin:
            out.append(lin)
    return out


def data_br(s):
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", texto(s))
    return f"{m[3]}-{m[2]}-{m[1]}" if m else None


def main():
    args = sys.argv[1:]
    extra = []
    if "--extra" in args:
        i = args.index("--extra")
        extra = json.load(open(args[i + 1], encoding="utf-8"))
        del args[i:i + 2]
    arq, saida = args
    wf = openpyxl.load_workbook(arq, data_only=False)
    wv = openpyxl.load_workbook(arq, data_only=True)

    pre = {texto(wv["Premissas"].cell(r, 1).value): wv["Premissas"].cell(r, 2).value for r in range(1, 60)}
    cambio = next(v for k, v in pre.items() if k.lower().startswith("cotação do dólar"))
    iof = next(v for k, v in pre.items() if k.lower().startswith("iof"))

    cf, cv = wf["Custos mensais"], wv["Custos mensais"]
    cab, fim = None, False
    custos, total_plataforma = [], None
    for r in range(1, cf.max_row + 1):
        a = texto(cv.cell(r, 1).value)
        if a == "Serviço":
            cab = r
            continue
        if cab is None or not a:
            continue
        if a.lower().startswith("total mensal da plataforma"):
            total_plataforma = float(cv.cell(r, 5).value)
            continue
        if a.lower().startswith("total"):
            fim = True
            continue
        if fim:   # depois dos totais só há notas de rodapé
            continue
        para, moeda = texto(cv.cell(r, 2).value), texto(cv.cell(r, 3).value).upper() or "BRL"
        bruto, valor = cf.cell(r, 4).value, cv.cell(r, 4).value
        uso, fonte = texto(cv.cell(r, 6).value) or "Plataforma", texto(cv.cell(r, 7).value)
        per = "mensal"
        m = re.match(r"^=\s*([\d.]+)\s*/\s*12\s*$", bruto) if isinstance(bruto, str) else None
        if m:
            per, valor = "anual", float(m[1])
        fornecedor = re.split(r" — | \(", a)[0].strip()
        cat = "Ferramentas e software" if "claude" in a.lower() or "github" in a.lower() else "Infraestrutura / plataforma"
        custos.append({
            "nome": a, "fornecedor": fornecedor, "grupo": uso, "plataforma": uso.lower() != "empresa", "categoria": cat,
            "moeda": moeda, "valor": round(float(valor or 0), 4), "cambio": cambio if moeda == "USD" else None,
            "iof": round(float(iof) * 100, 2) if moeda == "USD" else 0, "periodicidade": per, "desde": INICIO, "ate": None,
            "obs": " · ".join(x for x in [para, fonte] if x), "historico": []})

    # histórico → custo pela primeira palavra significativa
    hf, hv = wf["Histórico"], wv["Histórico"]
    for r in range(1, hf.max_row + 1):
        d = data_br(hv.cell(r, 1).value)
        if not d:
            continue
        oque, obs = texto(hv.cell(r, 2).value), texto(hv.cell(r, 4).value)
        alvo = None
        for chave in ["Supabase Pro", "Cloud Run", "Cloudflare"]:
            if chave.lower() in oque.lower():
                alvo = next((c for c in custos if chave.split()[0].lower() in c["nome"].lower()), None)
                break
        if alvo is None:
            alvo = custos[0]
        alvo["historico"].append({"em": d + "T12:00:00-03:00", "motivo": oque + (" — " + obs if obs else ""), "antes": None, "depois": None})

    abas = [{"aba": n, "dados": linhas(wf[n], wv[n])} for n in ["Premissas", "Investimento inicial", "Preço por CNPJ", "Limites", "Histórico"] if n in wf.sheetnames]
    pacote = {"arquivo": arq.replace("\\", "/").split("/")[-1], "custos": custos + extra, "abas": abas}
    js = json.dumps(pacote, ensure_ascii=False, default=str)
    if "$carga$" in js:
        raise SystemExit("texto da planilha contém o marcador $carga$")
    sql = f"""-- Carga da planilha de investimento no Financeiro Nervia (gerado por ferramentas/financeiro_carga.py). Dados reais: NÃO versionar.
begin;
select public._fin_carga($carga${js}$carga$::jsonb);
do $$
declare v numeric := (select sum(mensal_brl) from public.fin_custos where plataforma and (ate is null or ate >= current_date)
                       and nome = any(array[{", ".join("'" + c["nome"].replace("'", "''") + "'" for c in custos)}]));
begin
  if abs(v - {total_plataforma:.2f}) > 0.05 then
    raise exception 'Conferência da carga: custo mensal da plataforma % diferente da planilha {total_plataforma:.2f}', v;
  end if;
  raise notice 'carga conferida: custo mensal da plataforma R$ % (planilha {total_plataforma:.2f})', v;
end $$;
commit;
"""
    open(saida, "w", encoding="utf-8").write(sql)
    print(f"{len(custos)} custos da planilha + {len(extra)} extra, {sum(len(c['historico']) for c in custos)} itens de histórico, "
          f"{len(abas)} abas guardadas; custo mensal da plataforma na planilha R$ {total_plataforma:.2f}")
    for c in custos + extra:
        print(f"  - {c['nome']}: {c['moeda']} {c['valor']} {c['periodicidade']} · grupo {c['grupo']}"
              f"{'' if c.get('plataforma', True) else ' (fora da plataforma)'}")


if __name__ == "__main__":
    main()
