# صورة إنتاج عامة لأي منصة تشغيل تدعم Dockerfile وPORT.
# لا تحتوي أي سر: كل الأسرار تُمرَّر كمتغيرات بيئة وقت التشغيل.
# السبب: المنصات المجانية تتغيّر شروطها، فنبقي الصورة محايدة (منفذ واحد،
# عملية واحدة) لتعمل على أي مستضيف يحقن PORT ويشغّل Express.
FROM node:20-slim AS build
WORKDIR /app
ENV NODE_ENV=development
# الاعتماديات أولاً ليبقى هذا الملف الطبقي مُخزَّناً بين البناءات.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# vite build ثم تجميع server.ts إلى dist/server.cjs (نفس خطوة npm run build).
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# الاعتماديات الإنتاجية فقط في الصورة النهائية (أصغر وأقل سطح هجوم).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# مجلد حالة افتراضي يُستبدل بقرص دائم عند توفره؛ Postgres هو المخزن الدائم.
ENV STATE_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
USER node
# PORT يحقنه المستضيف؛ الافتراضي 3000 للمطابقة مع server.ts.
ENV PORT=3000
EXPOSE 3000
# يخدم الخادم /api/health للفحص الصحي.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.cjs"]
