from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class CacheEntry(Base):
    __tablename__ = "cache_entries"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    namespace: Mapped[str] = mapped_column(String(80), index=True)
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class SelectedProp(Base):
    __tablename__ = "selected_props"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: uuid4().hex)
    date: Mapped[str] = mapped_column(String(10), index=True)
    game_id: Mapped[str] = mapped_column(String(32), index=True)
    player_id: Mapped[str] = mapped_column(String(32), index=True)
    player_name: Mapped[str] = mapped_column(String(120))
    team: Mapped[str] = mapped_column(String(12), index=True)
    opponent: Mapped[str] = mapped_column(String(12), index=True)
    matchup_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    prop_type: Mapped[str] = mapped_column(String(40), index=True)
    selection_side: Mapped[str | None] = mapped_column(String(16), nullable=True, default="over")
    selection_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    line_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    projection_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(24), nullable=True)
    sportsbook: Mapped[str | None] = mapped_column(String(48), nullable=True)
    explanation_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="tracked")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
