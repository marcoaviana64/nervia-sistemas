-- Termo de autorização de uso e custódia do certificado A1 (um por empresa).
-- O certificado só pode ser enviado com o termo "assinado" ou "dispensado" (empresa da própria Nervia).
alter table public.nf_empresas
  add column if not exists termo_status text not null default 'pendente'
    check (termo_status in ('pendente', 'assinado', 'dispensado')),
  add column if not exists termo_assinado_em date,
  add column if not exists termo_signatario text,
  add column if not exists termo_obs text;

-- o admin registra o termo pela tela (mesma política de update: só admin)
grant update (termo_status, termo_assinado_em, termo_signatario, termo_obs) on public.nf_empresas to authenticated;

-- empresas que já tinham certificado antes desta regra: a da própria Nervia fica dispensada
update public.nf_empresas
   set termo_status = 'dispensado', termo_obs = 'Empresa da própria Nervia.'
 where cnpj = '32072678000176' and termo_status = 'pendente';
