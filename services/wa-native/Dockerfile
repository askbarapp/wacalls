# ── Stage 1: Build React client ──────────────────────────────────
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: Build Go server ────────────────────────────────────
FROM golang:1.26-bookworm AS server
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go mod tidy
COPY --from=client /app/client/dist ./client/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /wacalls ./cmd/server

# ── Stage 3: Final minimal image ────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /data/recordings
COPY --from=server /wacalls /usr/local/bin/wacalls
COPY --from=server /app/client/dist ./client/dist
VOLUME /data/recordings
EXPOSE 8080
ENTRYPOINT ["wacalls", "-addr", ":8080", "-static", "/app/client/dist"]
