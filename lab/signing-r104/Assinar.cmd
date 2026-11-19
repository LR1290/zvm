@echo off
setlocal
cd /d "%~dp0"
where py >nul || (echo Instale Python 3 com o launcher py antes de desconectar. & exit /b 1)
where node >nul || (echo Instale Node.js 24 antes de desconectar. & exit /b 1)
set /p "hostqa=Hostname do servidor exclusivo QA verificado: "
set /p "arquivo=Arquivo privado PEM ou PKCS8 base64, caminho sem aspas: "
py -3 preparar.py R104-entrada.zip --qa-host "%hostqa%" --key "%arquivo%" --out R104-DEV-QA.zip
if errorlevel 1 exit /b 1
py -3 verificar.py R104-DEV-QA.zip > R104-relatorio.txt
if errorlevel 1 (echo Verificacao falhou. Nao instale o ZIP. & exit /b 1)
type R104-relatorio.txt
