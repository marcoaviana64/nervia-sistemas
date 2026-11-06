#!/usr/bin/env python3
"""Carga do Gerencial da Linum (Sistema Linum 2.36) a partir do painel antigo (dashboard_gerencial.html).

Lê do HTML:
  * RAW (lançamentos do Itaú e do Nubank, já classificados)  -> lin_ger_lancamentos
  * os cartões da aba Considerações e a Avaliação Executiva    -> lin_ger_consideracoes
e gera um SQL numa transação só, para rodar no SQL do Supabase DEPOIS da migração 20261106000100_linum_gerencial.
O SQL confere as somas (créditos, débitos, nº de lançamentos por conta) contra o painel: diferença = desfaz tudo.
Recusa se já houver lançamentos (a carga é uma vez só). Grava a auditoria linum_gerencial_carga.

Os dados são REAIS (extratos da Linum): o SQL gerado NÃO vai para o GitHub.

Uso:  python3 -I ferramentas/linum_gerencial_carga.py dashboard_gerencial.html saida.sql [--saldo-itau 11220.02:2026-11-05]
      [--regras regras.json]   (lista [{padrao, classe, classificacao, conta?, tipo?, prioridade?, observacao?}])
"""
import json, re, sys, unicodedata, html as H
from collections import Counter


def sem_ac(t):
    """Igual ao semAc da tela: sem acento, minúsculas, espaços juntos."""
    t = unicodedata.normalize('NFD', str(t or ''))
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'\s+', ' ', t).strip()


def array_js(s, nome):
    i = s.find(nome + '=[')
    if i < 0:
        raise SystemExit(f'{nome} não encontrado no HTML')
    i += len(nome) + 1
    dec = json.JSONDecoder()
    v, _ = dec.raw_decode(s, i)
    return v


def bloco(s, i):
    """Devolve o fim do <div ...> que começa em i (contando divs aninhados)."""
    prof = 0
    for m in re.finditer(r'<div\b|</div>', s[i:]):
        prof += 1 if m.group(0) == '<div' else -1
        if prof == 0:
            return i + m.end()
    raise SystemExit('div sem fechamento')


def interno(b):
    return b[b.index('>') + 1: b.rindex('</div>')]


COR = {'#0f8a72': 'pos', '#0c7a63': 'pos', '#c4304a': 'neg', '#a82440': 'neg', '#b5750f': 'ins', '#8f8aa3': 'neu'}
MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']


def texto(x):
    return re.sub(r'\s+', ' ', H.unescape(re.sub(r'<[^>]+>', '', x))).strip()


def consideracoes(s):
    ini = s.index('id="page-consideracoes"')
    fim = bloco(s, s.rindex('<div', 0, ini))
    pag = s[ini:fim]
    base = ini
    out = []
    for m in re.finditer(r'<div class="cons-card">', pag):
        b = s[base + m.start(): bloco(s, base + m.start())]
        tit = texto(re.search(r'<div class="cons-mes">(.*?)</div>', b, re.S).group(1)).replace('📅', '').strip()
        mm = re.match(r'(\w+)\s*/\s*(\d{4})', sem_ac(tit))
        mes = f'{mm.group(2)}-{MESES.index(mm.group(1)) + 1:02d}'
        nb = re.search(r'<span class="nota-badge nota-([A-D])">(.*?)</span>', b, re.S)
        nota, ntxt = (nb.group(1), texto(nb.group(2)).split('—', 1)[-1].strip()) if nb else ('', '')
        mets = []
        for mt in re.finditer(r'<div class="cons-met"><div class="cons-met-val"(?: style="color:([^"]+)")?>(.*?)</div><div class="cons-met-lbl">(.*?)</div></div>', b, re.S):
            mets.append({'rot': texto(mt.group(3)), 'val': texto(mt.group(2)), 'cor': COR.get((mt.group(1) or '').lower(), '')})
        im = b.find('<div class="cons-metricas">')
        corpo = b[bloco(b, im):] if im >= 0 else b[bloco(b, b.index('<div class="cons-header">')):]
        corpo = corpo[: corpo.rindex('</div>')].strip()
        out.append({'mes': mes, 'titulo': tit, 'nota': nota, 'nota_texto': ntxt, 'metricas': mets, 'corpo': corpo})
    m = re.search(r'<div class="cons-final">', pag)
    if m:
        b = s[base + m.start(): bloco(s, base + m.start())]
        h2 = re.search(r'<h2>(.*?)</h2>', b, re.S)
        corpo = interno(b)
        if h2:
            corpo = corpo.replace(h2.group(0), '', 1)
        out.append({'mes': 'final', 'titulo': texto(h2.group(1)) if h2 else 'Avaliação executiva', 'nota': '', 'nota_texto': '', 'metricas': [], 'corpo': corpo.strip()})
    return out


