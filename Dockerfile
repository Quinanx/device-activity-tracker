# Backend Dockerfile with React frontend
FROM node:20-alpine

WORKDIR /app

# Install git and build dependencies
RUN apk add --no-cache git python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy client package files
COPY client/package*.json ./client/

# Install dependencies for backend
RUN npm install

# Install and build React client
WORKDIR /app/client
RUN npm install && npm run build

# Back to root
WORKDIR /app

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Expose port (can be overridden by environment variable)
ARG PORT=3001
ENV PORT=${PORT}
EXPOSE ${PORT}

# Create directory for WhatsApp auth state
RUN mkdir -p /app/auth_info_baileys

CMD ["node", "dist/server.js"]
