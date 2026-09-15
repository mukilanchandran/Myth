# Build from the repository root:
#   docker build -f deploy/Dockerfile -t myth .

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first so this layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so config is baked in here, not at runtime.
ARG VITE_APP_NAME="Myth"
ARG VITE_APP_PASSWORD="mukilx"
ARG VITE_AI_ENDPOINT="https://api.llm7.io/v1"
ARG VITE_AI_MODEL=""
ENV VITE_APP_NAME=$VITE_APP_NAME \
    VITE_APP_PASSWORD=$VITE_APP_PASSWORD \
    VITE_AI_ENDPOINT=$VITE_AI_ENDPOINT \
    VITE_AI_MODEL=$VITE_AI_MODEL

RUN npm run build

# ---------- serve ----------
FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
