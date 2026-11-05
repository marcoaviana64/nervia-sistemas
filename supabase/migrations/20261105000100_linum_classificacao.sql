-- Sistema Linum 2.30: classificação tributária no cadastro de produtos (pedido do Marco em 05/11/2026: cada peça com a
-- classificação escolhida de uma tabela, para a nota fiscal; decisão do Marco: fazer no Sistema Linum da Plataforma, a versão
-- estável, e aposentar o LINUM Stock & Sales antigo, onde a tabela tinha sido montada).
--   * lin_classificacoes = a tabela das 70 classificações (grupo, tipo de peça, material, NCM com 8 dígitos sem pontos,
--     CEST com 7 dígitos ou vazio, observação, ordem, ativo), copiada do banco antigo em 05/11/2026. Quem usa o app lê;
--     mudar a tabela é com a equipe Nervia (SQL), não pela tela.
--   * lin_produtos.classificacao_id (vazio = sem classificação; nenhum produto muda na migração).
--   * lin_produto_salvar aceita "classificacao_id" (chave ausente = mantém; vazio = sem classificação); recusa uma
--     desativada, salvo a que a peça já tinha. A auditoria linum_produto_alterado mostra o antes/depois.
--   * Entra na cópia noturna sozinha (lin_copia_fazer copia todas as tabelas public.lin_*).

