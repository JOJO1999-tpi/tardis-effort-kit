@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

if not exist "%SCRIPT_DIR%\plugin.js" (
  echo [错误] 未找到 "%SCRIPT_DIR%\plugin.js"，请先完整解压压缩包后再运行本脚本。
  pause
  exit /b 1
)

set "TARGET_HOME="
if defined HERMES_HOME (
  set "TARGET_HOME=%HERMES_HOME%"
) else if exist "%LOCALAPPDATA%\hermes\config.yaml" (
  set "TARGET_HOME=%LOCALAPPDATA%\hermes"
) else if exist "%USERPROFILE%\.hermes\config.yaml" (
  set "TARGET_HOME=%USERPROFILE%\.hermes"
) else if exist "%LOCALAPPDATA%\hermes" (
  set "TARGET_HOME=%LOCALAPPDATA%\hermes"
) else if exist "%USERPROFILE%\.hermes" (
  set "TARGET_HOME=%USERPROFILE%\.hermes"
) else (
  set "TARGET_HOME=%LOCALAPPDATA%\hermes"
)

set "DEST_DIR=%TARGET_HOME%\desktop-plugins\tardis-effort"
echo 正在安装 TARDIS 推理强度插件到:
echo   %DEST_DIR%
echo.

if not exist "%DEST_DIR%" (
  mkdir "%DEST_DIR%"
  if errorlevel 1 (
    echo [错误] 无法创建目标目录: %DEST_DIR%
    pause
    exit /b 1
  )
)

copy /y "%SCRIPT_DIR%\plugin.js" "%DEST_DIR%\plugin.js" >nul
if errorlevel 1 (
  echo [错误] 复制 plugin.js 失败。
  pause
  exit /b 1
)

echo [成功] 插件已安装: "%DEST_DIR%\plugin.js"
echo.
echo 如果 Hermes Desktop 正在运行：
echo   1. 等待数秒自动扫描，或按 Ctrl+K 运行 "Reload desktop plugins"
echo   2. 可在「设置 -> 插件 -> TARDIS 推理强度」调整隐藏原生按钮等选项
echo.
pause
exit /b 0
