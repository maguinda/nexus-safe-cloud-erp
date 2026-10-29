# Imagen de notifications: compila en una etapa y deja solo lo necesario en la final.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp PORT=4105
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY healthcheck.js ./
COPY prisma ./prisma
USER node
EXPOSE 4105
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 CMD ["node", "healthcheck.js"]
# Migra la base y arranca (este servicio no tiene datos de demostración: los avisos nacen de los eventos).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