def q(t):
    return "'" + str(t).replace("'", "''") + "'"


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        raise SystemExit(__doc__)
    s = open(a[0], encoding='utf-8').read()
    saldo_itau = None
    regras = []
    if '--saldo-itau' in a:
        v, d = a[a.index('--saldo-itau') + 1].split(':')
        saldo_itau = (float(v), d)
    if '--regras' in a:
        regras = json.load(open(a[a.index('--regras') + 1], encoding='utf-8'))
    raw = array_js(s, 'RAW')
    lin, cont = [], Counter()
    for r in raw:
        conta = {'Itau': 'itau', 'Nubank': 'nubank'}.get(r['ac'], 'socia')   # 'Sócia (extra-caixa)' = fora do banco
        d, m_, y = r['dt'].split('/')
        data = f'{y}-{m_}-{d}'
        c, de = round(float(r.get('c') or 0), 2), round(float(r.get('d') or 0), 2)
        desc = re.sub(r'\s+', ' ', r.get('full') or '').strip()
        base = '|'.join([conta, data, f'{c - de:.2f}', sem_ac(desc)])
        cont[base] += 1
        lin.append((conta, data, desc, c, de, r.get('cat') or 'Outros', r.get('label') or '', base + '|' + str(cont[base]),
                    'fora do banco (painel antigo: ' + r['ac'] + ')' if conta == 'socia' else ''))
    cons = consideracoes(s)
    tot = {k: (sum(1 for x in lin if x[0] == k), round(sum(x[3] for x in lin if x[0] == k), 2), round(sum(x[4] for x in lin if x[0] == k), 2)) for k in ('itau', 'nubank', 'socia')}

    L = ['begin;',
         "do $$ begin if exists (select 1 from public.lin_ger_lancamentos) then raise exception 'Já há lançamentos no Gerencial: a carga é uma vez só.'; end if; end $$;"]
    for k in ('itau', 'nubank'):
        ls = [x for x in lin if x[0] == k]
        if not ls:
            continue
        sf, sd = (saldo_itau if k == 'itau' and saldo_itau else (None, None))
        L.append(f"insert into public.lin_ger_importacoes (conta, arquivo, de, ate, novos, saldo_final, saldo_data, observacao, criado_nome) values "
                 f"({q(k)}, 'dashboard_gerencial.html (painel antigo)', {q(min(x[1] for x in ls))}, {q(max(x[1] for x in ls))}, {len(ls)}, "
                 f"{'null' if sf is None else sf}, {'null' if sd is None else q(sd)}, 'carga do histórico do painel antigo', 'Carga (Nervia)');")
        for i in range(0, len(ls), 400):
            parte = ls[i:i + 400]
            L.append('insert into public.lin_ger_lancamentos (conta, data, descricao, credito, debito, classe, classificacao, chave, importacao_id, criado_nome) values\n' + ',\n'.join(
                f"({q(x[0])}, {q(x[1])}, {q(x[2])}, {x[3]:.2f}, {x[4]:.2f}, {q(x[5])}, {q(x[6])}, {q(x[7])}, (select max(id) from public.lin_ger_importacoes where conta = {q(k)}), 'Carga (Nervia)')"
                for x in parte) + ';')
    for x in (x for x in lin if x[0] == 'socia'):
        L.append('insert into public.lin_ger_lancamentos (conta, data, descricao, credito, debito, classe, classificacao, chave, observacao, criado_nome) values '
                 f"({q(x[0])}, {q(x[1])}, {q(x[2])}, {x[3]:.2f}, {x[4]:.2f}, {q(x[5])}, {q(x[6])}, {q(x[7])}, {q(x[8])}, 'Carga (Nervia)');")
    for r in regras:
        L.append('insert into public.lin_ger_regras (padrao, classe, classificacao, conta, tipo, prioridade, observacao, criado_nome, alterado_nome) values '
                 f"({q(r['padrao'])}, {q(r['classe'])}, {q(r.get('classificacao', ''))}, {q(r.get('conta', ''))}, {q(r.get('tipo', ''))}, {int(r.get('prioridade', 100))}, "
                 f"{q(r.get('observacao', ''))}, 'Carga (Nervia)', 'Carga (Nervia)');")
    for c in cons:
        L.append(f"insert into public.lin_ger_consideracoes (mes, titulo, nota, nota_texto, metricas, corpo, atualizado_nome) values "
                 f"({q(c['mes'])}, {q(c['titulo'])}, {q(c['nota'])}, {q(c['nota_texto'])}, {q(json.dumps(c['metricas'], ensure_ascii=False))}::jsonb, {q(c['corpo'])}, 'Nervia (painel antigo)');")
    conf = ' or '.join(
        f"(select count(*) <> {n_} or coalesce(sum(credito),0) <> {cr:.2f} or coalesce(sum(debito),0) <> {db:.2f} from public.lin_ger_lancamentos where conta = {q(k)})"
        for k, (n_, cr, db) in tot.items())
    L.append(f"do $$ begin if {conf} then raise exception 'Conferência: somas diferentes do painel antigo. Nada foi gravado.'; end if;\n"
             f"  if (select count(*) from public.lin_ger_consideracoes) <> {len(cons)} then raise exception 'Conferência: considerações diferentes. Nada foi gravado.'; end if; end $$;")
    L.append("select public.auditar('linum_gerencial_carga', null, " + q(json.dumps({
        'origem': 'dashboard_gerencial.html (painel antigo)', 'lancamentos': {k: {'qtd': v[0], 'creditos': v[1], 'debitos': v[2]} for k, v in tot.items()},
        'consideracoes': [c['mes'] for c in cons], 'regras': len(regras), 'papel_linum': 'sistema'}, ensure_ascii=False)) + '::jsonb);')
    L.append('commit;')
    open(a[1], 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print(json.dumps({'lancamentos': tot, 'consideracoes': [(c['mes'], c['nota'], len(c['metricas']), len(c['corpo'])) for c in cons], 'regras': len(regras)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
