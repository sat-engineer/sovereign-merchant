# Multi-stage build for Sovereign Merchant
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY core/package*.json ./core/
COPY web/package*.json ./web/

# Install dependencies
RUN cd core && npm ci
RUN cd web && npm ci

# Copy source code
COPY core/ ./core/
COPY web/ ./web/

# Build the backend
RUN cd core && npm run build

# Build the frontend
RUN cd web && npm run build

# Production stage
FROM node:18-alpine AS production

# Create app directory
WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=base /app/core/dist ./core/dist
COPY --from=base /app/core/package*.json ./core/
COPY --from=base /app/web/dist ./web/dist

# Install only production dependencies for core
RUN cd core && npm ci --only=production

# Create data directory for SQLite
RUN mkdir -p /data

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/config.db

# Start the application
CMD ["node", "core/dist/index.js"]
