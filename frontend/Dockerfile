FROM oven/bun:1.3.4-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json ./frontend/package.json
RUN bun install --frozen-lockfile
COPY frontend ./frontend
RUN bun run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
