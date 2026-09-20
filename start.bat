@echo off
setlocal
cd /d "%~dp0" || (echo [yk] cannot enter project dir & exit /b 1)

echo [yk] 1/6 checking Node.js ...
node --version >nul 2>&1
if errorlevel 1 (
  echo [yk] Node.js is not installed. Run ONE of these (either works):
  echo winget install --id OpenJS.NodeJS.LTS -e --source winget
  echo winget install OpenJS.NodeJS.LTS
  exit /b 1
)

echo [yk] 2/6 checking Ollama ...
ollama --version >nul 2>&1
if errorlevel 1 (
  echo [yk] Ollama is not installed. Run ONE of these (either works):
  echo winget install --id Ollama.Ollama -e --source winget
  echo winget install Ollama.Ollama
  exit /b 1
)

git --version >nul 2>&1
if errorlevel 1 (
  echo [yk] NOTE: Git is not installed - git tools will not work.
  echo [yk] To install it, run ONE of these (either works):
  echo winget install --id Git.Git -e --source winget
  echo winget install Git.Git
)

echo [yk] 3/6 checking dependencies ...
if not exist "backend\node_modules" goto NEEDDEPS
if not exist "frontend\node_modules" goto NEEDDEPS
goto SKIPDEPS
:NEEDDEPS
echo [yk] dependencies missing - installing only what is missing...
call npm run install:all
if errorlevel 1 (echo [yk] npm install FAILED & exit /b 1)
:SKIPDEPS

echo [yk] 4/6 checking frontend build ...
if not exist "frontend\dist\index.html" (
  echo [yk] dist missing - building...
  call npm run build
  if errorlevel 1 (echo [yk] frontend build FAILED - bridge not started & exit /b 1)
)

echo [yk] 5/6 checking Ollama server ...
ollama list >nul 2>&1
if errorlevel 1 (
  echo [yk] Ollama server is down - starting it in a new window...
  start "ollama" ollama serve
  powershell -NoProfile -NonInteractive -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { ollama list >$null 2>&1; if($LASTEXITCODE -eq 0){$ok=$true;break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ok){ Write-Host '[yk] ollama serve did not come up - run manually: ollama serve'; exit 1 }"
  if errorlevel 1 exit /b 1
)
powershell -NoProfile -NonInteractive -Command "$n=((ollama list) | Measure-Object -Line).Lines; if($n -le 1){ Write-Host '[yk] NOTE: no models found.'; Write-Host '[yk] Small model: ollama pull qwen3.5:4b'; Write-Host '[yk] Free cloud models: ollama signin  (logout: ollama signout)'; Write-Host '[yk] Running models: ollama ps   |   Remove one: ollama rm <name>' }"

echo [yk] 6/6 starting bridge ...
cd /d "%~dp0backend" || (echo [yk] cannot enter backend dir & exit /b 1)
start "yk-bridge" node server.js
echo [yk] waiting for bridge on http://127.0.0.1:47911 ...
powershell -NoProfile -NonInteractive -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-RestMethod -Uri http://127.0.0.1:47911/api/health -TimeoutSec 2; if($r.ok){$ok=$true;break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ok){ Write-Host '[yk] bridge did not come up - see the yk-bridge window'; exit 1 }; Write-Host '[yk] bridge is up and working'"
if errorlevel 1 exit /b 1
start "" http://127.0.0.1:47911/
