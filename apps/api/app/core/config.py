from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://niyyah:niyyah@localhost:5432/niyyah"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    cors_origins: str = "http://localhost:3000"

    vault_gitlab_url: str = "ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git"
    vault_github_url: str = "https://github.com/dark-knight-labs/xarvis.git"
    vault_sync_secret: str = "change-me-in-production"
    vault_workdir: str = "/app/data/vault-sync"

    # For tests, swap asyncpg → aiosqlite
    test_database_url: str = "sqlite+aiosqlite:///./test.db"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
