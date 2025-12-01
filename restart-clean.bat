@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   🔄 清理并重启系统
echo ========================================
echo.

REM 切换到bat文件所在目录
cd /d "%~dp0"

echo 🛑 正在停止所有 Node.js 进程...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel% == 0 (
    echo ✅ 已停止所有 Node.js 进程
) else (
    echo ⚠️ 没有运行中的 Node.js 进程
)

echo.
echo ⏳ 等待进程完全关闭...
timeout /t 2 >nul

echo.
echo 🚀 正在重新启动...
echo.

REM 设置运行模式
set DRONE_MODE=real

REM 启动服务器
npm start

echo.
echo 👋 服务器已停止
pause
