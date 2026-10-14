-- NF-e liga/desliga por empresa + trava automática da rejeição 656.
-- Regra da SEFAZ (NT 2014.002, desde 03/2022): só um sistema pode seguir a sequência de NSU de um CNPJ.
-- Se outro sistema (ERP, contabilidade) já baixa as NF-e do cliente, cada consulta do Buscador leva 656
-- e bloqueia o CNPJ por 1 hora — inclusive para o outro sistema. Por isso, depois de 2 rejeições 656
-- seguidas, a função `sincronizar` desliga a NF-e da empresa (nfe_ativa = false) e grava o motivo.
alter table public.nf_empresas
  add column if not exists nfe_ativa         boolean not null default true,
  add column if not exists nfe_656_seguidas  integer not null default 0,
  add column if not exists nfe_pausa_motivo  text;

-- O admin liga/desliga pela tela (RLS de update já restringe ao admin).
grant update (nfe_ativa) on public.nf_empresas to authenticated;

-- Religar zera a contagem e o motivo; desligar à mão não deixa motivo de trava antigo.
create or replace function public.nf_empresas_nfe_ativa() returns trigger
language plpgsql as $$
begin
  if new.nfe_ativa is distinct from old.nfe_ativa then
    if new.nfe_ativa then
      new.nfe_656_seguidas := 0;
      new.nfe_pausa_motivo := null;
    elsif new.nfe_pausa_motivo is not distinct from old.nfe_pausa_motivo then
      new.nfe_pausa_motivo := null;  -- desligada à mão (a trava grava o motivo no mesmo update)
    end if;
  end if;
  return new;
end $$;

drop trigger if exists nf_empresas_nfe_ativa on public.nf_empresas;
create trigger nf_empresas_nfe_ativa before update on public.nf_empresas
  for each row execute function public.nf_empresas_nfe_ativa();
