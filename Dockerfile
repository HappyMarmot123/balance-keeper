FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_NAVER_MAPS_KEY_ID
ARG VITE_NAVER_MAP_STYLE_ID
RUN npm run validate

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS api

ENV NODE_ENV=production \
    BK_API_HOST=0.0.0.0 \
    BK_API_PORT=8787 \
    BK_API_ORIGIN=http://127.0.0.1:8787

WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=build --chown=1000:1000 /workspace/dist-server/ ./dist-server/

USER 1000:1000
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist-server/server.mjs"]

FROM nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46 AS web

COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=101:101 /workspace/dist/ /usr/share/nginx/html/

USER 101:101
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["curl", "--fail", "--silent", "--show-error", "http://127.0.0.1:8080/healthz"]

ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
