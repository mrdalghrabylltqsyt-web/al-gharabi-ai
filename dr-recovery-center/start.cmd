@echo off
REM مركز استعادة الغرابي AI — مشغّل محلي مستقل (Windows).
REM الاستخدام: انقر مزدوجاً على هذا الملف ثم افتح http://127.0.0.1:4600
cd /d "%~dp0"
if not exist node_modules (
  echo تثبيت الاعتماديات لأول مرة...
  call npm install --omit=dev
)
echo افتح المتصفح على: http://127.0.0.1:4600
node lib\recovery-center.mjs
