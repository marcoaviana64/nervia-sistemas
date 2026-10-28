#!/usr/bin/env python3
"""Relatório diário do Sistema Linum em PDF (pedido do Marco em 27/10/2026).

Uso: python3 relatorios/linum_diario.py dados.json saida.pdf
dados.json = o jsonb `r` devolvido por relatorios/linum_diario.sql (pode ser {"r": {...}} ou só o {...}).
Gera uma página A4 em pé, legível no celular e fácil de encaminhar.
"""
import base64, html, json, os, sys
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def num(v, casas=0):
    s = f"{float(v):,.{casas}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def brl(v):
    return "R$ " + num(v, 2)


def pct(a, b):
    if a in (None, 0) or b is None:
        return ""
    p = (float(b) - float(a)) / float(a) * 100
    return ("+" if p > 0 else "") + num(p, 1).replace(",0", "") + "%" if abs(p) >= 0.05 else "0%"


def linha(rot, ant, ago, fmt=num):
    if ago is None:
        return ""
    if ant is None:
        dif, cl, p = "", "", "<span class='mut'>novo</span>"
    else:
        d = float(ago) - float(ant)
        cl = "up" if d > 0 else ("down" if d < 0 else "")
        dif = ("+" if d > 0 else "−" if d < 0 else "") + (fmt(abs(d)) if d else "0")
        p = pct(ant, ago)
    return (f"<tr><td>{rot}</td><td class='n mut'>{'' if ant is None else fmt(ant)}</td><td class='n b'>{fmt(ago)}</td>"
            f"<td class='n {cl}'>{dif}</td><td class='n {cl}'>{p}</td></tr>")


