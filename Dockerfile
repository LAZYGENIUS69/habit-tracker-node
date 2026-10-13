# Pinned exact minor Debian slim image: reproducible runtime, avoids surprise toolchain updates.
FROM node:20.20.2-bookworm-slim

# Fixed application directory for consistent execution and path resolution.
WORKDIR /app

# Copy dependency manifests first so Docker caches dependency layers independently of application code.
COPY package.json package-lock.json ./

# Install only production dependencies strictly from lockfile to minimize image size and attack surface.
RUN npm ci --omit=dev

# Copy application source owned by unprivileged user so runtime processes do not hold root write access.
COPY --chown=node:node . .

# Explicit production runtime flag for runtime optimizations.
ENV NODE_ENV=production

# Drop root privileges: node user (uid 1000) exists by default in official Node images.
USER node

# Expose standard contract port (metadata documentation for orchestrators).
EXPOSE 8080

# Exec-form CMD ensures node runs as PID 1 and receives POSIX signals directly.
CMD ["node", "src/server.js"]
