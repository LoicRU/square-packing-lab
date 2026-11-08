# Parallel Packing Lab — serveur persistant (Node >= 22.5, aucune dépendance npm à l'exécution)
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PPL_HOST=0.0.0.0 PPL_PORT=8787 PPL_DB=/data/ppl.sqlite PPL_STATIC=/app/dist
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY package.json ./
VOLUME /data
EXPOSE 8787
# PPL_TOKEN est OBLIGATOIRE (le serveur refuse de démarrer sans, hors localhost)
CMD ["node", "server/index.js"]
