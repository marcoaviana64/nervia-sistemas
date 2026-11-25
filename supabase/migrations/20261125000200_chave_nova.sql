-- NVAura 1.4 / NVSintonia 1.5 — "Gerar uma chave nova" (o Marco criou a conta, não viu a chave e ficou sem ela, 25/11/2026).
-- Quem está DENTRO da conta (sessão aberta) pode trocar a chave: a função sintonia-conta {acao:"nova_chave"} gera outra,
-- troca o e-mail derivado e a senha do login (mesmo usuário, mesmos dados) e a antiga deixa de valer. Sem sessão não há
-- como recuperar (regra da 1.1 continua). Só acrescenta as duas ações permitidas na auditoria da conta (nunca grava a chave).
create or replace function public.sin_conta_auditar(p_user uuid, p_acao text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_acao not in ('sintonia_conta_criada', 'sintonia_email_trocado_por_chave', 'aura_conta_criada',
                    'sintonia_chave_trocada', 'aura_chave_trocada') then raise exception 'Ação inválida.'; end if;
  insert into auditoria (user_id, email, nome, papel, acao, detalhes)
  select p_user, null, p.nome, 'cliente', p_acao, '{}'::jsonb from (select coalesce((select nome from perfis where user_id = p_user), '') as nome) p;
end $$;
revoke execute on function public.sin_conta_auditar(uuid, text) from public, anon, authenticated;
grant execute on function public.sin_conta_auditar(uuid, text) to service_role;
