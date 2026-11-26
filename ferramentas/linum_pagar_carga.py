#!/usr/bin/env python3
"""Carga das contas a pagar do painel gerencial antigo da Linum no Gerencial → Contas a pagar (Sistema Linum 2.70).

O painel antigo (dashboard_gerencial.html) tinha a lista CONTAS_PAGAR, vinda do ERP Olist (só a carga inicial), e decidia
se cada conta estava paga procurando no extrato (RAW) um pagamento com o nome do fornecedor (FORN_KEYWORDS), de 20 dias antes
a 60 dias depois do vencimento, casando pela menor diferença de data (cada lançamento paga uma conta só), ou pela marcação
manual "pagoManual". Este script refaz a mesma conta e gera o SQL da carga: lin_ger_pagar_importar com origem 'carga', as pagas
já com a data e o valor do lançamento e, quando houver, o lançamento do extrato do Gerencial (mesma data, valor e descrição).

Uso:   python3 -I ferramentas/linum_pagar_carga.py dashboard_gerencial.html saida.sql [--hoje AAAA-MM-DD]
Rodar a saída pelo SQL do Supabase (dados reais: o .sql NÃO vai para o GitHub). Recusa se já houver contas de origem 'carga'.
"""
import json, re, sys, datetime

def raw_decode_after(s, marca):
    i = s.find(marca)
    if i < 0:
        sys.exit(f"não achei {marca} no arquivo")
    obj, _ = json.JSONDecoder().raw_decode(s[i + len(marca):].lstrip())
    return obj

