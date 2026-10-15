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

USER rescuesync

EXPOSE 3001
CMD ["npm", "run", "dev"]
