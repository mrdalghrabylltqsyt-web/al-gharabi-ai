# صورة إنتاج عامة لأي منصة تشغيل تدعم Dockerfile وPORT.
# لا تحتوي أي سر: كل الأسرار تُمرَّر كمتغيرات بيئة وقت التشغيل.
# السبب: المنصات المجانية تتغيّر شروطها، فنبقي الصورة محايدة (منفذ واحد،
# عملية واحدة) لتعمل على أي مستضيف يحقن PORT ويشغّل Express.
FROM node:20-slim AS build
WORKDIR /app
ENV NODE_ENV=development
# git مطلوب **زمن البناء** فقط: تبني حزمة المصدر الموثوقة من الشجرة المتتبَّعة
# (`git ls-files`) وتربطها بالـcommit (`git rev-parse HEAD`). الصورة النهائية بلا git.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
# الاعتماديات أولاً ليبقى هذا الملف الطبقي مُخزَّناً بين البناءات.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# vite build ثم حزمة المصدر الموثوقة ثم تجميع server.ts إلى dist/server.cjs.
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# الاعتماديات الإنتاجية فقط في الصورة النهائية (أصغر وأقل سطح هجوم).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# حزمة المصدر الموثوقة المُجمَّعة زمن البناء (شجرة المشروع الكاملة + commit + بصمة)
# موجودة داخل dist/dr-source أصلاً، فهي منسوخة مع dist. لا .git ولا سرّ داخل الصورة.
# نظام DR يقرأها وقت التشغيل ليبني نسخة مصدر كاملة (SOURCE_INCOMPLETE لا يُخفَّف).
# مجلد حالة افتراضي يُستبدل بقرص دائم عند توفره؛ Postgres هو المخزن الدائم.
ENV STATE_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
USER node
# PORT يحقنه المستضيف؛ الافتراضي 3000 للمطابقة مع server.ts.
ENV PORT=3000
# حدّ كومة V8 أقل من سقف الحاوية 256MB (Back4App/Render Free) لتفادي OOM قاتل
# بدل نمو غير محدود. 192MB يترك هامشاً للـRSS والـbuffers خارج الكومة.
ENV NODE_OPTIONS=--max-old-space-size=192
EXPOSE 3000
# يخدم الخادم /api/health للفحص الصحي.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.cjs"]
