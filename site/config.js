// Configuração comum do site da Nervia, da Área do Cliente e dos apps (Supabase → Project Settings → API).
// A "anon key" é pública por natureza: quem protege os dados é o login + as regras RLS do banco.
window.NERVIA_CONFIG = window.BUSCADOR_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "COLE-AQUI-A-ANON-KEY",
};
