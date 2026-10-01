FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
ENV VITE_DECK_PORTAL=true
RUN npm run build && npm run typecheck:server

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY src/types ./src/types
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate && exec npm run api:start"]
