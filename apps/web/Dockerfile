# Needs BASE_IMAGE (web-base:<hash>, built from Dockerfile.base). CI passes it; locally:
#   docker build -f Dockerfile.base -t web-base . && docker build --build-arg BASE_IMAGE=web-base .
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS builder
COPY . .
ARG NEXT_PUBLIC_API_URL=https://niyyah-api.alamin.rocks
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
