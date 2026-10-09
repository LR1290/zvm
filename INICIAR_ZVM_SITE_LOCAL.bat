@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ZVM Site Local - Inicializacao Segura

echo ============================================================
echo  ZVM SITE LOCAL - INICIALIZACAO SEGURA
echo ============================================================

where node.exe >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ZVM LOCAL] ERRO: Node.js nao foi encontrado no PATH.
  echo Instale/ajuste o Node e tente novamente.
  goto :erro
)

for /f "delims=" %%V in ('node -p "process.version"') do set "NODE_VERSION=%%V"
echo [ZVM LOCAL] Node %NODE_VERSION%
node -e "const p=process.versions.node.split('.').map(Number);const ok=(p[0]===24&&p[1]>=20)||(p[0]>=25&&p[0]<27);process.exit(ok?0:1)"
if errorlevel 1 (
  echo [ZVM LOCAL] ERRO: use Node 24.20+ ate a linha 26.x.
  echo [ZVM LOCAL] Producao de referencia permanece na linha Node 24.x do Render.
  goto :erro
)

if not exist "%~dp0server.js" (
  echo [ZVM LOCAL] ERRO: server.js nao encontrado.
  goto :erro
)
if not exist "%~dp0package.json" (
  echo [ZVM LOCAL] ERRO: package.json nao encontrado.
  goto :erro
)

if not exist "%~dp0zvm.env" (
  echo.
  echo [ZVM LOCAL] ERRO: zvm.env nao foi encontrado nesta pasta.
  echo [ZVM LOCAL] Copie o seu zvm.env real ao lado do server.js.
  goto :erro
)
echo [ZVM LOCAL] zvm.env encontrado.
set "DOTENV_CONFIG_PATH=%~dp0zvm.env"

if exist "%~dp0node_modules\dotenv\package.json" if exist "%~dp0node_modules\mongodb\package.json" goto :iniciar

echo [ZVM LOCAL] Dependencias ausentes. Executando npm ci...
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ZVM LOCAL] ERRO: npm.cmd nao foi encontrado no PATH.
  goto :erro
)
call npm.cmd ci
if errorlevel 1 (
  echo.
  echo [ZVM LOCAL] ERRO: npm ci falhou.
  goto :erro
)

:iniciar
set "ZVM_LOCAL_SAFE_MODE=1"
set "NODE_ENV=development"
set "RENDER=false"
set "ZVM_RUNTIME_ENV=production"
set "ZVM_BUILD_ENFORCE=false"
set "ZVM_DEV_BUILD_ALLOW=false"
set "ZVM_DEV_COHOST_ALLOW=false"
set "ZVM_DEV_SIGNED_BUILDS_ALLOW=false"
set "ZVM_LEGACY_V3_ALLOW=false"
set "TRUST_PROXY_HEADERS=0"
if not defined ZVM_LOCAL_PORT set "ZVM_LOCAL_PORT=3000"
if not defined ZVM_LOCAL_BASE_URL set "ZVM_LOCAL_BASE_URL=http://localhost:3000"
set "PORT=%ZVM_LOCAL_PORT%"
set "BASE_URL=%ZVM_LOCAL_BASE_URL%"

echo.
echo [ZVM LOCAL] Modo seguro: ATIVO
echo [ZVM LOCAL] URL: %ZVM_LOCAL_BASE_URL%
echo [ZVM LOCAL] Iniciando o servidor ZVM local...
echo.
node "%~dp0server.js"
set "ZVM_EXIT=%ERRORLEVEL%"

if "%ZVM_EXIT%"=="0" exit /b 0

echo.
echo [ZVM LOCAL] O servidor encerrou com codigo %ZVM_EXIT%.
echo [ZVM LOCAL] A janela ficara aberta para voce ler o erro.
pause
exit /b %ZVM_EXIT%

:erro
echo.
echo [ZVM LOCAL] Inicializacao interrompida.
pause
exit /b 1
