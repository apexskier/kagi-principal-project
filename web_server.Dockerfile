ARG VERSION=local

FROM node:22-alpine AS base

# deps contains all (including development) dependencies
# built as a separate stage to cache if unchanged
FROM base AS deps
WORKDIR /app

COPY . .
RUN npm ci

# proddeps are only production dependencies for the web_server
# built as a separate stage to cache if unchanged
FROM base AS proddeps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY . .
RUN npm ci -w web_server --omit dev

# builder builds the web_server using deps
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build -w web_server

# runner is the final artifact, containing minimal code
FROM base AS runner
ARG VERSION
WORKDIR /app

COPY --from=builder /app/web_server/package.json .
COPY --from=builder /app/web_server/bundle ./bundle
COPY --from=proddeps /app/node_modules ./node_modules

ENV VERSION=${VERSION}

CMD node ./${SYSTEM_NAME}
