@echo off
REM 녹취 STT 워커 상주 실행 (이 PC 의 GPU 사용). 종료: 창 닫기
cd /d %~dp0
if "%SALES_API%"=="" set SALES_API=http://localhost:3002
if "%WORKER_TOKEN%"=="" (
  echo WORKER_TOKEN 환경변수를 설정하세요 ^(be\.env 의 WORKER_TOKEN 과 동일^)
  pause
  exit /b 1
)
python transcribe_worker.py
pause
