from __future__ import annotations

import time
from typing import Any

import httpx

from app.core.config import get_settings


class RateLimitedHttpClient:
    def __init__(self, min_interval_seconds: float = 0.12) -> None:
        settings = get_settings()
        self.timeout = settings.timeout_seconds
        self.min_interval_seconds = min_interval_seconds
        self._last_request_at = 0.0
        self._client = httpx.Client(timeout=self.timeout, follow_redirects=True)

    def _sleep_if_needed(self) -> None:
        gap = time.monotonic() - self._last_request_at
        if gap < self.min_interval_seconds:
            time.sleep(self.min_interval_seconds - gap)

    def get_json(self, url: str, timeout_seconds: float | None = None) -> dict[str, Any]:
        response = self.get(url, timeout_seconds=timeout_seconds)
        return response.json()

    def get_text(self, url: str, timeout_seconds: float | None = None) -> str:
        response = self.get(url, timeout_seconds=timeout_seconds)
        return response.text

    def get(self, url: str, timeout_seconds: float | None = None) -> httpx.Response:
        self._sleep_if_needed()
        response = self._client.get(url, timeout=timeout_seconds or self.timeout)
        self._last_request_at = time.monotonic()
        response.raise_for_status()
        return response

    def close(self) -> None:
        self._client.close()
