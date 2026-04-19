from __future__ import annotations

import json
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError

from app.utils.cache import ResponseCache


class _FakeEntry:
    def __init__(self) -> None:
        self.payload = ""
        self.created_at: datetime | None = None


class _FakeSession:
    def __init__(self) -> None:
        self.entry = _FakeEntry()
        self.scalar_calls = 0
        self.commit_calls = 0
        self.rollback_calls = 0
        self.inserted = None

    def scalar(self, _statement) -> _FakeEntry | None:
        self.scalar_calls += 1
        if self.scalar_calls == 1:
            return None
        return self.entry

    def add(self, entry) -> None:
        self.inserted = entry

    def commit(self) -> None:
        self.commit_calls += 1
        if self.commit_calls == 1:
            raise IntegrityError("insert", {}, Exception("duplicate key"))

    def rollback(self) -> None:
        self.rollback_calls += 1


class _FakeSessionContext:
    def __init__(self, session: _FakeSession) -> None:
        self.session = session

    def __enter__(self) -> _FakeSession:
        return self.session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class ResponseCacheTests(unittest.TestCase):
    def test_set_updates_existing_row_after_insert_race(self) -> None:
        session = _FakeSession()
        settings = SimpleNamespace(cache_namespace="python-fastapi-test", cache_ttl_minutes=30)

        with patch("app.utils.cache.get_settings", return_value=settings):
            cache = ResponseCache()

        with patch("app.utils.cache.get_session", return_value=_FakeSessionContext(session)):
            cache.set("daily-analysis:2026-04-18", {"status": "fresh"})

        self.assertEqual(session.commit_calls, 2)
        self.assertEqual(session.rollback_calls, 1)
        self.assertEqual(session.entry.payload, json.dumps({"status": "fresh"}))
        self.assertIsInstance(session.entry.created_at, datetime)

