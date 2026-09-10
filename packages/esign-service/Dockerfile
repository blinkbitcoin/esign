# The esign service as a container. Build from the REPO ROOT (the workspace
# lockfile and the Node package are inputs):
#
#   docker build -f packages/esign-service/Dockerfile -t esign-service .        (make docker-build)
#   docker run --rm -p 4100:4100 --env-file packages/esign-service/.env esign-service
#   docker run --rm --env-file packages/esign-service/.env esign-service node dist/node.js migrate
#
# One image, both capabilities: the mint is always on, and DATABASE_URL adds
# envelope orchestration (the migrate command above applies its schema).
#
# Three stages: install everything → build the two workspaces the service
# needs → a production image with only their runtime dependencies.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# npm ci needs every workspace manifest the lockfile knows about
COPY package.json package-lock.json ./
COPY packages/esign-service/package.json packages/esign-service/
COPY packages/esign-core/package.json packages/esign-core/
COPY packages/esign-node/package.json packages/esign-node/
COPY packages/esign-react/package.json packages/esign-react/
COPY packages/esign-react-native/package.json packages/esign-react-native/
COPY examples/react-demo/package.json examples/react-demo/
COPY examples/react-native-demo/package.json examples/react-native-demo/
COPY examples/mint-only-demo/package.json examples/mint-only-demo/
COPY examples/serverless-handler-demo/package.json examples/serverless-handler-demo/
COPY scripts/package.json scripts/
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
COPY packages/esign-node packages/esign-node
COPY packages/esign-service packages/esign-service
RUN npm run build -w packages/esign-node && npm run build -w packages/esign-service

FROM node:${NODE_VERSION}-alpine AS runtime
# NODE_ENV is Node's own switch (dependency resolution, framework defaults).
# ESIGN_ENV is this service's: the image defaults to the production posture,
# so a container refuses demo DocuSign hosts and the mock provider, keeps
# GraphQL introspection off, and will not mint a client's own prefill.
# ESIGN_ALLOW_DEMO=true / ESIGN_ALLOW_CLIENT_PREFILL=true opt back out.
ENV NODE_ENV=production
ENV ESIGN_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/esign-service/package.json packages/esign-service/
COPY packages/esign-core/package.json packages/esign-core/
COPY packages/esign-node/package.json packages/esign-node/
COPY packages/esign-react/package.json packages/esign-react/
COPY packages/esign-react-native/package.json packages/esign-react-native/
COPY examples/react-demo/package.json examples/react-demo/
COPY examples/react-native-demo/package.json examples/react-native-demo/
COPY examples/mint-only-demo/package.json examples/mint-only-demo/
COPY examples/serverless-handler-demo/package.json examples/serverless-handler-demo/
COPY scripts/package.json scripts/
# Runtime dependencies of the service and the Node package only
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w packages/esign-service -w packages/esign-node \
  && npm cache clean --force
COPY --from=build /app/packages/esign-node/dist packages/esign-node/dist
COPY --from=build /app/packages/esign-service/dist packages/esign-service/dist

USER node
WORKDIR /app/packages/esign-service
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-4100}/health || exit 1
CMD ["node", "dist/node.js"]
