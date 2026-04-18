from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from app.core.config import get_settings
from app.data_sources.mlb_stats_api import MlbStatsApiSource


def _parse_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in {None, ""}:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_int(value: Any, default: int = 0) -> int:
    return int(round(_parse_float(value, default)))


def _plate_appearances(batting: dict[str, Any]) -> int:
    if batting.get("plateAppearances") not in {None, ""}:
        return _parse_int(batting.get("plateAppearances"))
    return sum(
        _parse_int(batting.get(field))
        for field in (
            "atBats",
            "baseOnBalls",
            "intentionalWalks",
            "hitByPitch",
            "sacFlies",
            "sacBunts",
            "catchersInterference",
        )
    )


def _total_bases(batting: dict[str, Any]) -> int:
    total_bases = batting.get("totalBases")
    if total_bases not in {None, ""}:
        return _parse_int(total_bases)
    singles = max(_parse_int(batting.get("hits")) - _parse_int(batting.get("doubles")) - _parse_int(batting.get("triples")) - _parse_int(batting.get("homeRuns")), 0)
    return (
        singles
        + _parse_int(batting.get("doubles")) * 2
        + _parse_int(batting.get("triples")) * 3
        + _parse_int(batting.get("homeRuns")) * 4
    )


def _normalize_status(feed: dict[str, Any] | None) -> tuple[str, bool]:
    status = (((feed or {}).get("gameData") or {}).get("status") or {})
    detailed_state = str(status.get("detailedState") or "")
    abstract_state = str(status.get("abstractGameState") or "")
    normalized = f"{detailed_state} {abstract_state}".lower()

    if "postpon" in normalized:
        return "Postponed", False
    if "suspend" in normalized:
        return "Suspended", False
    if "delay" in normalized:
        return "Delayed", False
    if abstract_state.lower() == "final" or any(token in normalized for token in ("final", "game over", "completed early")):
        return "Final", False
    if abstract_state.lower() == "live" or any(token in normalized for token in ("in progress", "warmup", "manager challenge")):
        return "Live", True
    return "Pregame", False


