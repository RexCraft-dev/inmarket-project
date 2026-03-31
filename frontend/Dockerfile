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

# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# nginx:alpine ships with a non-root 'nginx' user (uid 101).
# The default entrypoint starts the master process as root to bind ports and
# then drops workers to the nginx user; to run entirely non-root we need
# to bind a port >=1024 (8080 qualifies) and adjust the pid path.
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html

USER nginx

CMD ["nginx", "-g", "daemon off;"]
