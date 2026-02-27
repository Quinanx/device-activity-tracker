# Backend Dockerfile with React frontend
FROM node:20-alpine

WORKDIR /app

# Install git and build dependencies
RUN apk add --no-cache git python3 make g++

# Copy all package files first
COPY package*.json ./
COPY client/package*.json ./client/

# Install root dependencies
RUN npm install

# Install and build React client
WORKDIR /app/client
RUN npm install && npm run build

# Return to root and copy source
WORKDIR /app
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Verify build structure
RUN echo "--- Build structure ---" && \
    ls -la dist/ && \
    echo "--- Client build ---" && \
    ls -la client/build/ | head -10

# Expose port
ARG PORT=3001
ENV PORT=${PORT}
EXPOSE ${PORT}

# Create directory for WhatsApp auth state
RUN mkdir -p /app/auth_info_baileys

# Start server
CMD ["node", "dist/server.js"]
