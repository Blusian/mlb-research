from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from database.models import CacheEntry
from database.session import get_session


class ResponseCache:
    def __init__(self) -> None:
        self.settings = get_settings()

    def get(self, key: str) -> dict | None:
        with get_session() as session:
            entry = session.scalar(
                select(CacheEntry).where(
                    CacheEntry.namespace == self.settings.cache_namespace,
                    CacheEntry.key == key,
                )
            )
            if not entry:
                return None
            expired_at = datetime.utcnow() - timedelta(minutes=self.settings.cache_ttl_minutes)
            if entry.created_at < expired_at:
                session.execute(
                    delete(CacheEntry).where(
                        CacheEntry.namespace == self.settings.cache_namespace,
                        CacheEntry.key == key,
                    )
                )
                session.commit()
                return None
            return json.loads(entry.payload)

    def set(self, key: str, payload: dict) -> None:
        serialized = json.dumps(payload)
        now = datetime.utcnow()
        with get_session() as session:
            entry = session.scalar(
                select(CacheEntry).where(
                    CacheEntry.namespace == self.settings.cache_namespace,
                    CacheEntry.key == key,
                )
            )
            if entry:
                entry.payload = serialized
                entry.created_at = now
            else:
                session.add(
                    CacheEntry(
                        namespace=self.settings.cache_namespace,
                        key=key,
                        payload=serialized,
                        created_at=now,
                    )
                )
            try:
                session.commit()
            except IntegrityError:
                # Another request won the insert race; update the existing row instead.
                session.rollback()
                entry = session.scalar(
                    select(CacheEntry).where(
                        CacheEntry.namespace == self.settings.cache_namespace,
                        CacheEntry.key == key,
                    )
                )
                if entry:
                    entry.payload = serialized
                    entry.created_at = now
                    session.commit()
                else:
                    raise

    def delete(self, key: str) -> None:
        with get_session() as session:
            session.execute(
                delete(CacheEntry).where(
                    CacheEntry.namespace == self.settings.cache_namespace,
                    CacheEntry.key == key,
                )
            )
            session.commit()
