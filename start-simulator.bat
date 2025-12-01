@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   🎮 启动模拟器模式
echo ========================================
echo.
echo ✅ 启动服务器 + ZZXL模拟器
echo ⚠️ 模拟器会发送虚拟位姿数据
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
set DRONE_MODE=simulator

echo 📡 正在启动服务器...
start "地面控制服务器" cmd /k "set DRONE_MODE=simulator && npm start"

timeout /t 5 >nul

echo 🎮 正在启动模拟器...
start "ZZXL模拟器" cmd /k "npm run zzxl"

echo.
echo ========================================
echo ✅ 模拟器模式已启动
echo ========================================
echo.
echo 💡 提示：
echo    - 地面控制服务器窗口
echo    - ZZXL模拟器窗口
echo    - 关闭任一窗口即可停止对应服务
echo.
echo 📌 如果启动失败：
echo    1. 检查两个新窗口是否有错误信息
echo    2. 确保端口未被占用
echo    3. 运行 restart-clean.bat 清理进程后重试
echo.
pause
