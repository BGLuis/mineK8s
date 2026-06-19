FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Usaremos um usuário não-root por segurança
USER node

CMD ["node", "index.js"]
