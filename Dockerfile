FROM node:24.21.0-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Reproducible production dependency install: require committed lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# Only runtime modules, signed build metadata, web content and security files.
# Do not copy .env, test fixtures, release archives or audit reports into image.
COPY --chown=node:node \
    server.js mailer.js build-authority.js client-ip-policy.js \
    dev-build-signing.js extension-origin-policy.js legacy-v3-shield.js \
    runtime-config.js zvm-official-builds.json zvm-build-registry-v2.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node assets ./assets
COPY --chown=node:node security ./security

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "server.js"]
