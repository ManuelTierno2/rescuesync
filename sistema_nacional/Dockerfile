FROM node:24-alpine

ARG UID=10001
ARG GID=10001

RUN addgroup -g ${GID} rescuesync && \
    adduser -D -u ${UID} -G rescuesync rescuesync

RUN mkdir -p /app && chown rescuesync:rescuesync /app

WORKDIR /app

RUN mkdir -p /app/node_modules && chown -R rescuesync:rescuesync /app/node_modules

COPY package.json package-lock.json ./
RUN npm ci

COPY --chown=rescuesync:rescuesync . .

RUN chmod +x /app/entrypoint.sh

USER rescuesync


ENTRYPOINT ["sh", "/app/entrypoint.sh"]
