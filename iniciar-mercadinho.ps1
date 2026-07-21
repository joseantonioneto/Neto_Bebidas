# =====================================================
#  MERCADINHO CAMINHAR - Iniciar sistema + tunel HTTPS
#  Uso: clique duplo em "Iniciar Mercadinho.bat"
# =====================================================
$ErrorActionPreference = 'Continue'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "       MERCADINHO CAMINHAR - CRISTO REI" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Docker ---
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Iniciando Docker Desktop (aguarde ~1 min)..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    foreach ($i in 1..36) {
        Start-Sleep -Seconds 5
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
    }
}
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERRO: Docker nao iniciou. Abra o Docker Desktop manualmente e rode de novo." -ForegroundColor Red
    Read-Host "  Pressione Enter para sair"
    exit 1
}
Write-Host "  [OK] Docker rodando" -ForegroundColor Green

# --- 2. Subir o sistema ---
Write-Host "  Subindo o sistema..." -ForegroundColor Yellow
docker compose up -d 2>$null | Out-Null

$healthy = $false
foreach ($i in 1..30) {
    try {
        $r = Invoke-RestMethod "http://localhost/api/health" -TimeoutSec 3
        if ($r.status -eq 'ok') { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    Write-Host "  ERRO: sistema nao respondeu. Veja: docker compose logs" -ForegroundColor Red
    Read-Host "  Pressione Enter para sair"
    exit 1
}
Write-Host "  [OK] Sistema no ar" -ForegroundColor Green

# --- 3. Endereco na rede local (funciona sem internet) ---
$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown'
} | Select-Object -First 1).IPAddress

# --- 4. Tunel HTTPS (necessario para camera no celular) ---
$cf = $null
foreach ($p in @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "cloudflared"
)) {
    try { $cf = (Get-Command $p -ErrorAction Stop).Source; break } catch {}
}

$url = $null
$proc = $null
if ($cf) {
    Write-Host "  Criando tunel HTTPS (Cloudflare)..." -ForegroundColor Yellow
    $logFile = Join-Path $env:TEMP "cloudflared-mercadinho.log"
    Remove-Item $logFile -ErrorAction SilentlyContinue
    $proc = Start-Process -FilePath $cf -ArgumentList "tunnel", "--url", "http://localhost:80" `
        -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 2
        if (Test-Path $logFile) {
            $m = Select-String -Path $logFile -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value; break }
        }
    }
} else {
    Write-Host "  AVISO: cloudflared nao encontrado - sem tunel HTTPS (camera nao funciona no celular)." -ForegroundColor Yellow
}

# --- 5. Resultado ---
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "            SISTEMA PRONTO!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Neste notebook:   http://localhost" -ForegroundColor White
if ($localIp) {
    Write-Host "  Na rede Wi-Fi:    http://$localIp   (sem camera)" -ForegroundColor White
}
if ($url) {
    Write-Host ""
    Write-Host "  CELULARES/TABLETS (com camera/scanner):" -ForegroundColor Cyan
    Write-Host "  >>> $url <<<" -ForegroundColor Cyan
    Set-Clipboard -Value $url
    Write-Host ""
    Write-Host "  Link ja copiado - e so colar no grupo do WhatsApp." -ForegroundColor Green
} elseif ($cf) {
    Write-Host "  AVISO: tunel nao respondeu (sem internet?). Use o endereco da rede Wi-Fi." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Login inicial: admin / caminhar2026 (troque a senha!)" -ForegroundColor DarkGray
Write-Host ""

if ($proc) {
    Write-Host "  Deixe esta janela ABERTA durante o uso." -ForegroundColor Yellow
    Write-Host "  Fechar a janela desliga o link dos celulares (as vendas ficam salvas)."
    Wait-Process -Id $proc.Id
} else {
    Read-Host "  Pressione Enter para sair (o sistema continua rodando)"
}
