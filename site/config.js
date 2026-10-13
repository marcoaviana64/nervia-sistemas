// Configuração comum do site da Nervia, da Área do Cliente e dos apps (Supabase → Project Settings → API).
// A chave "publishable" é pública por natureza: quem protege os dados é o login + as regras RLS do banco.
window.NERVIA_CONFIG = window.BUSCADOR_CONFIG = {
  SUPABASE_URL: "https://jgokdhqwtcjxcphlwtgk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_NkAoLQVK6j0JeuyFFnS8RQ_fhoNBmQS",
  // NF-e (produtos) fica para depois: precisa da ponte com OpenSSL (ver CLAUDE.md). NFS-e funciona.
  NFE_HABILITADA: false,
};
