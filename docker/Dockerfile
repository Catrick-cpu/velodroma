FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY src/shared/package.json src/shared/package.json
COPY src/server/package.json src/server/package.json
COPY src/client/web/package.json src/client/web/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/client/web/dist ./src/client/web/dist
EXPOSE 8787
# node:sqlite is still flagged on Node 24 — keep the flag in sync with
# src/server/package.json
CMD ["node", "--experimental-sqlite", "src/server/dist/index.js"]
