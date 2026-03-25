FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps/admin ./apps/admin
COPY packages ./packages
RUN npm install
RUN npm run build --workspace @builderbot/ui
RUN npm run build --workspace @builderbot/admin

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/admin/.next ./apps/admin/.next
COPY --from=builder /app/apps/admin/package.json ./apps/admin/package.json
COPY --from=builder /app/apps/admin/public ./apps/admin/public
COPY --from=builder /app/packages ./packages
CMD ["npm", "run", "start", "--workspace", "@builderbot/admin"]
