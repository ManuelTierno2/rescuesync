#!/bin/sh

npm run db:generate
npx prisma migrate deploy
npm run db:seed

npm run dev
