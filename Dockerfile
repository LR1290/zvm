# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Instala dependências de produção com cache layer separado
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Variáveis de segurança do Node 22
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=256 --enable-source-maps" \
    PORT=3000

# Copia dependências do stage anterior
COPY --from=deps /app/node_modules ./node_modules

# Copia apenas o necessário (sem .env, sem arquivos de dev)
COPY server.js package.json ./

# Garante que o usuário não-root 'node' (uid 1000) seja o proprietário
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Healthcheck nativo — Docker/Render usam este endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
