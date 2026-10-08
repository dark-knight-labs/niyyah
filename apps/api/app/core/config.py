from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://niyyah:niyyah@localhost:5432/niyyah"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    cors_origins: str = "http://localhost:3000"

    vault_gitlab_url: str = "ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git"
    vault_github_url: str = "https://github.com/dark-knight-labs/xarvis.git"
    vault_sync_secret: str = "change-me-in-production"
    vault_workdir: str = "/app/data/vault-sync"
    # Who may write to the vault from the app (registration is open, so this must be explicit). Empty = nobody.
    vault_write_emails: str = ""
    vault_git_name: str = "Niyyah"
    vault_git_email: str = "niyyah@burak.bd"
    vault_tz: str = "Asia/Dhaka"
    # Where planner data lives: "vault" = notes in the git checkout (today's behaviour), "db" = this database.
    storage_backend: str = "vault"

    # Google Calendar (adding events from the Overview page). Both empty = the feature is off.
    google_client_id: str = ""
    google_client_secret: str = ""
    # OAuth redirect URI = {api_public_url}/api/v1/vault/calendar/google/callback; the browser returns to web_public_url.
    api_public_url: str = "https://niyyah-api.alamin.rocks"
    web_public_url: str = "https://niyyah.alamin.rocks"

    # For tests, swap asyncpg → aiosqlite
    test_database_url: str = "sqlite+aiosqlite:///./test.db"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
