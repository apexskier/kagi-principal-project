ARG VERSION=local
ARG WORKSPACE
# unfortunately we can't dynamically calculate this in a dockerfile (could with npm query)
ARG WORKSPACE_DIR

FROM node:22-alpine AS base

# deps contains all (including development) dependencies
# built as a separate stage to cache if unchanged
FROM base AS deps
WORKDIR /app

COPY . .
RUN npm ci

# proddeps are only production dependencies for the given workspace
# built as a separate stage to cache if unchanged
FROM base AS proddeps
ARG WORKSPACE
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY . .
RUN npm ci -w ${WORKSPACE} --omit dev

# builder builds the workspace using deps
FROM base AS builder
ARG WORKSPACE
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build -w ${WORKSPACE}

# runner is the final artifact, containing minimal code
FROM base AS runner
ARG VERSION
ARG WORKSPACE_DIR
WORKDIR /app

COPY --from=builder /app/${WORKSPACE_DIR}/package.json .
COPY --from=builder /app/${WORKSPACE_DIR}/bundle ./bundle
COPY --from=proddeps /app/node_modules ./node_modules

ENV VERSION=${VERSION}

CMD node ./${SYSTEM_NAME}
