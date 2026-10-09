from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import check_secrets, settings
from app.api.v1 import auth, personas, schedule, principles, tracker, settings as settings_router, dashboard, vault, tokens, export, import_data

@asynccontextmanager
async def lifespan(_: FastAPI):
    problems = check_secrets(settings)
    if problems:
        raise RuntimeError("Refusing to start with unsafe configuration:\n- " + "\n- ".join(problems))
    yield


app = FastAPI(title="Niyyah API", version="1.0.0", docs_url="/docs", redoc_url="/redoc", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(personas.router, prefix="/api/v1")
app.include_router(schedule.router, prefix="/api/v1")
app.include_router(principles.router, prefix="/api/v1")
app.include_router(tracker.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(vault.router, prefix="/api/v1")
app.include_router(tokens.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(import_data.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}
