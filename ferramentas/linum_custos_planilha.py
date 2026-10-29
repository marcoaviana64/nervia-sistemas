#!/usr/bin/env python3
"""Lê a planilha de custos da Linum ("CUSTO 2025 Original", Google Drive da Gorette) e gera um JSON por aba,
para comparar com public.lin_custos (aba Custos do Sistema Linum). Os dados reais NÃO vão para o GitHub.

Uso: python3 -I ferramentas/linum_custos_planilha.py planilha.xlsx saida.json
Cada linha: aba, descricao, referencia, materia, qtd, mp_metro, gasto, mp_peca, qtd_risco, risco, risco_peca, modelagem,
modelagem_peca, corte, lavanderia, costura, aviamentos, passadoria, logistica, comissao, pagamento, custo, markup, venda,
markup_alvo, desconto_pct, copia. A aba "Vendas" (nomes de clientes) e o "Painel" ficam de fora.
"""
import openpyxl, json, re, sys, unicodedata
arq, saida = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(arq, data_only=True)
def norm(s): return re.sub(r'\s+', ' ', unicodedata.normalize('NFKD', str(s)).encode('ascii','ignore').decode().lower()).strip()
CAMPOS = {
 'descricao':'descricao','referencia':'referencia','materia prima':'materia','quantidade de pecas':'qtd',
 'custo materia prima':'mp_metro','gasto':'gasto','custo materia prima por peca':'mp_peca',
 'quantidade de pecas risco':'qtd_risco','custo risco':'risco','custo risco por peca':'risco_peca',
 'custo modelagem e pilotagem':'modelagem','custo modelagem e pilotagem peca':'modelagem_peca','custo corte':'corte',
 'custo beneficiamento / lavanderia':'lavanderia','custo costura externa':'costura','custo aviamentos':'aviamentos',
 'custo passadoria':'passadoria','custo logistica':'logistica','comissao venda':'comissao','comissao':'comissao',
 'custo total':'custo','markup':'markup','valor venda':'venda','venda total':'venda_total','despesas':'despesas','liquido':'liquido'}
def num(v):
  try: return round(float(v), 4)
  except: return None
out = []
for n in wb.sheetnames:
  if n in ('Painel','Vendas'): continue
  ws = wb[n]; d = {'aba': n.strip()}
  for r in range(1, 45):
    a = ws.cell(r,1).value
    if a is None: continue
    k = norm(a)
    if k.startswith('custo pagamento'): k = 'pagamento'; d['pagamento'] = num(ws.cell(r,2).value); continue
    if k in CAMPOS:
      v = ws.cell(r,2).value; c = CAMPOS[k]
      d[c] = (str(v).strip() if v is not None else '') if c in ('descricao','referencia','materia') else num(v)
    if k == 'custo total' and norm(ws.cell(r,3).value or '') == 'markup %':
      d['markup_alvo'] = num(ws.cell(r+1,3).value); d['desconto_pct'] = num(ws.cell(r+1,4).value)
  if 'custo' not in d: continue
  d['copia'] = n.strip().lower().startswith('cópia') or n.strip().lower().startswith('copia')
  if d.get('venda') is not None and d.get('custo') is not None: d['margem'] = round(d['venda'] - d['custo'], 2)
  out.append(d)
json.dump(out, open(saida, 'w'), ensure_ascii=False)
print(len(out), 'produtos;', sum(1 for d in out if d['copia']), 'cópias;', sum(1 for d in out if not d.get('venda')), 'sem venda;', sum(1 for d in out if not d.get('referencia')), 'sem referência')