class LiveGameService:
    def __init__(self, source: MlbStatsApiSource | None = None, cache_ttl_seconds: int = 20) -> None:
        self.settings = get_settings()
        self.source = source or MlbStatsApiSource()
        self.cache_ttl_seconds = cache_ttl_seconds
        self.live_feed_timeout_seconds = max(self.settings.live_game_feed_timeout_ms / 1000, 0.5)
        self.max_refresh_workers = max(self.settings.live_game_feed_max_workers, 1)
        self._feed_cache: dict[str, tuple[datetime, dict[str, Any] | None]] = {}
        self._feed_cache_lock = Lock()

    def get_live_games(self, game_ids: list[str]) -> dict[str, dict[str, Any]]:
        snapshots: dict[str, dict[str, Any]] = {}
        fetched_at = datetime.now(timezone.utc)
        ordered_game_ids = sorted({str(game_id) for game_id in game_ids if str(game_id).strip()})
        cached_feeds: dict[str, dict[str, Any] | None] = {}
        refresh_targets: list[tuple[str, dict[str, Any] | None]] = []

        for game_id in ordered_game_ids:
            cached_feed = self._read_cached_feed(game_id)
            if cached_feed and cached_feed[0] >= fetched_at - timedelta(seconds=self.cache_ttl_seconds):
                cached_feeds[game_id] = cached_feed[1]
                continue
            refresh_targets.append((game_id, cached_feed[1] if cached_feed else None))

        if refresh_targets:
            max_workers = min(self.max_refresh_workers, len(refresh_targets))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_map = {
                    executor.submit(self._refresh_feed, game_id, fetched_at, stale_feed): game_id
                    for game_id, stale_feed in refresh_targets
                }
                for future in as_completed(future_map):
                    cached_feeds[future_map[future]] = future.result()

        for game_id in ordered_game_ids:
            snapshots[game_id] = self._normalize_feed(game_id, cached_feeds.get(game_id), fetched_at)
        return snapshots

    def _read_cached_feed(self, game_id: str) -> tuple[datetime, dict[str, Any] | None] | None:
        with self._feed_cache_lock:
            return self._feed_cache.get(game_id)

    def _refresh_feed(
        self,
        game_id: str,
        fetched_at: datetime,
        stale_feed: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        feed = self.source.get_game_feed(int(game_id), timeout_seconds=self.live_feed_timeout_seconds)
        if feed is not None:
            with self._feed_cache_lock:
                self._feed_cache[game_id] = (fetched_at, feed)
            return feed
        return stale_feed

    def _normalize_feed(
        self,
        game_id: str,
        feed: dict[str, Any] | None,
        fetched_at: datetime,
    ) -> dict[str, Any]:
        game_data = (feed or {}).get("gameData") or {}
        live_data = (feed or {}).get("liveData") or {}
        linescore = live_data.get("linescore") or {}
        status, is_live = _normalize_status(feed)
        away_team = (game_data.get("teams") or {}).get("away") or {}
        home_team = (game_data.get("teams") or {}).get("home") or {}
        away_runs = _parse_int(((linescore.get("teams") or {}).get("away") or {}).get("runs"))
        home_runs = _parse_int(((linescore.get("teams") or {}).get("home") or {}).get("runs"))
        score_label = f"{away_team.get('abbreviation', 'AWY')} {away_runs} - {home_runs} {home_team.get('abbreviation', 'HME')}"
        players: dict[str, dict[str, Any]] = {}
        for side_key, team_info in (("away", away_team), ("home", home_team)):
            team_boxscore = ((live_data.get("boxscore") or {}).get("teams") or {}).get(side_key) or {}
            for player in (team_boxscore.get("players") or {}).values():
                person = player.get("person") or {}
                player_id = str(person.get("id") or "")
                if not player_id:
                    continue
                batting = (player.get("stats") or {}).get("batting") or {}
                pitching = (player.get("stats") or {}).get("pitching") or {}
                hits = _parse_int(batting.get("hits"))
                doubles = _parse_int(batting.get("doubles"))
                triples = _parse_int(batting.get("triples"))
                player_home_runs = _parse_int(batting.get("homeRuns"))
                singles = max(hits - doubles - triples - player_home_runs, 0)
                players[player_id] = {
                    "playerId": player_id,
                    "playerName": person.get("fullName") or "Unknown",
                    "team": team_info.get("abbreviation") or side_key.upper(),
                    "batting": {
                        "hits": hits,
                        "atBats": _parse_int(batting.get("atBats")),
                        "plateAppearances": _plate_appearances(batting),
                        "runs": _parse_int(batting.get("runs")),
                        "rbi": _parse_int(batting.get("rbi")),
                        "walks": _parse_int(batting.get("baseOnBalls")),
                        "strikeouts": _parse_int(batting.get("strikeOuts")),
                        "homeRuns": player_home_runs,
                        "singles": singles,
                        "doubles": doubles,
                        "triples": triples,
                        "totalBases": _total_bases(batting),
                    },
                    "pitching": {
                        "strikeouts": _parse_int(pitching.get("strikeOuts")),
                        "walks": _parse_int(pitching.get("baseOnBalls")),
                        "battersFaced": _parse_int(pitching.get("battersFaced")),
                        "pitchCount": _parse_int(
                            pitching.get("numberOfPitches")
                            or pitching.get("pitchesThrown")
                            or pitching.get("totalPitches")
                        ),
                        "inningsPitched": str(pitching.get("inningsPitched") or "0.0"),
                    },
                }
        return {
            "gameId": game_id,
            "gameStatus": status,
            "isLive": is_live,
            "inningState": str(linescore.get("inningHalf") or linescore.get("currentInningHalf") or "") or None,
            "inningNumber": _parse_int(linescore.get("currentInning")) or None,
            "outs": _parse_int(linescore.get("outs")) if linescore.get("outs") is not None else None,
            "awayRuns": away_runs,
            "homeRuns": home_runs,
            "totalRuns": away_runs + home_runs,
            "scoreLabel": score_label,
            "gameStartTime": ((game_data.get("datetime") or {}).get("dateTime")) or None,
            "matchupLabel": f"{away_team.get('abbreviation', 'AWY')} at {home_team.get('abbreviation', 'HME')}",
            "players": players,
            "lastUpdatedAt": fetched_at.isoformat().replace("+00:00", "Z"),
        }
