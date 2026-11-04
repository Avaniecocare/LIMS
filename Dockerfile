# One image, two processes: `node dist/main.js api` or `node dist/main.js worker`.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# tsconfig.json must be present for generate: the client's import style follows it.
COPY package*.json prisma.config.ts tsconfig.json nest-cli.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate
COPY src ./src
RUN npx nest build && npm rebuild argon2 && npm prune --omit=dev --ignore-scripts

# Playwright's image carries Chromium and its system libraries for PDF rendering.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/package.json ./
RUN npm install --no-save --ignore-scripts prisma@7.10 >/dev/null
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js", "api"]
