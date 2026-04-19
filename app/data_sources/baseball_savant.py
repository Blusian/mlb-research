from __future__ import annotations

import csv
from io import StringIO

from app.core.config import get_settings
from app.data_sources.http_client import RateLimitedHttpClient
from app.utils.math_utils import parse_decimal, parse_float


class BaseballSavantSource:
    PITCH_EVENT_FIELDS = (
        "pitch_type",
        "release_speed",
        "release_spin",
        "spin_axis",
        "pfx_x",
        "pfx_z",
        "plate_x",
        "plate_z",
        "balls",
        "strikes",
        "description",
        "events",
        "launch_speed",
        "launch_angle",
        "estimated_ba_using_speedangle",
        "estimated_woba_using_speedangle",
        "release_extension",
        "stand",
        "p_throws",
        "delta_run_exp",
    )

    def __init__(self, client: RateLimitedHttpClient | None = None) -> None:
        self.settings = get_settings()
        self.client = client or RateLimitedHttpClient()

    def get_hitter_profiles(self, date: str) -> dict[str, dict[str, dict[str, float]]]:
        season = date[:4]
        date_from = f"{season}-{self.settings.statcast_start_month_day}"
        overall = self._fetch_leaderboard(season, date_from, date, player_type="batter")
        vs_right = self._fetch_leaderboard(season, date_from, date, player_type="batter", pitcher_throws="R")
        vs_left = self._fetch_leaderboard(season, date_from, date, player_type="batter", pitcher_throws="L")
        return self._merge_profiles(overall, vs_right, vs_left)

    def get_pitcher_profiles(self, date: str) -> dict[str, dict[str, dict[str, float]]]:
        season = date[:4]
        date_from = f"{season}-{self.settings.statcast_start_month_day}"
        overall = self._fetch_leaderboard(season, date_from, date, player_type="pitcher")
        vs_right = self._fetch_leaderboard(season, date_from, date, player_type="pitcher", batter_stands="R")
        vs_left = self._fetch_leaderboard(season, date_from, date, player_type="pitcher", batter_stands="L")
        return self._merge_profiles(overall, vs_right, vs_left)

    def get_bat_tracking_profiles(self, season: str) -> dict[str, dict[str, float]]:
        params = {
            "csv": "true",
            "gameType": "Regular",
            "minGroupSwings": "1",
            "minSwings": "1",
            "seasonStart": season,
            "seasonEnd": season,
            "type": "batter",
        }
        url = f"{self.settings.baseball_savant_base_url}/leaderboard/bat-tracking?{self._encode(params)}"
        rows = self._read_csv_rows(url)
        if not rows:
            return {}
        profiles: dict[str, dict[str, float]] = {}
        for row in rows:
            player_id = str(row.get("id", "")).split(".")[0]
            if not player_id:
                continue
            profiles[player_id] = {
                "averageBatSpeed": parse_float(row.get("avg_bat_speed"), 72),
                "hardSwingRate": parse_float(row.get("hard_swing_rate"), 18),
                "squaredUpRate": parse_float(row.get("squared_up_per_bat_contact"), 28),
                "blastRate": parse_float(row.get("blast_per_bat_contact"), 8),
                "swingLength": parse_float(row.get("swing_length"), 7.2),
                "batTrackingRunValue": parse_float(row.get("batter_run_value"), 0),
                "whiffRate": parse_float(row.get("whiff_per_swing"), 28),
                "contactRate": 100 - parse_float(row.get("whiff_per_swing"), 28),
                "zoneContactRate": min(100, 108 - parse_float(row.get("whiff_per_swing"), 28)),
            }
        return profiles

    def get_pitch_events(
        self,
        date_from: str,
        date_to: str,
        *,
        season: str | None = None,
        pitcher_id: str | None = None,
        batter_id: str | None = None,
        game_pk: str | None = None,
    ) -> list[dict[str, str | float | None]]:
        inferred_season = season or date_from[:4]
        params = {
            "all": "true",
            "csv": "true",
            "game_date_gt": date_from,
            "game_date_lt": date_to,
            "hfGT": "R|",
            "hfSea": f"{inferred_season}|",
            "min_pas": "0",
            "min_pitches": "0",
            "min_results": "0",
            "player_type": "pitcher",
            "sort_col": "game_date",
            "sort_order": "asc",
        }
        if pitcher_id:
            params["pitchers_lookup[]"] = pitcher_id
        if batter_id:
            params["batters_lookup[]"] = batter_id
        if game_pk:
            params["game_pk"] = game_pk
        url = f"{self.settings.baseball_savant_base_url}/statcast_search/csv?{self._encode(params)}"
        return [self._normalize_pitch_event_row(row) for row in self._read_csv_rows(url)]

    def _fetch_leaderboard(
        self,
        season: str,
        date_from: str,
        date_to: str,
        *,
        player_type: str,
        pitcher_throws: str | None = None,
        batter_stands: str | None = None,
    ) -> dict[str, dict[str, float]]:
        params = {
            "all": "true",
            "game_date_gt": date_from,
            "game_date_lt": date_to,
            "group_by": "name",
            "hfGT": "R|",
            "hfSea": f"{season}|",
            "min_pas": "0",
            "min_pitches": "0",
            "min_results": "0",
            "player_type": player_type,
            "sort_col": "pitches",
            "sort_order": "desc",
        }
        if pitcher_throws:
            params["pitcher_throws"] = pitcher_throws
        if batter_stands:
            params["batter_stands"] = batter_stands
        url = f"{self.settings.baseball_savant_base_url}/statcast_search/csv?{self._encode(params)}"
        rows = self._read_csv_rows(url)
        if not rows:
            return {}
        results: dict[str, dict[str, float]] = {}
        for row in rows:
            player_id = str(row.get("player_id", "")).split(".")[0]
            if not player_id:
                continue
            swings = parse_float(row.get("swings"), 0)
            takes = parse_float(row.get("takes"), 0)
            chase_rate = (swings / (swings + takes) * 100) if (swings + takes) > 0 else 28
            launch_angle = parse_float(row.get("launch_angle"), 12)
            hard_hit = parse_float(row.get("hardhit_percent"), 38)
            results[player_id] = {
                "average": parse_decimal(row.get("ba"), 0.245),
                "slugging": parse_decimal(row.get("slg"), 0.405),
                "obp": parse_decimal(row.get("obp"), 0.320),
                "ops": parse_decimal(row.get("obp"), 0.320) + parse_decimal(row.get("slg"), 0.405),
                "iso": parse_decimal(row.get("iso"), 0.165),
                "woba": parse_decimal(row.get("woba"), 0.315),
                "xwoba": parse_decimal(row.get("xwoba"), 0.320),
                "xba": parse_decimal(row.get("xba"), 0.245),
                "xslg": parse_decimal(row.get("xslg"), 0.405),
                "hardHitRate": hard_hit,
                "barrelRate": parse_float(row.get("barrels_per_bbe_percent"), 7),
                "averageExitVelocity": parse_float(row.get("launch_speed"), 89),
                "launchAngle": launch_angle,
                "strikeoutRate": parse_float(row.get("k_percent"), 22),
                "walkRate": parse_float(row.get("bb_percent"), 8),
                "whiffRate": parse_float(row.get("swing_miss_percent"), 28),
                "contactRate": 100 - parse_float(row.get("swing_miss_percent"), 28),
                "zoneContactRate": min(100, 105 - parse_float(row.get("swing_miss_percent"), 28)),
                "chaseRate": chase_rate,
                "pullRate": 42.0,
                "flyBallRate": max(18.0, min(58.0, 32 + (launch_angle - 12) * 1.6)),
                "groundBallRate": max(18.0, min(62.0, 46 - (launch_angle - 12) * 1.8)),
                "lineDriveRate": max(12.0, min(32.0, 22 + (hard_hit - 38) * 0.08)),
                "plateAppearances": parse_float(row.get("pa"), 0),
                "homeRuns": parse_float(row.get("hrs"), 0),
                "swingLength": parse_float(row.get("swing_length"), 7.2),
                "attackAngle": parse_float(row.get("attack_angle"), 10),
                "pitchVelocitySeen": parse_float(row.get("velocity"), 92),
            }
        return results

    @staticmethod
    def _merge_profiles(
        overall: dict[str, dict[str, float]],
        vs_right: dict[str, dict[str, float]],
        vs_left: dict[str, dict[str, float]],
    ) -> dict[str, dict[str, dict[str, float]]]:
        ids = set(overall) | set(vs_right) | set(vs_left)
        return {
            player_id: {
                "overall": overall.get(player_id, {}),
                "vsRight": vs_right.get(player_id, overall.get(player_id, {})),
                "vsLeft": vs_left.get(player_id, overall.get(player_id, {})),
            }
            for player_id in ids
        }

    @staticmethod
    def _encode(params: dict[str, str]) -> str:
        from urllib.parse import urlencode

        return urlencode(params)

    def _read_csv_rows(self, url: str) -> list[dict[str, str]]:
        text = self.client.get_text(url)
        reader = csv.DictReader(StringIO(text.lstrip("\ufeff")))
        rows: list[dict[str, str]] = []
        for row in reader:
            cleaned = {
                str(key).strip(): (value.strip() if isinstance(value, str) else value)
                for key, value in row.items()
                if key is not None
            }
            if any(value for value in cleaned.values()):
                rows.append(cleaned)
        return rows

    @classmethod
    def _normalize_pitch_event_row(cls, row: dict[str, str]) -> dict[str, str | float | None]:
        normalized: dict[str, str | float | None] = {}
        for field in cls.PITCH_EVENT_FIELDS:
            value = row.get(field)
            if field in {"pitch_type", "description", "events", "stand", "p_throws"}:
                normalized[field] = value or None
            else:
                normalized[field] = parse_float(value, None) if value not in {None, ""} else None
        normalized["game_pk"] = row.get("game_pk")
        normalized["game_date"] = row.get("game_date")
        normalized["pitch_number"] = parse_float(row.get("pitch_number"), None) if row.get("pitch_number") else None
        normalized["at_bat_number"] = parse_float(row.get("at_bat_number"), None) if row.get("at_bat_number") else None
        normalized["pitcher"] = row.get("pitcher")
        normalized["batter"] = row.get("batter")
        return normalized
