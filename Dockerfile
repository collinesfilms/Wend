# syntax=docker/dockerfile:1

# --- web interface -------------------------------------------------------------
# Built on the machine doing the building, never under emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- binary ---------------------------------------------------------------
# No cgo: the SQLite driver is pure Go, so cross-compiling for a NAS's arm64
# needs no C toolchain and stays native.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/embed.go ./web/
COPY --from=web /app/web/dist ./web/dist
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/collinesgo ./cmd/collinesgo

# --- final image ----------------------------------------------------------
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget \
 && addgroup -g 10001 -S app \
 && adduser -u 10001 -S -G app app \
 && mkdir -p /data && chown app:app /data
COPY --from=build /out/collinesgo /usr/local/bin/collinesgo
USER app
VOLUME /data
EXPOSE 8080
ENV CG_LISTEN=:8080 CG_DB_PATH=/data/collinesgo.db
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/collinesgo"]
