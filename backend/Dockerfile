FROM node:20-alpine

WORKDIR /app

# Install production dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
