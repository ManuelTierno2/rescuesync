# Targets: `dev` (docker compose, recarga con tsx watch) y `runtime` (producción / Render, es el último y el que se construye por defecto).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma generate exige DATABASE_URL aunque no se conecte; este valor solo existe durante el build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

FROM node:24-alpine AS dev
ARG UID=10001
ARG GID=10001
RUN addgroup -g ${GID} rescuesync && adduser -D -u ${UID} -G rescuesync rescuesync \
    && mkdir -p /app && chown rescuesync:rescuesync /app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && chown -R rescuesync:rescuesync /app/node_modules
COPY --chown=rescuesync:rescuesync . .
RUN chmod +x /app/entrypoint.sh
USER rescuesync
ENTRYPOINT ["sh", "/app/entrypoint.sh"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/dist ./dist
USER node
# Migra, carga el catálogo y el ADMIN (idempotente) y arranca. Render inyecta PORT.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/seed.js && exec node dist/server.js"]
