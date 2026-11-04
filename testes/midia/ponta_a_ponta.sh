#!/usr/bin/env bash
# Teste de ponta a ponta do Mídia Indoor: banco real (Postgres + todas as migrações), PostgREST real e as Edge Functions
# "midia" e "midia-tv" de verdade (rodando no Deno), com o Google Drive imitado e a TV imitada (as chamadas do app).
# Precisa de: Postgres (PGHOST/PGPORT/PGUSER), o binário do PostgREST v12+ (variável POSTGREST), Deno e ffmpeg (libx264/libx265).
# Uso: PGHOST=/var/run/postgresql PGUSER=postgres POSTGREST=/caminho/postgrest bash testes/midia/ponta_a_ponta.sh
set -e
cd "$(dirname "$0")/../.."
DB=teste_midia_e2e
SEGREDO=segredo-de-teste-com-pelo-menos-32-caracteres
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f testes/stubs_supabase.sql
cat supabase/migrations/*.sql | grep -v "^create extension" | $P -d $DB > /dev/null
$P -d $DB -c "do \$\$ begin create role autenticador login password 'x' noinherit; exception when duplicate_object then null; end \$\$;
  grant anon, authenticated, service_role to autenticador;"
CONF=$(mktemp)
cat > "$CONF" <<FIM
db-uri = "postgres://autenticador:x@localhost:${PGPORT:-5432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SEGREDO"
server-port = 3996
log-level = "crit"
FIM
"$POSTGREST" "$CONF" > /dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$CONF"' EXIT
for i in $(seq 50); do curl -s -o /dev/null http://localhost:3996/ && break; sleep 0.2; done
PGRST=http://localhost:3996 JWT_SEGREDO=$SEGREDO PGDB=$DB deno test -A testes/midia/ponta_a_ponta_test.ts
