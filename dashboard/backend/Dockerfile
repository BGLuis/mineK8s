# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:26-alpine AS production

WORKDIR /app

# Copia apenas os artefatos necessários para rodar
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Usuário não-root por segurança
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs
USER nestjs

EXPOSE 3000 3001

# Inicia o join-server (porta 3001) em background e o NestJS principal (porta 3000) em foreground
CMD ["sh", "-c", "node dist/src/join-server.js & node dist/src/main"]
