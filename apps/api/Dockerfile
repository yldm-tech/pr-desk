ARG BUN_IMAGE=mirror.gcr.io/oven/bun:1.3.4-alpine
ARG GO_IMAGE=mirror.gcr.io/library/golang:1.25.5-alpine
ARG RUNTIME_IMAGE=mirror.gcr.io/library/alpine:3.22
FROM ${BUN_IMAGE} AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile
COPY apps/web/ ./apps/web/
RUN bun run build

FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
COPY --from=web /app/apps/web/dist/ ./webdist/
RUN go test -tags webembed -run 'TestWeb|TestEmbedded' ./... && CGO_ENABLED=0 go build -tags webembed -trimpath -o /pr-desk .

FROM ${RUNTIME_IMAGE}
RUN apk add --no-cache ca-certificates wget
COPY --from=build /pr-desk /pr-desk
COPY apps/api/docs /docs
EXPOSE 8080
ENTRYPOINT ["/pr-desk"]
