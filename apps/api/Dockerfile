FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /api .
FROM alpine:3.22
RUN apk add --no-cache wget
COPY --from=build /api /api
COPY docs /docs
EXPOSE 8080
ENTRYPOINT ["/api"]
