#!/usr/bin/env bash
# مركز استعادة الغرابي AI — مشغّل محلي مستقل (Linux/macOS).
# الاستخدام: ./start.sh   ثم افتح http://127.0.0.1:4600
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "تثبيت الاعتماديات لأول مرة..."
  npm install --omit=dev
fi
echo "افتح المتصفح على: http://127.0.0.1:4600"
node lib/recovery-center.mjs
