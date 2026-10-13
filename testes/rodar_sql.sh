#!/usr/bin/env bash
# Aplica a migração num Postgres local (com imitação do Supabase) e roda os testes SQL.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./testes/rodar_sql.sh
set -e
cd "$(dirname "$0")"
P="psql -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists teste_buscador"
$P -c "create database teste_buscador"
$P -d teste_buscador -f stubs_supabase.sql
cat ../supabase/migrations/*.sql | grep -v "^create extension" | $P -d teste_buscador
$P -d teste_buscador -f teste_sql.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //' | grep -v "^$\|^atualizada$\|^nova$"
