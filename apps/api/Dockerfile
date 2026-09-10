ARG GO_IMAGE=mirror.gcr.io/library/golang:1.25.5-alpine
ARG RUNTIME_IMAGE=mirror.gcr.io/library/alpine:3.22
FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /api .
FROM ${RUNTIME_IMAGE}
RUN apk add --no-cache ca-certificates wget
COPY --from=build /api /api
COPY apps/api/docs /docs
EXPOSE 8080
ENTRYPOINT ["/api"]
