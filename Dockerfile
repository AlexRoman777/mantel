# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
ARG MANTEL_VERSION=dev
ENV NODE_ENV=production DATA_DIR=/data PORT=8780 CONTROL_PORT=8781 MANTEL_PUID=10001 MANTEL_PGID=10001
LABEL org.opencontainers.image.title="Mantel" \
      org.opencontainers.image.version="$MANTEL_VERSION" \
      org.opencontainers.image.description="Self-hosted Immich digital photo frame"
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY scripts/docker-entrypoint.sh /usr/local/bin/mantel-entrypoint
RUN apk upgrade --no-cache \
	&& apk add --no-cache su-exec \
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
	&& rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
	&& mkdir /data \
	&& chown node:node /data \
	&& chmod 0755 /usr/local/bin/mantel-entrypoint
VOLUME /data
EXPOSE 8780 8781
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD wget -qO- http://127.0.0.1:8780/healthz || exit 1
ENTRYPOINT ["mantel-entrypoint"]
CMD ["node", "server.js"]