def montar(r):
    a, ant = r["agora"], r.get("anterior") or {}
    lojas = sorted(set(a.get("pecas_por_loja", {})) | set(ant.get("pecas_por_loja", {})))
    sem = a["produtos"] - a["produtos_com_variacao"]
    prog = a["produtos_com_variacao"] / a["produtos"] * 100 if a["produtos"] else 0
    linhas = [
        linha("Produtos cadastrados", ant.get("produtos"), a["produtos"]),
        linha("Produtos com cores e tamanhos", ant.get("produtos_com_variacao"), a["produtos_com_variacao"]),
        linha("Produtos com peça em estoque", ant.get("produtos_com_estoque"), a["produtos_com_estoque"]),
        linha("Variações (cor × tamanho)", ant.get("variacoes"), a["variacoes"]),
        linha("Peças especiais ★", ant.get("especiais"), a["especiais"]),
        *[linha(f"Peças em {html.escape(l)}", (ant.get("pecas_por_loja") or {}).get(l), a["pecas_por_loja"].get(l, 0)) for l in lojas],
        linha("Total de peças", ant.get("pecas_total"), a["pecas_total"]),
        linha("Valor do estoque (preço de venda)", ant.get("valor_venda"), a["valor_venda"], brl),
    ]
    pess = r.get("pessoas") or []
    if pess:
        corpo = "".join(
            f"<tr><td class='b'>{html.escape(p['quem'])}</td><td style='white-space:nowrap'>{p['inicio']}–{p['fim']}</td>"
            f"<td class='n'>{p['prod_criados']}</td><td class='n'>{p['prod_alterados']}</td><td class='n'>{p['prod_excluidos']}</td>"
            f"<td class='n'>{num(p['variacoes_criadas'])}</td>"
            f"<td class='n b'>{num(p['pecas_entrada'])}"
            + (f"<div class='mut s'>{' · '.join(f'{html.escape(k)} {num(v)}' for k, v in sorted(p['entrada_por_loja'].items()))}</div>" if p['entrada_por_loja'] else "")
            + f"</td><td class='n'>{num(p['pecas_saida'])}</td><td class='n'>{p['ajustes'] + p['transferencias']}</td></tr>"
            for p in pess)
        quem = (f"<table class='t'><thead><tr><th>Quem</th><th>Horário</th><th>Produtos<br>criados</th><th>Produtos<br>alterados</th>"
                f"<th>Produtos<br>excluídos</th><th>Variações<br>criadas</th><th>Peças<br>lançadas</th><th>Peças<br>retiradas</th>"
                f"<th>Ajustes<br>transf.</th></tr></thead><tbody>{corpo}</tbody></table>")
    else:
        quem = "<p class='vazio'>Nenhuma atualização de produtos ou estoque neste dia.</p>"
    aten = []
    if r.get("provisorias"):
        aten.append(f"<li><b>Referências provisórias para trocar ({len(r['provisorias'])}):</b> {html.escape(', '.join(r['provisorias']))}</li>")
    if r.get("excluidos"):
        aten.append(f"<li><b>Produtos excluídos no dia ({len(r['excluidos'])}):</b> {html.escape(', '.join(r['excluidos']))}</li>")
    if not aten:
        aten.append("<li>Nada a observar.</li>")
    qrs = r.get("qr") or []
    if qrs:
        nomes = {"ipanema": "Ipanema", "gavea": "Gávea", "sacola": "Sacola", "cartao": "Cartão de visita", "etiqueta": "Etiqueta", "trakto": "QR antigo (Trakto)"}
        corpo = "".join(f"<tr><td>{html.escape(nomes.get(q['origem'], q['origem']))}</td><td class='n b'>{num(q['hoje'])}</td>"
                        f"<td class='n'>{num(q['pessoas_hoje'])}</td><td class='n'>{num(q['cliques_hoje'])}</td><td class='n b'>{num((r.get('qr_cadastros') or {}).get(q['origem'], 0))}</td><td class='n mut'>{num(q['total'])}</td></tr>" for q in qrs)
        cl = r.get("qr_cliques") or {}
        extra = f"<p class='mut s'>Toques nos botões hoje: {html.escape(' · '.join(f'{k} {v}' for k, v in sorted(cl.items(), key=lambda x: -x[1])))}</p>" if cl else ""
        qr = (f"<h2>Leituras dos QR codes</h2><table class='t'><thead><tr><th>De onde</th><th class='n'>Leituras hoje</th><th class='n'>Pessoas</th>"
              f"<th class='n'>Toques nos botões</th><th class='n'>Cadastros</th><th class='n'>Desde o início</th></tr></thead><tbody>{corpo}</tbody></table>{extra}")
    else:
        qr = ""
    logo = base64.b64encode(open(os.path.join(RAIZ, "site/img/nervia-logo.png"), "rb").read()).decode()
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 14mm 13mm 14mm 13mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #1f2328; font-size: 12.5px; margin: 0; }}
header {{ display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #107D9A; padding-bottom: 8px; }}
header img {{ height: 34px; }}
h1 {{ font-size: 21px; margin: 0; }} .sub {{ color: #5f6670; font-size: 12px; margin-top: 2px; }}
h2 {{ font-size: 14.5px; color: #107D9A; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; }}
.kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }}
.kpi {{ border: 1px solid #e2dfd6; border-radius: 8px; padding: 8px 10px; background: #faf9f6; }}
.kpi .v {{ font-size: 20px; font-weight: 700; }} .kpi .r {{ font-size: 11px; color: #5f6670; }} .kpi .d {{ font-size: 11.5px; font-weight: 600; }}
.prog {{ height: 9px; background: #ece9e1; border-radius: 9px; overflow: hidden; margin: 6px 0 2px; }}
.prog i {{ display: block; height: 100%; background: #107D9A; }}
table.t {{ width: 100%; border-collapse: collapse; }}
.t th {{ text-align: left; font-size: 10.5px; color: #5f6670; text-transform: uppercase; letter-spacing: .03em; border-bottom: 1.5px solid #cfcabd; padding: 5px 6px; }}
.t td {{ padding: 6px; border-bottom: 1px solid #ece9e1; vertical-align: top; }}
.t th.n, .t td.n {{ text-align: right; white-space: nowrap; }}
.b {{ font-weight: 700; }} .mut {{ color: #8a8f96; }} .s {{ font-size: 10.5px; font-weight: 400; }}
.up {{ color: #2e6b3a; font-weight: 600; }} .down {{ color: #a33a2a; font-weight: 600; }}
.vazio {{ color: #5f6670; font-style: italic; }}
ul {{ margin: 4px 0; padding-left: 18px; }} li {{ margin: 3px 0; }}
footer {{ margin-top: 18px; font-size: 10px; color: #8a8f96; border-top: 1px solid #e2dfd6; padding-top: 6px; }}
</style></head><body>
<header><div><h1>Linum · Relatório do dia {r['dia']}</h1>
<div class="sub">{r['dia_semana'].capitalize()} · cadastro de produtos e estoque · gerado em {r['gerado_em']}</div></div>
<img src="data:image/png;base64,{logo}" alt="Nervia"></header>
<div class="kpis">
 <div class="kpi"><div class="r">Total de peças</div><div class="v">{num(a['pecas_total'])}</div><div class="d up">{pct(ant.get('pecas_total'), a['pecas_total'])}</div></div>
 <div class="kpi"><div class="r">Valor do estoque</div><div class="v" style="font-size:17px">{brl(a['valor_venda'])}</div><div class="d up">{pct(ant.get('valor_venda'), a['valor_venda'])}</div></div>
 <div class="kpi"><div class="r">Variações</div><div class="v">{num(a['variacoes'])}</div><div class="d up">{pct(ant.get('variacoes'), a['variacoes'])}</div></div>
 <div class="kpi"><div class="r">Produtos prontos</div><div class="v">{a['produtos_com_variacao']} <span class="s mut">de {a['produtos']}</span></div>
   <div class="prog"><i style="width:{prog:.1f}%"></i></div><div class="r">{num(prog, 0)}% com cores e tamanhos</div></div>
</div>
<h2>Evolução</h2>
<table class="t"><thead><tr><th></th><th class="n">Antes<div class="s">{r.get('anterior_em') or '—'}</div></th><th class="n">Agora</th><th class="n">Diferença</th><th class="n">Cresceu</th></tr></thead>
<tbody>{''.join(linhas)}</tbody></table>
<p class="mut s" style="margin-top:6px">Ainda falta: {sem} de {a['produtos']} produtos estão só com o nome, sem cores, tamanhos ou quantidades.</p>
<h2>Quem fez o quê</h2>{quem}
{qr}<h2>Pontos de atenção</h2><ul>{''.join(aten)}</ul>
<footer>Sistema Linum · Plataforma Nervia · nervia.com.br · “Antes” = último relatório; “Quem fez o quê” = ações de cadastro e estoque registradas na auditoria no dia {r['dia']}.</footer>
</body></html>"""


def main():
    dados = json.load(open(sys.argv[1], encoding="utf-8"))
    if isinstance(dados, list):
        dados = dados[0]
    r = dados.get("r", dados)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.set_content(montar(r), wait_until="load")
        pg.pdf(path=sys.argv[2], format="A4", print_background=True, prefer_css_page_size=True)
        b.close()
    print(sys.argv[2])


if __name__ == "__main__":
    main()
