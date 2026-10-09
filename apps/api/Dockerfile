# Needs BASE_IMAGE (api-base:<hash>, built from Dockerfile.base). CI passes it; locally:
#   docker build -f Dockerfile.base -t api-base . && docker build --build-arg BASE_IMAGE=api-base .
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY . .

ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
