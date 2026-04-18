from __future__ import annotations

from app.data_sources.park_factors import resolve_park_factors


class ParkFactorService:
    def get_factors(self, home_team_abbreviation: str, batter_hand: str) -> dict[str, float]:
        return resolve_park_factors(home_team_abbreviation, batter_hand)