def br(d):
    dd, mm, aa = d.split("/")
    return datetime.date(int(aa), int(mm), int(dd))

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    hoje = datetime.date.today()
    if "--hoje" in sys.argv:
        hoje = datetime.date.fromisoformat(sys.argv[sys.argv.index("--hoje") + 1])
        args = [a for a in args if a != str(hoje)]
    s = open(args[0], encoding="utf-8").read()
    contas = raw_decode_after(s, "const CONTAS_PAGAR=")
    raw = raw_decode_after(s, "const RAW=")
    m = re.search(r"FORN_KEYWORDS\s*=\s*(\{.*?\});", s, re.S)
    kws = json.loads(re.sub(r"'", '"', re.sub(r",\s*}", "}", m.group(1))))

    # casamento do painel antigo (matchContasPagas): pares (conta, lançamento), cada lançamento paga uma conta só
    cand = [(i, r) for i, r in enumerate(raw) if r.get("d", 0) > 0]
    pares = []
    for ci, cp in enumerate(contas):
        k = kws.get(cp["forn"])
        if not k:
            continue
        v = br(cp["venc"])
        for ri, r in cand:
            if not any(x in r["full"].upper() for x in k):
                continue
            dif = (br(r["dt"]) - v).days
            if dif < -20 or dif > 60:
                continue
            # diferente do painel antigo (que olhava só a data e trocava parcelas de NFs diferentes do mesmo fornecedor):
            # primeiro o pagamento de valor parecido (até 3%), depois a data mais próxima
            perto = abs(r["d"] - cp["valor"]) <= cp["valor"] * 0.03
            pares.append((0 if perto else 1, abs(dif), ci, ri))
    pares.sort()
    usc, usr, pago = set(), set(), {}
    for _, _, ci, ri in pares:
        if ci in usc or ri in usr:
            continue
        usc.add(ci); usr.add(ri); pago[ci] = raw[ri]

    # CNPJ do fornecedor: o que aparece na descrição dos pagamentos achados (o Itaú escreve "… 02.384.871/0001-81")
    docs = {}
    for ci, r in pago.items():
        m = re.search(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", r["full"])
        if m:
            docs.setdefault(contas[ci]["forn"], {}).setdefault(re.sub(r"\D", "", m.group(0)), 0)
            docs[contas[ci]["forn"]][re.sub(r"\D", "", m.group(0))] += 1
    doc_forn = {f: max(d, key=d.get) for f, d in docs.items()}
    linhas, n_pagas, total, total_aberto = [], 0, 0.0, 0.0
    for ci, cp in enumerate(contas):
        nf = re.search(r"NF n[ºo°]\s*(\d+)", cp["hist"])
        parc = re.search(r"parcela\s*(\d+\s*/\s*\d+)", cp["hist"])
        c = {"chave": f"painel|{ci + 1}|{cp['venc']}|{cp['valor']:.2f}", "fornecedor": cp["forn"], "fornecedor_doc": doc_forn.get(cp["forn"], ""), "documento": nf.group(1) if nf else "",   # o "doc" do Olist (ex.: 34191 no aluguel) é o banco do boleto, não a NF
             "parcela": parc.group(1).replace(" ", "") if parc else "", "vencimento": br(cp["venc"]).isoformat(), "valor": round(cp["valor"], 2),
             "historico": cp["hist"], "categoria": "Aluguel" if "Aluguel" in cp["hist"] else ("Insumos" if nf else "")}
        r = pago.get(ci)
        if cp.get("pagoManual"):
            c.update(situacao="paga", pago_em=br(cp["pagoManual"]).isoformat(), valor_pago=c["valor"], pago_obs="marcada como paga no painel antigo")
        elif r:
            c.update(situacao="paga", pago_em=br(r["dt"]).isoformat(), valor_pago=round(r["d"], 2), pago_obs="pagamento achado no extrato pelo painel antigo",
                     _lanc={"data": br(r["dt"]).isoformat(), "debito": round(r["d"], 2), "descricao": r["full"]})
        total += c["valor"]
        if c.get("situacao") == "paga":
            n_pagas += 1
        else:
            total_aberto += c["valor"]
        linhas.append(c)

    lancs = [(i, c.pop("_lanc")) for i, c in enumerate(linhas) if "_lanc" in c]
    pacote = json.dumps({"origem": "carga", "arquivo": "dashboard_gerencial.html (painel antigo, contas do Olist)", "contas": linhas}, ensure_ascii=False)
    sql = [
        "-- Carga das contas a pagar do painel antigo da Linum (gerado por ferramentas/linum_pagar_carga.py). DADOS REAIS: fora do GitHub.",
        f"-- {len(linhas)} contas, {n_pagas} pagas, total R$ {total:,.2f}, em aberto R$ {total_aberto:,.2f}",
        "begin;",
        "do $$ begin if exists (select 1 from public.lin_ger_pagar where origem = 'carga') then raise exception 'A carga do painel antigo já foi feita'; end if; end $$;",
        # a função confere lin_eh_dono(): a carga roda como a equipe Nervia (admin) — mesmo jeito das outras cargas do Gerencial
        "select set_config('request.jwt.claim.sub', (select user_id::text from public.perfis where admin order by criado_em limit 1), true);",
        f"select public.lin_ger_pagar_importar($carga${pacote}$carga$::jsonb);",
    ]
    for i, l in lancs:
        sql.append("update public.lin_ger_pagar set lancamento_id = (select id from public.lin_ger_lancamentos where data = '%s' and debito = %.2f and descricao = $d$%s$d$ order by id limit 1) where chave = $c$%s$c$;"
                   % (l["data"], l["debito"], l["descricao"], linhas[i]["chave"]))
    sql.append(f"""do $$ declare n int; v numeric; begin
  select count(*), sum(valor) into n, v from public.lin_ger_pagar where origem = 'carga';
  if n <> {len(linhas)} or round(v, 2) <> {round(total, 2)} then raise exception 'Conferência falhou: % contas, R$ %', n, v; end if;
  if (select count(*) from public.lin_ger_pagar where origem = 'carga' and situacao = 'paga') <> {n_pagas} then raise exception 'Conferência das pagas falhou'; end if;
end $$;""")
    sql.append("commit;")
    open(args[1], "w", encoding="utf-8").write("\n".join(sql) + "\n")
    lig = sum(1 for _ in lancs)
    print("CNPJ pelo extrato:", {f: d for f, d in doc_forn.items()})
    print(f"{len(linhas)} contas ({n_pagas} pagas: {sum(1 for c in contas if c.get('pagoManual'))} à mão + {lig} pelo extrato), "
          f"total R$ {total:,.2f}, em aberto R$ {total_aberto:,.2f}; vencidas em aberto até {hoje}: "
          f"{sum(1 for c in linhas if c.get('situacao') != 'paga' and c['vencimento'] < hoje.isoformat())}")

if __name__ == "__main__":
    main()
