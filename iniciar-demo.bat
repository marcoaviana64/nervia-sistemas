@echo off
rem Demonstracao com dados ficticios (nao acessa Supabase nem SEFAZ)
cd /d "%~dp0"
set PYTHONUTF8=1
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY (
  echo Python nao encontrado. Instale em python.org e marque "Add python.exe to PATH".
  pause
  exit /b 1
)
%PY% testes\demo.py
echo.
echo A demonstracao foi encerrada. Se apareceu algum erro acima, copie e envie para o Claude.
pause
