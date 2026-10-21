#!/bin/sh
# Arranque de desarrollo (target dev del Dockerfile): genera el cliente, migra, siembra y recarga con tsx watch.
set -e

npm run db:generate
npx prisma migrate deploy
npm run db:seed

exec npm run dev
