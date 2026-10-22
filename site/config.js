// Configuração comum do site da Nervia, da Área do Cliente e dos apps (Supabase → Project Settings → API).
// A chave "publishable" é pública por natureza: quem protege os dados é o login + as regras RLS do banco.
window.NERVIA_CONFIG = window.BUSCADOR_CONFIG = {
  SUPABASE_URL: "https://jgokdhqwtcjxcphlwtgk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_NkAoLQVK6j0JeuyFFnS8RQ_fhoNBmQS",
  // NF-e (produtos) passa pela ponte com OpenSSL no Google Cloud Run (ponte-sefaz/). NFS-e vai direto.
  NFE_HABILITADA: true,
  // "Esqueci minha senha" com link por e-mail (Microsoft 365, função email-auth). Ligar só depois do e-mail de teste
  // em Administração → E-mails e do gancho "Send Email" ligado no Supabase; desligado = pedido manual à Nervia.
  ESQUECI_AUTOMATICO: true,
};
