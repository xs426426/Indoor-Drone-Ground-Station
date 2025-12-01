@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   🚁 启动实机模式
echo ========================================
echo.
echo ✅ 只启动服务器，不启动模拟器
echo ✅ 连接到真实无人机
echo.

REM 切换到bat文件所在目录
cd /d "%~dp0"

REM 检查node_modules是否存在
if not exist "node_modules" (
    echo ❌ 错误：node_modules 不存在
    echo 请先运行: npm install
    pause
    exit /b 1
)

REM 设置运行模式
set DRONE_MODE=real

REM 启动服务器
echo 🚀 正在启动服务器...
echo.
npm start

REM 捕获错误码
set EXIT_CODE=%errorlevel%
echo.
echo ========================================
if %EXIT_CODE% neq 0 (
    echo ❌ 启动失败，错误码: %EXIT_CODE%
    echo.
    echo 💡 常见问题：
    echo    1. 检查是否有其他进程占用端口
    echo    2. 确保 client 目录的依赖已安装
    echo    3. 尝试运行 restart-clean.bat 清理进程
) else (
    echo ✅ 服务器已正常停止
)
echo ========================================
echo.
pause
