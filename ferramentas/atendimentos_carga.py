"""Carga da Central "Nervia Atendimentos" (artifact) para o app Atendimentos de TI (tabelas atd_).

Os dados reais NÃO vão para o GitHub: baixar as coleções da Central (ArtifactData, ação list, limit 1000, out_dir fora do
repositório) — chamados, empreendimentos e ativos — e gerar o SQL numa pasta fora do repositório:

    python3 ferramentas/atendimentos_carga.py <pasta com chamados/ empreendimentos/ ativos/> <saida.sql>

O SQL roda numa transação só, com "set local atd.carga = 'sim'" (gatilhos de auditoria e de histórico quietos), mantém
os números dos chamados e os códigos dos equipamentos, traz o histórico dos equipamentos como estava, continua a
numeração do maior número, grava um registro só na auditoria (atendimentos_carga) e CONFERE no fim: se a situação ou o
fechamento recalculados no banco forem diferentes dos da Central, ou se faltar algum chamado/andamento, desfaz tudo.
Recusa se já houver chamados no banco (carga é uma vez só).
"""
import json, glob, os, sys


def ler(pasta, colecao):
    out = []
    for f in sorted(glob.glob(os.path.join(pasta, colecao, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        out.append(d.get('data', d) if isinstance(d, dict) and 'data' in d and isinstance(d['data'], dict) else d)
    return out


def q(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def t(v):  # texto obrigatório (coluna not null default '')
    return "'" + str(v or '').strip().replace("'", "''") + "'"


def main(pasta, saida):
    emps, chs, ativos = ler(pasta, 'empreendimentos'), ler(pasta, 'chamados'), ler(pasta, 'ativos')
    assert emps and chs, 'faltam empreendimentos ou chamados'
    nums = [c['numero'] for c in chs]
    assert len(nums) == len(set(nums)), 'número de chamado repetido'
    siglas = {e['sigla'] for e in emps}
    assert all(c['empr'] in siglas for c in chs), 'chamado com empreendimento desconhecido'
    n_and = sum(len(c.get('andamentos') or []) for c in chs)
    L = ['begin;', "set local atd.carga = 'sim';",
         "do $$ begin if exists (select 1 from public.atd_chamados) then raise exception 'Já há chamados no banco: a carga é uma vez só.'; end if; end $$;"]
    for e in emps:
        L.append(f"insert into public.atd_empreendimentos (sigla, nome, cod_equip) values ({q(e['sigla'])}, {t(e['nome'])}, {q(e.get('codEquip') or e['sigla'].upper())});")
    for c in sorted(chs, key=lambda c: c['numero']):
        L.append('insert into public.atd_chamados (numero, sigla, abertura, resumo, descricao, tipo, solicitante, categoria, origem, criado_em, criado_por) values '
                 f"({c['numero']}, {q(c['empr'])}, {q(c['abertura'])}, {t(c.get('resumo'))}, {t(c.get('descricao'))}, {t(c.get('tipo'))}, "
                 f"{t(c.get('solicitante'))}, {t(c.get('categoria'))}, {t(c.get('origem'))}, {q(c.get('criadoEm')) if c.get('criadoEm') else 'now()'}, null);")
        for a in c.get('andamentos') or []:
            L.append(f"insert into public.atd_andamentos (numero, data, fechado, texto, criado_por) values ({c['numero']}, {q(a['data'])}, {q(bool(a['fechado']))}, {t(a['texto'])}, null);")
    # equipamentos: primeiro os principais, depois os itens instalados neles
    for a in sorted(ativos, key=lambda a: (bool(a.get('vinculadoA')), a['codigo'])):
        L.append('insert into public.atd_equipamentos (codigo, seq, sigla, prefixo, marca, modelo, serie, setor, situacao, usuario, vinculado_a, obs, criado_em) values '
                 f"({q(a['codigo'])}, {a['seq']}, {q(a['empr'])}, {q(a['prefixo'])}, {t(a.get('marca'))}, {t(a.get('modelo'))}, {t(a.get('serie'))}, "
                 f"{t(a.get('setor'))}, {q(a.get('situacao') or 'Em uso')}, {t(a.get('usuario'))}, {q(a.get('vinculadoA'))}, {t(a.get('obs'))}, "
                 f"{q(a.get('criadoEm')) if a.get('criadoEm') else 'now()'});")
        for h in a.get('historico') or []:
            L.append(f"insert into public.atd_equip_historico (codigo, data, evento, criado_por) values ({q(a['codigo'])}, {q(h['data'])}, {t(h['evento'])}, null);")
    for c in chs:
        for k in c.get('ativos') or []:
            L.append(f"insert into public.atd_chamado_equip (numero, codigo) values ({c['numero']}, {q(k)});")
    # conferência contra a Central (situação e fechamento são recalculados pelo gatilho)
    esperado = ', '.join(f"({c['numero']}, {q(c['status'])}, {q(c.get('fechamento') or None)}::date)" for c in chs)
    L.append(f"""do $$ declare v_dif int; begin
  select count(*) into v_dif from (values {esperado}) e(numero, status, fechamento)
    left join public.atd_chamados c using (numero)
   where c.numero is null or c.status is distinct from e.status or c.fechamento is distinct from e.fechamento;
  if v_dif > 0 then raise exception 'Conferência: % chamado(s) diferentes da Central. Nada foi gravado.', v_dif; end if;
  if (select count(*) from public.atd_chamados) <> {len(chs)} or (select count(*) from public.atd_andamentos) <> {n_and}
     or (select count(*) from public.atd_empreendimentos) <> {len(emps)} or (select count(*) from public.atd_equipamentos) <> {len(ativos)} then
    raise exception 'Conferência: contagem diferente da Central. Nada foi gravado.';
  end if;
end $$;""")
    L.append("select setval('public.atd_chamados_numero_seq', (select max(numero) from public.atd_chamados));")
    L.append("select public.auditar('atendimentos_carga', null, " + q(json.dumps({
        'origem': 'Central Nervia Atendimentos (artifact)', 'empreendimentos': len(emps), 'chamados': len(chs), 'andamentos': n_and,
        'equipamentos': len(ativos), 'maior_numero': max(nums)}, ensure_ascii=False)) + "::jsonb);")
    L.append('commit;')
    open(saida, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print(f'{len(emps)} empreendimentos, {len(chs)} chamados, {n_and} andamentos, {len(ativos)} equipamentos → {saida}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
