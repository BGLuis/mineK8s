# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++
RUN npm config set ignore-scripts false
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:26-alpine AS production

WORKDIR /app

# Copia apenas os artefatos necessários para rodar
COPY package*.json ./
RUN npm config set ignore-scripts false
RUN apk add --no-cache python3 make g++ curl && npm ci --omit=dev && apk del python3 make g++
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    chmod +x kubectl && mv kubectl /usr/local/bin/

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dev.db ./dev.db
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Usuário não-root por segurança
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs
RUN chown -R nestjs:nestjs /app
USER nestjs

EXPOSE 3000 3001

# Inicia o join-server (porta 3001) em background e o NestJS principal (porta 3000) em foreground
CMD ["sh", "-c", "node dist/src/join-server.js & node dist/src/main"]
