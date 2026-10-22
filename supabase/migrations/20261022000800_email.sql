-- E-mail automático da Plataforma pelo Microsoft 365 da Nervia (decisão do Marco em 22/10/2026: sem custo novo).
-- As Edge Functions enviam pelo Microsoft Graph (POST /users/{caixa}/sendMail, permissão Mail.Send de APLICATIVO
-- restrita por RBAC for Applications do Exchange à caixa compartilhada nao-responda@nervia.com.br). SMTP (porta 587)
-- não funciona de dentro das funções; ver "Requisitos e limites conhecidos" no CLAUDE.md.
-- Cada envio (ou falha) fica registrado aqui. O corpo do e-mail NÃO é guardado (pode ter link de acesso).

create table if not exists public.email_envios (
  id        bigint generated always as identity primary key,
  em        timestamptz not null default now(),
  tipo      text not null,                 -- auth_recovery, auth_invite, teste, ...
  para      text not null,
  assunto   text not null default '',
  ok        boolean not null,
  erro      text,
  user_id   uuid,                          -- login a quem se refere (quando houver)
  detalhes  jsonb not null default '{}'::jsonb
);
create index if not exists email_envios_em on public.email_envios (em desc);

alter table public.email_envios enable row level security;
revoke all on public.email_envios from anon;
revoke insert, update, delete on public.email_envios from authenticated;   -- só as funções (service_role) gravam
drop policy if exists email_envios_ler on public.email_envios;
create policy email_envios_ler on public.email_envios for select using (public.eh_admin());
