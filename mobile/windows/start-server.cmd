@echo off
cd /d "%~dp0"
if not exist data mkdir data
set WC2_HTTP=1
"%~dp0node.exe" "%~dp0server.js" --no-open >> "%~dp0data\startup.log" 2>&1
