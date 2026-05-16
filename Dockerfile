FROM nginx:1.31.0-alpine

# Remove default config to avoid conflicts
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom production nginx configuration
COPY nginx.conf /etc/nginx/conf.d/

# Copy static assets with correct ownership
COPY --chown=nginx:nginx web/ /usr/share/nginx/html/

# Create required directories and set permissions for non-root nginx user
RUN mkdir -p /var/cache/nginx /var/log/nginx && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /usr/share/nginx/html && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid && \
    chown -R nginx:nginx /etc/nginx/conf.d

# Run as non-root user for security
USER nginx

EXPOSE 8080

# Healthcheck to verify nginx is serving requests
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1
