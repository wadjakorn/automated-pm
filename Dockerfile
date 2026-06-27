FROM node:22-bookworm-slim
WORKDIR /app

# Native build deps for better-sqlite3 (fallback if no arm64 prebuilt is used)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV PM_DB_PATH=/app/data/pm.db
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
