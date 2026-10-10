from pydantic_settings import BaseSettings


PLACEHOLDER_PREFIXES = ("change-me", "changeme")


class Settings(BaseSettings):
    # "production" refuses to start with a placeholder or short secret; set APP_ENV=development for local work.
    app_env: str = "production"
    # "open" lets anyone create an account; "closed" turns the register endpoint off (create accounts another way).
    registration: str = "open"
    # How many reverse proxies you control sit in front of the API. 0 = none: the connection's address is the client.
    # With N, the client is the Nth entry from the right of X-Forwarded-For (entries to its left are client-supplied and ignored).
    trusted_proxy_hops: int = 0
    database_url: str = "postgresql+asyncpg://niyyah:niyyah@localhost:5432/niyyah"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    cors_origins: str = "http://localhost:3000"

    # The timezone that decides what "today" is on every page (a per-user timezone is not wired in yet).
    app_timezone: str = "UTC"

    # Google Calendar (adding events from the Overview page). Both empty = the feature is off.
    google_client_id: str = ""
    google_client_secret: str = ""
    # OAuth redirect URI = {api_public_url}/api/v1/vault/calendar/google/callback; the browser returns to web_public_url.
    api_public_url: str = "http://localhost:8000"
    web_public_url: str = "http://localhost:3000"

    # Comma-separated "module:Class" plugins to load, in addition to installed packages that register a "niyyah.plugins" entry point.
    plugins: str = ""

    # For tests, swap asyncpg → aiosqlite
    test_database_url: str = "sqlite+aiosqlite:///./test.db"

    model_config = {"env_file": ".env", "extra": "ignore"}


def _weak(value: str) -> bool:
    return len(value) < 32 or value.lower().startswith(PLACEHOLDER_PREFIXES)


def check_secrets(cfg: Settings) -> list[str]:
    """Problems with the configured secrets. Empty in development; in production any problem stops the app from starting."""
    if cfg.app_env != "production":
        return []
    problems = []
    if _weak(cfg.secret_key):
        problems.append("SECRET_KEY is a placeholder or shorter than 32 characters (generate one: python -c \"import secrets; print(secrets.token_urlsafe(48))\")")
    if cfg.trusted_proxy_hops < 0:
        problems.append("TRUSTED_PROXY_HOPS cannot be negative")
    if cfg.registration not in ("open", "closed"):
        problems.append("REGISTRATION must be 'open' or 'closed'")
    return problems


settings = Settings()
