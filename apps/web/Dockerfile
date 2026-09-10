ARG BUN_IMAGE=mirror.gcr.io/oven/bun:1.3.4-alpine
ARG NGINX_IMAGE=mirror.gcr.io/library/nginx:1.27-alpine
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile
COPY apps/web ./apps/web
RUN bun run build
FROM ${NGINX_IMAGE}
ENV API_UPSTREAM=api:8080
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
