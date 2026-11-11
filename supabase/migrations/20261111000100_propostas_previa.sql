-- Propostas: prévia para a equipe Nervia (pedido do Marco em 11/11/2026: abriu o link de uma proposta ainda em rascunho
-- e viu "Esta proposta não está disponível"). O link continua fechado para o prospect enquanto for rascunho ou cancelada;
-- a equipe Nervia, logada, vê a proposta como o prospect vai ver, em qualquer situação, sem código.
-- Não conta visita, não grava histórico nem auditoria (só leitura) e não deixa responder (a página esconde a resposta).

create or replace function public.prop_previa(p_link text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.prop_propostas;
begin
  if not public.eh_admin() then raise exception 'Só a equipe Nervia vê a prévia da proposta. Entre na Área do Cliente como admin e tente de novo.'; end if;
  select * into r from public.prop_propostas where link = lower(trim(coalesce(p_link, '')));
  if r.id is null then return jsonb_build_object('ok', false, 'erro', 'Proposta não encontrada. Confira o link.'); end if;
  return jsonb_build_object('ok', true, 'situacao_real', r.situacao, 'proposta', public._prop_publica(r));
end $$;
revoke execute on function public.prop_previa(text) from public, anon;
grant execute on function public.prop_previa(text) to authenticated;
