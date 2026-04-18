from __future__ import annotations

import re


def normalize_name(value: str) -> str:
    lowered = value.lower().strip()
    return re.sub(r"[^a-z0-9]+", " ", lowered).strip()


def build_player_lookup_key(player_id: str | int | None, name: str, team: str | None = None) -> str:
    if player_id not in (None, ""):
        return str(player_id)
    suffix = f":{team}" if team else ""
    return f"{normalize_name(name)}{suffix}"
