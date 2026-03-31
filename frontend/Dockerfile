# syntax=docker/dockerfile:1

# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Using node:20-alpine for consistency with the other services.
# This stage has no npm work to do for a single-file static frontend, but
# keeps the pattern uniform and leaves room to add a build step later.
FROM node:20-alpine AS builder

WORKDIR /app

COPY index.html ./

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM nginx:alpine AS production

# Remove the default nginx config and welcome page
RUN rm -f /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*

# Copy static asset from builder
COPY --from=builder /app/index.html /usr/share/nginx/html/index.html

# Copy configs — main conf sets pid /tmp/nginx.pid for non-root operation
COPY nginx.main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# nginx:alpine ships with a non-root 'nginx' user (uid 101).
# Port 8080 (>=1024) and pid /tmp/nginx.pid allow fully rootless operation.
RUN chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html

USER nginx

CMD ["nginx", "-g", "daemon off;"]
