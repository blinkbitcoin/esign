# The mint-only demo as a container: an existing GraphQL API host shape,
# built and smoked in CI (E2E / Docker) to prove the shape actually
# deploys - it is not published or shipped anywhere. Build from the REPO
# ROOT (the workspace lockfile and @blinkbitcoin/esign-node are inputs):
#
#   docker build -f examples/mint-only-demo/Dockerfile -t esign-mint-only-demo .   (make docker-build-mint-only)
#   docker run --rm -p 4100:4100 -e ESIGN_PROVIDER=mock esign-mint-only-demo
#
# Three stages: install everything → build the two workspaces this demo
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
COPY examples/mint-only-demo examples/mint-only-demo
RUN npm run build -w packages/esign-node && npm run build -w examples/mint-only-demo

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
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
# Runtime dependencies of the demo and the Node package only
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w examples/mint-only-demo -w packages/esign-node \
  && npm cache clean --force
COPY --from=build /app/packages/esign-node/dist packages/esign-node/dist
COPY --from=build /app/examples/mint-only-demo/dist examples/mint-only-demo/dist

USER node
WORKDIR /app/examples/mint-only-demo
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-4100}/health || exit 1
CMD ["node", "dist/index.js"]
