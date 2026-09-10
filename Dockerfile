# syntax=docker/dockerfile:1.7

# ─── Stage 1 · build the bundle ─────────────────────────────────────────────────────────────
# Node 24, and that is not a preference. @angular/cli/src/utilities/node-version.js pins
# SUPPORTED_NODE_VERSIONS = '^22.22.3 || ^24.15.0 || >=26.0.0' and bin/ng.js sets exit code 3 on
# anything outside it — Node 20 CANNOT build this app, whatever start-ui.sh's stale floor says.
#
# Debian slim rather than alpine: @angular/build (esbuild), tailwindcss 4 (lightningcss) and
# rollup all ship per-libc native binaries, and glibc is the path they are exercised on daily.
FROM node:24-bookworm-slim AS build
WORKDIR /app

ENV CI=true \
    NG_CLI_ANALYTICS=false \
    npm_config_fund=false \
    npm_config_audit=false

# Manifests first, so editing a component does not re-resolve the dependency graph.
COPY package.json package-lock.json ./

# npm ci, not npm install: it installs exactly the locked tree and fails loudly if the lockfile
# and package.json disagree, which is the same promise scripts/check-pins.mjs makes about direct
# dependencies, extended to transitive ones.
RUN --mount=type=cache,target=/root/.npm npm ci

# .postcssrc.json is LOAD-BEARING. Tailwind is wired through PostCSS and nothing else. Omit it and
# the build SUCCEEDS, then ships a completely unstyled application with no error anywhere.
COPY .postcssrc.json angular.json tsconfig.json tsconfig.app.json tsconfig.spec.json ./
COPY scripts ./scripts
COPY public ./public
COPY src ./src

# Optional gate. `verify` is repo-local and safe here.
# `verify:all` MUST NEVER run in a container: scripts/sync-openapi.mjs hardcodes an absolute path
# into the backend repo on a developer's Mac, which exists in no image.
ARG RUN_VERIFY=false
RUN if [ "$RUN_VERIFY" = "true" ]; then npm run verify; fi

# `npm run build` = merge-i18n && ng build. angular.json's defaultConfiguration is production, so
# this is already the optimised build with outputHashing:"all". No outputPath is declared, so the
# static root is dist/foshol-doctor-ui/browser/.
RUN npm run build

# Source maps come from the development configuration only. Deleted defensively: a future config
# change must not quietly start shipping them to a farmer on a metered connection.
RUN find dist/foshol-doctor-ui/browser -name '*.map' -delete

# This deployment proxies the API on its own origin, so the bundle asks for root-relative paths and
# nginx decides who serves /api. A constant, not the .env value — which is exactly why this image
# needs no entrypoint script to render it, and can therefore run read-only.
RUN printf 'window.__FOSHOL_RUNTIME__ = {"apiBaseUrl":""};\n' \
      > dist/foshol-doctor-ui/browser/env.js

# Pre-compress once at build time so gzip_static can serve the .gz without per-request CPU. The
# JS bundles and the ~180 KB of i18n catalogues are the whole win.
RUN find dist/foshol-doctor-ui/browser \
      \( -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.svg' -o -name '*.html' \) \
      -size +1k -exec gzip -9 -k {} \;

# ─── Stage 2 · serve ────────────────────────────────────────────────────────────────────────
# The unprivileged variant listens on 8080 as uid/gid 101 and writes its pid under /tmp, which is
# what lets `read_only: true` and `cap_drop: ALL` work without a custom entrypoint or a capability.
FROM nginxinc/nginx-unprivileged:1.29-alpine

# The stock default.conf also listens on 8080 and would collide with ours as a second default
# server on the same port.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER 101

COPY --chown=101:101 docker/nginx/templates/ /etc/nginx/templates/
COPY --chown=101:101 docker/nginx/snippets/  /etc/nginx/snippets/
COPY --chown=101:101 --chmod=755 docker/nginx/entrypoint.d/ /docker-entrypoint.d/
COPY --from=build --chown=101:101 /app/dist/foshol-doctor-ui/browser/ /usr/share/nginx/html/

EXPOSE 8080
STOPSIGNAL SIGQUIT
