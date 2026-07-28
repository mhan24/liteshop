FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install --registry=https://registry.npmmirror.com
COPY frontend/ ./
RUN npm run build

FROM golang:1.22-bookworm AS build
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /internal/web/spa internal/web/spa
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/shop ./cmd/shop

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H -u 10001 shop
WORKDIR /app
COPY --from=build /out/shop /app/shop
RUN mkdir -p /app/data && chown -R shop:shop /app
USER shop
EXPOSE 8080
ENV SHOP_LISTEN_ADDR=:8080 SHOP_DATABASE_PATH=/app/data/shop.db
CMD ["/app/shop"]
