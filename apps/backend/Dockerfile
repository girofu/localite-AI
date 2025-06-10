# 多階段建置 - 建置階段
FROM node:18-alpine AS builder

# 設定工作目錄
WORKDIR /app

# 複製 package files
COPY package*.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY packages/shared/package*.json ./packages/shared/

# 安裝依賴
RUN npm ci --only=production

# 複製源碼
COPY apps/backend ./apps/backend
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# 建置應用
WORKDIR /app/apps/backend
RUN npm run build

# 生產階段
FROM node:18-alpine AS production

# 安裝 dumb-init 用於信號處理
RUN apk add --no-cache dumb-init

# 建立非 root 用戶
RUN addgroup -g 1001 -S nodejs
RUN adduser -S localite -u 1001

# 設定工作目錄
WORKDIR /app

# 複製建置後的文件
COPY --from=builder --chown=localite:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=localite:nodejs /app/apps/backend/dist ./dist
COPY --from=builder --chown=localite:nodejs /app/apps/backend/package*.json ./

# 建立配置目錄
RUN mkdir -p /app/config && chown localite:nodejs /app/config

# 切換到非 root 用戶
USER localite

# 暴露端口
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node dist/health-check.js

# 啟動應用
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"] 