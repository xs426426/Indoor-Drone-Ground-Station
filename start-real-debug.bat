@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   🚁 启动实机模式（调试版）
echo ========================================
echo.
echo ✅ 只启动服务器，不启动模拟器
echo ✅ 连接到真实无人机
echo.

REM 切换到bat文件所在目录
cd /d "%~dp0"
echo 📂 当前目录: %cd%
echo.

REM 检查node_modules是否存在
if not exist "node_modules" (
    echo ❌ 错误：node_modules 不存在
    echo 请先运行: npm install
    pause
    exit /b 1
)
echo ✅ node_modules 存在
echo.

REM 检查client/node_modules
if not exist "client\node_modules" (
    echo ❌ 错误：client\node_modules 不存在
    echo 请先运行: cd client && npm install
    pause
    exit /b 1
)
echo ✅ client\node_modules 存在
echo.

REM 检查node是否可用
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：找不到 node 命令
    echo 请确保已安装 Node.js 并添加到 PATH
    pause
    exit /b 1
)
echo ✅ Node.js 已安装
node --version
echo.

REM 检查npm是否可用
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：找不到 npm 命令
    pause
    exit /b 1
)
echo ✅ npm 已安装
npm --version
echo.

REM 设置运行模式
set DRONE_MODE=real
echo 🎯 运行模式: %DRONE_MODE%
echo.

REM 启动服务器
echo 🚀 正在启动服务器...
echo ⏳ 如果出现错误，窗口不会自动关闭
echo.
npm start

REM 捕获错误码
set EXIT_CODE=%errorlevel%
echo.
echo ========================================
if %EXIT_CODE% neq 0 (
    echo ❌ 启动失败，错误码: %EXIT_CODE%
) else (
    echo ✅ 服务器已停止
)
echo ========================================
echo.
pause