create table if not exists public.lin_classificacoes (
  id          uuid primary key default gen_random_uuid(),
  grupo       text not null,
  tipo_peca   text not null,
  material    text not null,
  ncm         text not null check (ncm ~ '^[0-9]{8}$'),
  cest        text check (cest is null or cest ~ '^[0-9]{7}$'),
  observacao  text,
  ordem       int not null default 0 unique,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
alter table public.lin_classificacoes enable row level security;
revoke insert, update, delete on public.lin_classificacoes from anon, authenticated;
revoke all on public.lin_classificacoes from anon;
drop policy if exists lin_classificacoes_ler on public.lin_classificacoes;
create policy lin_classificacoes_ler on public.lin_classificacoes for select using (public.lin_papel() is not null);

insert into public.lin_classificacoes (grupo, tipo_peca, material, ncm, cest, observacao, ordem) values
  ('Feminino (tecido plano)', 'Vestido', 'Algodão', '62044200', null, null, 101),
  ('Feminino (tecido plano)', 'Vestido', 'Sintética (poliéster)', '62044300', null, null, 102),
  ('Feminino (tecido plano)', 'Vestido', 'Linho / outras fibras', '62044900', null, null, 103),
  ('Feminino (tecido plano)', 'Saia', 'Algodão', '62045200', null, null, 111),
  ('Feminino (tecido plano)', 'Saia', 'Sintética (poliéster)', '62045300', null, null, 112),
  ('Feminino (tecido plano)', 'Saia', 'Linho / outras fibras', '62045900', null, null, 113),
  ('Feminino (tecido plano)', 'Calça, short, bermuda, macacão com alça', 'Algodão', '62046200', null, null, 121),
  ('Feminino (tecido plano)', 'Calça, short, bermuda, macacão com alça', 'Sintética (poliéster)', '62046300', null, null, 122),
  ('Feminino (tecido plano)', 'Calça, short, bermuda, macacão com alça', 'Linho / outras fibras', '62046900', null, null, 123),
  ('Feminino (tecido plano)', 'Blusa, camisa, bata, kaftan curto', 'Algodão', '62063000', null, null, 131),
  ('Feminino (tecido plano)', 'Blusa, camisa, bata, kaftan curto', 'Sintética (poliéster)', '62064000', null, null, 132),
  ('Feminino (tecido plano)', 'Blusa, camisa, bata, kaftan curto', 'Linho / outras fibras', '62069000', null, null, 133),
  ('Feminino (tecido plano)', 'Blazer, casaqueto', 'Algodão', '62043200', null, null, 141),
  ('Feminino (tecido plano)', 'Blazer, casaqueto', 'Sintética (poliéster)', '62043300', null, null, 142),
  ('Feminino (tecido plano)', 'Blazer, casaqueto', 'Linho / outras fibras', '62043900', null, 'Marcado "conferir" na tabela', 143),
  ('Feminino (tecido plano)', 'Kimono (aberto, usado por cima)', 'Algodão', '62043200', null, null, 151),
  ('Feminino (tecido plano)', 'Kimono (aberto, usado por cima)', 'Sintética (poliéster)', '62043300', null, null, 152),
  ('Feminino (tecido plano)', 'Kimono (aberto, usado por cima)', 'Linho / outras fibras', '62043900', null, 'Marcado "conferir" na tabela', 153),
  ('Feminino (tecido plano)', 'Colete (vendido sozinho)', 'Algodão', '62114200', null, null, 161),
  ('Feminino (tecido plano)', 'Colete (vendido sozinho)', 'Sintética (poliéster)', '62114300', null, null, 162),
  ('Feminino (tecido plano)', 'Colete (vendido sozinho)', 'Linho / outras fibras', '62114900', null, 'Marcado "conferir" na tabela', 163),
  ('Feminino (tecido plano)', 'Macacão inteiro (sem ser jardineira)', 'Algodão', '62114200', null, null, 171),
  ('Feminino (tecido plano)', 'Macacão inteiro (sem ser jardineira)', 'Sintética (poliéster)', '62114300', null, null, 172),
  ('Feminino (tecido plano)', 'Macacão inteiro (sem ser jardineira)', 'Linho / outras fibras', '62114900', null, 'Marcado "conferir" na tabela', 173),
  ('Feminino (tecido plano)', 'Conjunto (mesmo tecido, vendido junto)', 'Algodão', '62042200', null, null, 181),
  ('Feminino (tecido plano)', 'Conjunto (mesmo tecido, vendido junto)', 'Sintética (poliéster)', '62042300', null, null, 182),
  ('Feminino (tecido plano)', 'Conjunto (mesmo tecido, vendido junto)', 'Linho / outras fibras', '62042900', null, 'Marcado "conferir" na tabela', 183),
  ('Feminino (malha)', 'Vestido', 'Algodão', '61044200', null, null, 201),
  ('Feminino (malha)', 'Vestido', 'Sintética', '61044300', null, null, 202),
  ('Feminino (malha)', 'Vestido', 'Outras fibras', '61044900', null, null, 203),
  ('Feminino (malha)', 'Saia', 'Algodão', '61045200', null, null, 211),
  ('Feminino (malha)', 'Saia', 'Sintética', '61045300', null, null, 212),
  ('Feminino (malha)', 'Saia', 'Outras fibras', '61045900', null, null, 213),
  ('Feminino (malha)', 'Calça, short', 'Algodão', '61046200', null, null, 221),
  ('Feminino (malha)', 'Calça, short', 'Sintética', '61046300', null, null, 222),
  ('Feminino (malha)', 'Calça, short', 'Outras fibras', '61046900', null, null, 223),
  ('Feminino (malha)', 'Blusa, camisa', 'Algodão', '61061000', null, null, 231),
  ('Feminino (malha)', 'Blusa, camisa', 'Sintética', '61062000', null, null, 232),
  ('Feminino (malha)', 'Blusa, camisa', 'Outras fibras', '61069000', null, null, 233),
  ('Feminino (malha)', 'Camiseta, regata', 'Algodão', '61091000', null, null, 241),
  ('Feminino (malha)', 'Camiseta, regata', 'Sintética / outras fibras', '61099000', null, null, 242),
  ('Feminino (malha)', 'Tricô, suéter, cardigã, moletom', 'Algodão', '61102000', null, null, 251),
  ('Feminino (malha)', 'Tricô, suéter, cardigã, moletom', 'Sintética', '61103000', null, null, 252),
  ('Feminino (malha)', 'Tricô, suéter, cardigã, moletom', 'Lã', '61101100', null, null, 253),
  ('Feminino (malha)', 'Tricô, suéter, cardigã, moletom', 'Outras fibras', '61109000', null, null, 254),
  ('Masculino (tecido plano)', 'Camisa', 'Algodão', '62052000', null, null, 301),
  ('Masculino (tecido plano)', 'Camisa', 'Sintética', '62053000', null, null, 302),
  ('Masculino (tecido plano)', 'Camisa', 'Linho / outras fibras', '62059090', null, null, 303),
  ('Masculino (tecido plano)', 'Calça, bermuda, short', 'Algodão', '62034200', null, null, 311),
  ('Masculino (tecido plano)', 'Calça, bermuda, short', 'Sintética', '62034300', null, null, 312),
  ('Masculino (tecido plano)', 'Calça, bermuda, short', 'Linho / outras fibras', '62034900', null, null, 313),
  ('Masculino (tecido plano)', 'Paletó, blazer', 'Algodão', '62033200', null, null, 321),
  ('Masculino (tecido plano)', 'Paletó, blazer', 'Sintética', '62033300', null, null, 322),
  ('Masculino (tecido plano)', 'Paletó, blazer', 'Linho / outras fibras', '62033900', null, null, 323),
  ('Infantil (bebê até 86 cm)', 'Roupa de bebê', 'Algodão', '62092000', null, null, 401),
  ('Infantil (bebê até 86 cm)', 'Roupa de bebê', 'Sintética', '62093000', null, null, 402),
  ('Infantil (bebê até 86 cm)', 'Roupa de bebê', 'Linho / outras fibras', '62099090', null, null, 403),
  ('Acessórios', 'Echarpe, lenço, xale', 'Seda', '62141000', null, null, 501),
  ('Acessórios', 'Echarpe, lenço, xale', 'Lã', '62142000', null, null, 502),
  ('Acessórios', 'Echarpe, lenço, xale', 'Sintética (poliéster)', '62143000', null, null, 503),
  ('Acessórios', 'Echarpe, lenço, xale', 'Algodão', '62149010', null, null, 504),
  ('Acessórios', 'Echarpe, lenço, xale', 'Linho / outras', '62149090', null, null, 505),
  ('Acessórios', 'Bolsa', 'Couro', '42022100', '2804000', 'Confirmar ST com o contador', 511),
  ('Acessórios', 'Bolsa', 'Tecido (linho, palha, algodão)', '42022220', '2804000', 'Confirmar ST com o contador', 512),
  ('Acessórios', 'Bijuteria (colar, brinco, pulseira)', 'Metal comum (folheado ou não)', '71171900', '2805800', 'Confirmar ST com o contador', 521),
  ('Acessórios', 'Bijuteria (colar, brinco, pulseira)', 'Outros (resina, madeira, contas, tecido)', '71179000', '2805800', 'Confirmar ST com o contador', 522),
  ('Acessórios', 'Cinto', 'Couro', '42033000', null, null, 531),
  ('Acessórios', 'Cinto', 'Tecido (linho, algodão, corda)', '62171000', null, null, 532),
  ('Acessórios', 'Cinto', 'Plástico / sintético', '39262000', null, 'Marcado "conferir" na tabela', 533),
  ('Acessórios', 'Chapéu', 'Palha trançada', '65040000', null, null, 541)
on conflict (ordem) do nothing;

alter table public.lin_produtos add column if not exists classificacao_id uuid references public.lin_classificacoes on delete set null;

create or replace function public.lin_produto_salvar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_ref text := public._lin_txt(p, 'referencia');
        v_desc text := public._lin_txt(p, 'descricao'); v_antes jsonb;
        v_dono boolean := public.lin_eh_dono();   -- só o Dono vê e grava custo; para o Estoque o custo gravado fica como está
        v_classif uuid := nullif(p ->> 'classificacao_id', '')::uuid;   -- chave ausente = mantém a classificação atual
begin
  if not public.lin_controla_estoque() then raise exception 'Somente o Dono ou o Estoque cadastra produtos'; end if;
  if v_ref is null and v_id is not null then raise exception 'Informe o código / referência'; end if;
  if v_desc is null then raise exception 'Informe a descrição (nome da peça)'; end if;
  if v_ref is null then v_ref := public._lin_ref_provisoria(); end if;
  if v_classif is not null and not exists (select 1 from public.lin_classificacoes c where c.id = v_classif
       and (c.ativo or c.id = (select x.classificacao_id from public.lin_produtos x where x.id = v_id))) then
    raise exception 'Classificação tributária não encontrada ou desativada';
  end if;   -- produto novo sem referência = provisória
  if exists (select 1 from public.lin_produtos where lower(referencia) = lower(v_ref) and id is distinct from v_id) then
    raise exception 'Já existe um produto com a referência %', v_ref;
  end if;
  if v_id is null then
    insert into public.lin_produtos (referencia, descricao, categoria, colecao, fornecedor, tecido, preco_custo, preco_venda, consumo_metros, ativo, classificacao_id)
    values (v_ref, v_desc, public._lin_txt(p, 'categoria'), public._lin_txt(p, 'colecao'), public._lin_txt(p, 'fornecedor'),
            public._lin_txt(p, 'tecido'), case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') end,
            coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0), public._lin_num(p, 'consumo_metros', 'Consumo de tecido'),
            coalesce((p ->> 'ativo')::boolean, true), v_classif)
    returning id into v_id;
    perform public._lin_auditar('linum_produto_criado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref, 'descricao', v_desc)
      || case when public._lin_txt(p, 'referencia') is null then jsonb_build_object('referencia_provisoria', true) else '{}'::jsonb end);
  else
    select to_jsonb(x) - 'atualizado_em' - 'criado_em' into v_antes from public.lin_produtos x where id = v_id for update;
    if v_antes is null then raise exception 'Produto não encontrado'; end if;
    update public.lin_produtos set referencia = v_ref, descricao = v_desc, categoria = public._lin_txt(p, 'categoria'),
      colecao = public._lin_txt(p, 'colecao'), fornecedor = public._lin_txt(p, 'fornecedor'), tecido = public._lin_txt(p, 'tecido'),
      preco_custo = case when v_dono then public._lin_num(p, 'preco_custo', 'Preço de custo') else preco_custo end,
      preco_venda = coalesce(public._lin_num(p, 'preco_venda', 'Preço de venda'), 0),
      consumo_metros = public._lin_num(p, 'consumo_metros', 'Consumo de tecido'),
      ativo = coalesce((p ->> 'ativo')::boolean, true),
      classificacao_id = case when p ? 'classificacao_id' then v_classif else classificacao_id end
    where id = v_id;
    perform public._lin_auditar('linum_produto_alterado', null, jsonb_build_object('produto_id', v_id, 'referencia', v_ref,
      'antes', case when v_dono then v_antes else v_antes - 'preco_custo' end,
      'depois', (select case when v_dono then to_jsonb(x) else to_jsonb(x) - 'preco_custo' end - 'atualizado_em' - 'criado_em' from public.lin_produtos x where id = v_id)));
  end if;
  return v_id;
end $$;
