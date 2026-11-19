#requires -version 5.1
<#
ZVM MongoDB: backup externo, nao executa migracao e nao altera producao.
Exemplo: powershell -NoProfile -ExecutionPolicy Bypass -File tools/zvm-db-backup-readonly.ps1 -MongoConfigYaml "D:\segredos\mongodb-tools.yml" -BackupDirectory "E:\ZVM-Backups"
MongoConfigYaml deve conter a URI e ficar FORA do repositorio Git. Backup contem dados sensiveis.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$MongoConfigYaml,
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [switch]$IConfirmWritersPaused
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-Command([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { throw "MongoDB Database Tools nao instaladas: $Name" }
  return $cmd.Source
}
$config = (Resolve-Path -LiteralPath $MongoConfigYaml -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) { throw 'Configuracao YAML nao encontrada' }
$dumpTool = Assert-Command 'mongodump'
$restoreTool = Assert-Command 'mongorestore'
if (-not (Test-Path -LiteralPath $BackupDirectory)) {
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
}
$folder = (Resolve-Path -LiteralPath $BackupDirectory).Path
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$archive = Join-Path $folder ("zapvoice-$stamp.archive.gz")
$partial = "$archive.partial"
$manifest = "$archive.sha256.json"
$manifestPartial = "$manifest.partial"
if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $partial) -or (Test-Path -LiteralPath $manifest) -or (Test-Path -LiteralPath $manifestPartial)) {
  throw 'Arquivo de backup preexistente; recusar sobrescrita'
}
try {
  Write-Host 'ZVM: backup de zapvoice, nao imprimir licencas ou credenciais.'
  & $dumpTool "--config=$config" '--db=zapvoice' "--archive=$partial" '--gzip'
  if ($LASTEXITCODE -ne 0) { throw "mongodump falhou (exit=$LASTEXITCODE)" }
  $size = (Get-Item -LiteralPath $partial -ErrorAction Stop).Length
  if ($size -lt 128) { throw 'Backup vazio ou invalido' }
  & $restoreTool "--config=$config" "--archive=$partial" '--gzip' '--dryRun' '--nsInclude=zapvoice.*'
  if ($LASTEXITCODE -ne 0) { throw "mongorestore dryRun falhou (exit=$LASTEXITCODE)" }
  Move-Item -LiteralPath $partial -Destination $archive -ErrorAction Stop
  $sha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $record = [ordered]@{
    sourceDatabase='zapvoice'
    createdUtc=(Get-Date).ToUniversalTime().ToString('o')
    archiveFile=(Split-Path -Leaf $archive)
    sizeBytes=(Get-Item -LiteralPath $archive).Length
    sha256=$sha
    dryRunVerified=$true
    actualRestoreTested=$false
    writersReportedPaused=[bool]$IConfirmWritersPaused
  }
  # Atomic manifest and stable UTF-8 without BOM on both PowerShell 5.1 and 7+.
  $json = ($record | ConvertTo-Json -Depth 3)
  [System.IO.File]::WriteAllText($manifestPartial, $json, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $manifestPartial -Destination $manifest -ErrorAction Stop
  Write-Host 'Backup criado:' $archive
  Write-Host 'SHA256:' $sha
  if (-not $IConfirmWritersPaused) {
    Write-Warning 'Backup preliminar: escritores podem estar ativos. Nao usar como snapshot de corte.'
  } else {
    Write-Warning 'Pausa informada pelo operador; conferir filas e webhooks Cakto antes do corte.'
  }
  Write-Warning 'Guardar em disco criptografado e testar restauracao isolada.'
} catch {
  if (Test-Path -LiteralPath $partial) {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $manifestPartial) {
    Remove-Item -LiteralPath $manifestPartial -Force -ErrorAction SilentlyContinue
  }
  if ((Test-Path -LiteralPath $archive) -and -not (Test-Path -LiteralPath $manifest)) {
    Write-Warning 'Backup existente sem manifesto. Preservado para revisao manual; nao usar para corte.'
  }
  throw
}
