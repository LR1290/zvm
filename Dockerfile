FROM node:24.22.3-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Immutable lockfile: no dependency drift or installer lifecycle execution.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# Previously the legacy Docker image copied only server.js and mailer.js,
# leaving required src/, client-ip-policy.js and static assets absent at runtime.
# Copy the explicit runtime allowlist, never .env, local backups, tests or .git.
COPY --chown=node:node server.js mailer.js build-authority.js runtime-config.js \
  dev-build-signing.js extension-origin-policy.js client-ip-policy.js \
  legacy-v3-shield.js zvm-official-builds.json zvm-build-registry-v2.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node assets ./assets
COPY --chown=node:node cloud-pilot ./cloud-pilot
COPY --chown=node:node security ./security

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "server.js"]
