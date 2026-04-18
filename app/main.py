from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.analysis import router as analysis_router
from app.api.routes.health import router as health_router
from app.api.routes.player_details import router as player_details_router
from app.api.routes.selected_props import router as selected_props_router
from app.core.config import get_settings
from database.session import init_db


settings = get_settings()
app = FastAPI(title="MLB Matchup Analytics API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(analysis_router)
app.include_router(player_details_router)
app.include_router(selected_props_router)


@app.on_event("startup")
def startup() -> None:
    init_db()
