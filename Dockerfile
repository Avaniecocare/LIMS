# One image, two processes: `node dist/main.js api` or `node dist/main.js worker`.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# tsconfig.json must be present for generate: the client's import style follows it.
COPY package*.json prisma.config.ts tsconfig.json nest-cli.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate
COPY src ./src
# prune keeps the locked prisma CLI (it is an optional peer of @prisma/client, so npm marks it
# devOptional). The runtime needs it for `prisma migrate deploy`; fail the build if that changes,
# rather than installing an unlocked copy later.
RUN npx nest build && npm rebuild argon2 && npm prune --omit=dev --ignore-scripts \
  && test -f node_modules/prisma/package.json && test -e node_modules/.bin/prisma

# The same base as the build, with only what PDF rendering needs. Playwright's own image also carries Firefox and WebKit:
# several gigabytes, and other people's vulnerabilities to answer for.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
# No npm either: nothing is installed at run time, and it brings old copies of libraries. Its own layer, from the locked version alone, so a code change does not download the browser again.
COPY --from=build /app/node_modules/playwright /opt/playwright/node_modules/playwright
COPY --from=build /app/node_modules/playwright-core /opt/playwright/node_modules/playwright-core
RUN apt-get update && apt-get upgrade -y \
  && node /opt/playwright/node_modules/playwright/cli.js install --with-deps --only-shell chromium \
  && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-core fonts-freefont-ttf \
  && rm -rf /opt/playwright /var/lib/apt/lists/* /root/.cache \
  && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn* \
  && groupadd -g 1001 lims && useradd -u 1001 -g 1001 -m lims
# A vendor's public key (PEM). With it, the image needs a licence; without it, no licence is asked for.
ARG LICENCE_PUBLIC_KEY=""
RUN if [ -n "$LICENCE_PUBLIC_KEY" ]; then printf '%s\n' "$LICENCE_PUBLIC_KEY" > /app/licence.pub && chmod 444 /app/licence.pub; fi
# Shown to administrators on the status page.
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/package.json /app/package-lock.json ./
# Who makes it; what it is and which commit come from the build.
LABEL org.opencontainers.image.vendor="Taravik" org.opencontainers.image.url="https://taravik.com"
# By number: Kubernetes checks runAsNonRoot against a number.
USER 1001:1001
# 9464 is the operations port: never publish it.
EXPOSE 3000 9464
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js", "api"]
