ARG VP_IMAGE=ghcr.io/voidzero-dev/vite-plus:0.3.1
ARG GO_IMAGE=mirror.gcr.io/library/golang:1.26.8-alpine
ARG RUNTIME_IMAGE=mirror.gcr.io/library/alpine:3.22
FROM ${VP_IMAGE} AS web
WORKDIR /home/vp/app
COPY --chown=vp:vp package.json bun.lock bunfig.toml .node-version ./
COPY --chown=vp:vp apps/web/package.json ./apps/web/package.json
RUN vp install --frozen-lockfile
COPY --chown=vp:vp vite.config.ts ./
COPY --chown=vp:vp apps/web/ ./apps/web/
RUN vp run build

FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
COPY --from=web /home/vp/app/apps/web/dist/ ./webdist/
RUN go test -tags webembed -run 'TestWeb|TestEmbedded' ./... && CGO_ENABLED=0 go build -tags webembed -trimpath -o /pr-desk .

FROM ${RUNTIME_IMAGE}
RUN apk add --no-cache ca-certificates wget
COPY --from=build /pr-desk /pr-desk
COPY apps/api/docs /docs
EXPOSE 8080
USER 10001:10001
ENTRYPOINT ["/pr-desk"]
