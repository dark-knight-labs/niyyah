# Needs BASE_IMAGE (web-base:<hash>, built from Dockerfile.base). CI passes it; locally:
#   docker build -f Dockerfile.base -t web-base . && docker build --build-arg BASE_IMAGE=web-base .
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS builder
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_OPERATOR_NAME=
ARG NEXT_PUBLIC_OPERATOR_CONTACT=
ARG NEXT_PUBLIC_SITE_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_OPERATOR_NAME=$NEXT_PUBLIC_OPERATOR_NAME NEXT_PUBLIC_OPERATOR_CONTACT=$NEXT_PUBLIC_OPERATOR_CONTACT NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
