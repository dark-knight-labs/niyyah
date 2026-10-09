.PHONY: dev up down test test-api migrate migration

# Development
dev:
	docker compose up -d db
	@echo "Postgres is on 127.0.0.1:5432. Start the apps separately (APP_ENV=development allows the placeholder secrets):"
	@echo "  cd apps/api && APP_ENV=development STORAGE_BACKEND=db alembic upgrade head && APP_ENV=development STORAGE_BACKEND=db uvicorn app.main:app --reload"
	@echo "  cd apps/web && npm run dev"

up:
	docker compose up --build

down:
	docker compose down

# Testing
test: test-api

test-api:
	cd apps/api && python3 -m pytest tests/ -v

# Database
migrate:
	cd apps/api && alembic upgrade head

migration:
	cd apps/api && alembic revision --autogenerate -m "$(msg)"
