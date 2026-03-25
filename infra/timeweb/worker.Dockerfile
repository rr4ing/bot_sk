FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages ./packages
COPY infra/prisma ./infra/prisma
RUN npm install
RUN npx prisma generate --schema infra/prisma/schema.prisma
RUN npm run build --workspace @builderbot/config
RUN npm run build --workspace @builderbot/worker

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages ./packages
CMD ["node", "apps/worker/dist/main.js"]
