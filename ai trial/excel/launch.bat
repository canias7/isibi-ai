@echo off
REM One-click launcher for the Excel Formula Bot.
REM Put this in "ai trial\excel\" and double-click it (after training has saved a checkpoint).
cd /d "%~dp0"

if not exist excel.ckpt (
  echo.
  echo   No excel.ckpt yet. Wait for training to save a checkpoint, then run this again.
  echo.
  pause
  exit /b 1
)

echo Starting the Formula Bot...
start "Formula Bot - model API (:8000)" cmd /k python serve.py
start "Formula Bot - task pane (:3001)" cmd /k python -m http.server 3001 --directory addin

echo.
echo   Model API : http://127.0.0.1:8000
echo   Task pane : http://localhost:3001/taskpane.html
echo.
echo Next: in Excel, Insert -^> Add-ins -^> Upload My Add-in -^> addin\manifest.xml
echo (Close the two popup windows to stop the bot.)
pause
