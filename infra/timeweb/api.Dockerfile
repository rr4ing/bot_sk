FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.base.json jest.preset.js ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY infra/prisma ./infra/prisma
RUN npm install
RUN npx prisma generate --schema infra/prisma/schema.prisma
RUN npm run build --workspace @builderbot/config
RUN npm run build --workspace @builderbot/domain
RUN npm run build --workspace @builderbot/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/infra/prisma ./infra/prisma
CMD ["node", "apps/api/dist/main.js"]
