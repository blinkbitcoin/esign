# The esign service as a container. Build from the REPO ROOT (the workspace
# lockfile and the server package are inputs):
#
#   docker build -f examples/full-service-demo/Dockerfile -t esign-api .        (make docker-build)
#   docker run --rm -p 4000:4000 --env-file examples/full-service-demo/.env esign-api
#   docker run --rm --env-file examples/full-service-demo/.env esign-api node dist/migrate.js   # once per database
#
# Three stages: install everything → build the two workspaces the service
# needs → a production image with only their runtime dependencies.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# npm ci needs every workspace manifest the lockfile knows about
COPY package.json package-lock.json ./
COPY examples/full-service-demo/package.json examples/full-service-demo/
COPY packages/esign-core/package.json packages/esign-core/
COPY packages/esign-server/package.json packages/esign-server/
COPY packages/esign-react/package.json packages/esign-react/
COPY packages/esign-react-native/package.json packages/esign-react-native/
COPY examples/react-demo/package.json examples/react-demo/
COPY examples/react-native-demo/package.json examples/react-native-demo/
COPY examples/mint-only-demo/package.json examples/mint-only-demo/
COPY examples/serverless-handler-demo/package.json examples/serverless-handler-demo/
COPY scripts/package.json scripts/
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
COPY packages/esign-server packages/esign-server
COPY examples/full-service-demo examples/full-service-demo
RUN npm run build -w packages/esign-server && npm run build -w examples/full-service-demo

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY examples/full-service-demo/package.json examples/full-service-demo/
COPY packages/esign-core/package.json packages/esign-core/
COPY packages/esign-server/package.json packages/esign-server/
COPY packages/esign-react/package.json packages/esign-react/
COPY packages/esign-react-native/package.json packages/esign-react-native/
COPY examples/react-demo/package.json examples/react-demo/
COPY examples/react-native-demo/package.json examples/react-native-demo/
COPY examples/mint-only-demo/package.json examples/mint-only-demo/
COPY examples/serverless-handler-demo/package.json examples/serverless-handler-demo/
COPY scripts/package.json scripts/
# Runtime dependencies of the service and the server package only
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w examples/full-service-demo -w packages/esign-server \
  && npm cache clean --force
COPY --from=build /app/packages/esign-server/dist packages/esign-server/dist
COPY --from=build /app/examples/full-service-demo/dist examples/full-service-demo/dist

USER node
WORKDIR /app/examples/full-service-demo
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}/health || exit 1
CMD ["node", "dist/index.js"]
