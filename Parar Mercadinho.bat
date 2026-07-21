@echo off
cd /d "%~dp0"
echo Parando o Mercadinho Caminhar (as vendas ficam salvas no banco)...
docker compose down
echo.
echo Sistema parado. Pode fechar esta janela.
pause
