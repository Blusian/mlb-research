from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

from .base import Base


settings = get_settings()
engine_kwargs = {"future": True}
if settings.is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_pre_ping"] = True
engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate_selected_props_table()


def _migrate_selected_props_table() -> None:
    inspector = inspect(engine)
    if "selected_props" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("selected_props")}
    if "selection_side" in column_names:
        return

    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE selected_props ADD COLUMN selection_side VARCHAR(16) DEFAULT 'over'")
        )


def get_session() -> Session:
    return SessionLocal()
