from __future__ import annotations

import copy
from datetime import datetime, timezone

from app.models.schemas import PlayerDetailResponse
from app.services.analysis_service import DailyAnalysisService
from app.services.matchup_engine import _season_stat, _to_pitch_arsenal
from app.services.player_stats_service import PlayerStatsService
from app.utils.cache import ResponseCache
from app.utils.math_utils import parse_decimal, parse_float, parse_innings_pitched


def _stat(key: str, label: str, value: str | float | int | bool | None) -> dict:
    return {"key": key, "label": label, "value": value}


def _format_number(value: float | int | None, digits: int = 1) -> str:
    if value is None:
        return "--"
    return f"{float(value):.{digits}f}"


def _format_percent(value: float | int | None, digits: int = 1) -> str:
    if value is None:
        return "--"
    return f"{float(value):.{digits}f}%"


def _game_log_splits(person: dict | None) -> list[dict]:
    for stat_block in (person or {}).get("stats") or []:
        if ((stat_block.get("type") or {}).get("displayName")) == "gameLog":
            return stat_block.get("splits") or []
    return []


def _opponent_label(split: dict) -> str:
    opponent = split.get("opponent") or split.get("team") or {}
    label = ""
    if isinstance(opponent, dict):
        label = (
            opponent.get("abbreviation")
            or opponent.get("teamName")
            or opponent.get("name")
            or opponent.get("locationName")
            or ""
        )
    elif opponent:
        label = str(opponent)

    is_home = split.get("isHome")
    if label and is_home is True:
        return f"vs {label}"
    if label and is_home is False:
        return f"@ {label}"
    return label or "Recent game"


def _find_player(analysis: dict, role: str, player_id: str, game_id: str | None) -> dict | None:
    key = "hitters" if role == "hitter" else "pitchers"
    players = analysis["rankings"][key]
    return next(
        (
            player
            for player in players
            if player["playerId"] == player_id
            and (not game_id or player["gameId"] == game_id)
        ),
        None,
    )


def _find_game(analysis: dict, game_id: str | None) -> dict | None:
    if not game_id:
        return None
    return next((game for game in analysis["games"] if game["gameId"] == game_id), None)


def _find_prop(entries: list[dict], player_id: str, game_id: str) -> dict | None:
    return next(
        (
            entry
            for entry in entries
            if entry["entityId"] == player_id and entry["gameId"] == game_id
        ),
        None,
    )


def _build_hitter_overview_stats(hitter: dict, season_stat: dict) -> list[dict]:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    return [
        _stat("overallHitScore", "Overall hit score", _format_number(scores["overallHitScore"], 1)),
        _stat("homeRunUpsideScore", "HR upside", _format_number(scores["homeRunUpsideScore"], 1)),
        _stat(
            "totalHitPotentialScore",
            "Total hit potential",
            _format_number(scores.get("totalHitPotentialScore"), 1),
        ),
        _stat("plateAppearances", "Season PA", int(parse_float(season_stat.get("plateAppearances"), 0))),
        _stat("homeRuns", "Season HR", int(parse_float(season_stat.get("homeRuns"), 0))),
        _stat("averageVsHandedness", "AVG vs hand", _format_number(metrics["averageVsHandedness"], 3)),
        _stat("obpVsHandedness", "OBP vs hand", _format_number(metrics["obpVsHandedness"], 3)),
        _stat("sluggingVsHandedness", "SLG vs hand", _format_number(metrics["sluggingVsHandedness"], 3)),
        _stat("opsVsHandedness", "OPS vs hand", _format_number(metrics["opsVsHandedness"], 3)),
        _stat("xwobaVsHandedness", "xwOBA vs hand", _format_number(metrics["xwobaVsHandedness"], 3)),
        _stat("xbaVsHandedness", "xBA vs hand", _format_number(metrics["xbaVsHandedness"], 3)),
        _stat("xslgVsHandedness", "xSLG vs hand", _format_number(metrics["xslgVsHandedness"], 3)),
        _stat("hardHitRate", "Hard-hit rate", _format_percent(metrics["hardHitRate"], 1)),
        _stat("barrelRate", "Barrel rate", _format_percent(metrics["barrelRate"], 1)),
        _stat("averageBatSpeed", "Average bat speed", f"{_format_number(metrics['averageBatSpeed'], 1)} mph"),
        _stat("strikeoutRate", "Strikeout rate", _format_percent(metrics["strikeoutRate"], 1)),
        _stat("walkRate", "Walk rate", _format_percent(metrics["walkRate"], 1)),
        _stat("recentForm", "Recent form", _format_number(metrics["recentForm"], 1)),
    ]


def _build_hitter_matchup_stats(hitter: dict, analysis: dict) -> list[dict]:
    metrics = hitter["metrics"]
    game_id = hitter["gameId"]
    player_id = hitter["playerId"]
    home_run_prop = _find_prop(analysis["props"]["hitterHomeRuns"], player_id, game_id)
    hits_prop = _find_prop(analysis["props"]["hitterHits"], player_id, game_id)
    runs_prop = _find_prop(analysis["props"]["hitterRuns"], player_id, game_id)
    rbis_prop = _find_prop(analysis["props"]["hitterRbis"], player_id, game_id)
    total_bases_prop = _find_prop(analysis["props"]["hitterTotalBases"], player_id, game_id)
    walks_prop = _find_prop(analysis["props"]["hitterWalks"], player_id, game_id)

    return [
        _stat("lineupSpot", "Lineup spot", metrics["lineupSpot"]),
        _stat("lineupStatus", "Lineup status", "Confirmed" if metrics["lineupConfirmed"] else "Projected"),
        _stat("opposingPitcherHand", "Pitcher hand", hitter["opposingPitcherHand"]),
        _stat(
            "homeRunModel",
            "HR model",
            _format_percent((home_run_prop or {}).get("blendedProbability", 0) * 100, 1)
            if home_run_prop
            else "--",
        ),
        _stat(
            "hitsProjection",
            "Hits projection",
            _format_number((hits_prop or {}).get("projectionValue"), 2),
        ),
        _stat(
            "runsProjection",
            "Runs projection",
            _format_number((runs_prop or {}).get("projectionValue"), 2),
        ),
        _stat(
            "rbiProjection",
            "RBI projection",
            _format_number((rbis_prop or {}).get("projectionValue"), 2),
        ),
        _stat(
            "totalBasesProjection",
            "TB projection",
            _format_number((total_bases_prop or {}).get("projectionValue"), 2),
        ),
        _stat(
            "walksProjection",
            "Walks projection",
            _format_number((walks_prop or {}).get("projectionValue"), 2),
        ),
        _stat("batterVsPitcherPA", "BvP plate appearances", int(metrics["batterVsPitcherPlateAppearances"])),
        _stat("batterVsPitcherOps", "BvP OPS", _format_number(metrics["batterVsPitcherOps"], 3)),
        _stat("batterVsPitcherHomeRuns", "BvP HR", int(metrics["batterVsPitcherHomeRuns"])),
        _stat("batterVsPitcherScore", "BvP score", _format_number(metrics["batterVsPitcherScore"], 1)),
        _stat("pitchMixMatchupScore", "Pitch mix fit", _format_number(metrics["pitchMixMatchupScore"], 1)),
        _stat("primaryPitchType", "Primary pitch", metrics["primaryPitchTypeDescription"]),
        _stat("primaryPitchUsage", "Primary pitch usage", _format_percent(metrics["primaryPitchUsage"], 1)),
        _stat("parkFactorVsHandedness", "Park vs hand", _format_number(metrics["parkFactorVsHandedness"], 0)),
        _stat(
            "homeRunParkFactorVsHandedness",
            "HR park vs hand",
            _format_number(metrics["homeRunParkFactorVsHandedness"], 0),
        ),
        _stat(
            "opponentPitcherPowerAllowed",
            "Opp pitcher power allowed",
            _format_number(metrics["opponentPitcherPowerAllowed"], 1),
        ),
    ]


def _build_pitcher_overview_stats(pitcher: dict, season_stat: dict) -> list[dict]:
    metrics = pitcher["metrics"]
    scores = pitcher["scores"]
    innings_pitched = parse_innings_pitched(season_stat.get("inningsPitched"))
    starts = parse_float(season_stat.get("gamesStarted"), metrics.get("gamesStarted", 0))
    return [
        _stat("overallPitcherScore", "Overall pitch score", _format_number(scores["overallPitcherScore"], 1)),
        _stat("strikeoutUpsideScore", "K upside", _format_number(scores["strikeoutUpsideScore"], 1)),
        _stat("safetyScore", "Safety", _format_number(scores["safetyScore"], 1)),
        _stat("blowupRiskScore", "Blowup risk", _format_number(scores["blowupRiskScore"], 1)),
        _stat("era", "ERA", _format_number(metrics.get("era"), 2)),
        _stat("whip", "WHIP", _format_number(metrics.get("whip"), 2)),
        _stat("fip", "FIP", _format_number(metrics.get("fip"), 2)),
        _stat("xFip", "xFIP", _format_number(metrics.get("xFip"), 2)),
        _stat("starts", "Starts", int(starts)),
        _stat("inningsPitched", "Season IP", _format_number(innings_pitched, 1)),
        _stat("battersFaced", "Batters faced", int(parse_float(metrics.get("battersFaced"), 0))),
        _stat("strikeoutRate", "Strikeout rate", _format_percent(metrics["strikeoutRate"], 1)),
        _stat("walkRate", "Walk rate", _format_percent(metrics["walkRate"], 1)),
        _stat("swingingStrikeRate", "Swinging-strike rate", _format_percent(metrics["swingingStrikeRate"], 1)),
        _stat("hardHitAllowed", "Hard-hit allowed", _format_percent(metrics["hardHitAllowed"], 1)),
        _stat("barrelAllowed", "Barrel allowed", _format_percent(metrics["barrelAllowed"], 1)),
        _stat("pitchVelocity", "Average velocity", f"{_format_number(metrics.get('pitchVelocity'), 1)} mph"),
        _stat("recentForm", "Recent form", _format_number(metrics["recentForm"], 1)),
    ]


def _build_pitcher_matchup_stats(pitcher: dict, analysis: dict) -> list[dict]:
    metrics = pitcher["metrics"]
    strikeout_prop = _find_prop(
        analysis["props"]["pitcherStrikeouts"],
        pitcher["playerId"],
        pitcher["gameId"],
    )
    projection_layer = (strikeout_prop or {}).get("metrics", {}).get("projectionLayer", {})
    return [
        _stat(
            "projectedStrikeouts",
            "Projected Ks",
            _format_number(
                (strikeout_prop or {}).get("meanKs", metrics.get("projectedStrikeoutsVsOpponent")),
                1,
            ),
        ),
        _stat(
            "medianKs",
            "Median Ks",
            _format_number((strikeout_prop or {}).get("medianKs", metrics.get("medianStrikeoutsVsOpponent")), 1),
        ),
        _stat(
            "over35Probability",
            "Over 3.5",
            _format_percent((strikeout_prop or {}).get("over3_5Probability", 0) * 100, 1)
            if strikeout_prop
            else "--",
        ),
        _stat(
            "over45Probability",
            "Over 4.5",
            _format_percent((strikeout_prop or {}).get("over4_5Probability", 0) * 100, 1)
            if strikeout_prop
            else "--",
        ),
        _stat("inningsProjection", "IP projection", _format_number(metrics["inningsProjection"], 1)),
        _stat(
            "lineupVsPitcherHandKRate",
            "Lineup K vs hand",
            _format_percent(
                metrics.get(
                    "lineupVsPitcherHandKRate",
                    metrics.get("lineupStrikeoutRateVsHand", metrics["opponentStrikeoutRate"]),
                ),
                1,
            ),
        ),
        _stat("matchupAdjustedKRate", "Matchup-adjusted K", _format_percent(metrics.get("matchupAdjustedKRate"), 1)),
        _stat("pitchMixAdvantageScore", "Pitch mix edge", _format_number(metrics.get("pitchMixAdvantageScore"), 1)),
        _stat(
            "lineupConfidence",
            "Lineup confidence",
            _format_number(
                metrics.get("opponentLineupConfidenceScore", projection_layer.get("lineupConfidence")),
                1,
            ),
        ),
        _stat(
            "trackedLineup",
            "Tracked lineup",
            f"{int(parse_float(metrics.get('opponentConfirmedHitterCount'), 0))}/{int(parse_float(metrics.get('opponentLineupCount'), 0))}",
        ),
        _stat("strikeoutParkFactor", "K park factor", _format_number(metrics["strikeoutParkFactor"], 0)),
        _stat("averagePitchCount", "Average pitch count", _format_number(metrics.get("averagePitchCount"), 0)),
        _stat("lastPitchCount", "Last pitch count", _format_number(metrics.get("lastPitchCount"), 0)),
        _stat("recentBattersFaced", "Recent batters faced", _format_number(metrics.get("recentBattersFaced"), 1)),
    ]


def _build_recent_hitter_games(person: dict | None) -> list[dict]:
    recent_games = _game_log_splits(person)[-8:][::-1]
    entries: list[dict] = []
    for split in recent_games:
        stat = split.get("stat") or {}
        hits = int(parse_float(stat.get("hits"), 0))
        home_runs = int(parse_float(stat.get("homeRuns"), 0))
        runs = int(parse_float(stat.get("runs"), 0))
        rbi = int(parse_float(stat.get("rbi"), 0))
        summary_parts = [f"{hits} H"]
        if home_runs:
            summary_parts.append(f"{home_runs} HR")
        if rbi:
            summary_parts.append(f"{rbi} RBI")
        elif runs:
            summary_parts.append(f"{runs} R")
        entries.append(
            {
                "gameDate": str(split.get("date") or stat.get("date") or ""),
                "opponentLabel": _opponent_label(split),
                "summary": ", ".join(summary_parts),
                "statItems": [
                    _stat("atBats", "AB", int(parse_float(stat.get("atBats"), 0))),
                    _stat("hits", "H", hits),
                    _stat("homeRuns", "HR", home_runs),
                    _stat("runs", "R", runs),
                    _stat("rbi", "RBI", rbi),
                    _stat("walks", "BB", int(parse_float(stat.get("baseOnBalls"), 0))),
                    _stat("strikeOuts", "K", int(parse_float(stat.get("strikeOuts"), 0))),
                    _stat("ops", "OPS", _format_number(parse_decimal(stat.get("ops"), 0), 3)),
                ],
            }
        )
    return entries


def _build_recent_pitcher_games(person: dict | None) -> list[dict]:
    raw_games = [
        split
        for split in _game_log_splits(person)
        if parse_float((split.get("stat") or {}).get("gamesStarted"), 0) > 0
        or parse_innings_pitched((split.get("stat") or {}).get("inningsPitched")) > 0
    ]
    recent_games = raw_games[-8:][::-1]
    entries: list[dict] = []
    for split in recent_games:
        stat = split.get("stat") or {}
        innings_pitched = parse_innings_pitched(stat.get("inningsPitched"))
        strikeouts = int(parse_float(stat.get("strikeOuts"), 0))
        earned_runs = int(parse_float(stat.get("earnedRuns"), 0))
        entries.append(
            {
                "gameDate": str(split.get("date") or stat.get("date") or ""),
                "opponentLabel": _opponent_label(split),
                "summary": f"{_format_number(innings_pitched, 1)} IP, {strikeouts} K, {earned_runs} ER",
                "statItems": [
                    _stat("inningsPitched", "IP", _format_number(innings_pitched, 1)),
                    _stat("strikeOuts", "K", strikeouts),
                    _stat("earnedRuns", "ER", earned_runs),
                    _stat("hits", "H", int(parse_float(stat.get("hits"), 0))),
                    _stat("walks", "BB", int(parse_float(stat.get("baseOnBalls"), 0))),
                    _stat("era", "ERA", _format_number(parse_float(stat.get("era"), 0), 2)),
                    _stat("whip", "WHIP", _format_number(parse_float(stat.get("whip"), 0), 2)),
                    _stat(
                        "pitchCount",
                        "Pitches",
                        int(
                            parse_float(
                                stat.get("numberOfPitches")
                                or stat.get("pitchesThrown")
                                or stat.get("totalPitches"),
                                0,
                            )
                        ),
                    ),
                ],
            }
        )
    return entries


def _build_pitcher_lineup_matchups(analysis: dict, pitcher: dict, game: dict | None) -> list[dict]:
    if not game:
        return []

    lineups = game.get("lineups") or {}
    lineup_side = (
        "home"
        if pitcher["opponent"]["abbreviation"] == game["homeTeam"]["abbreviation"]
        else "away"
    )
    lineup_entries = {entry["playerId"]: entry for entry in lineups.get(lineup_side, [])}
    opposing_hitters = sorted(
        [
            hitter
            for hitter in analysis["rankings"]["hitters"]
            if hitter["gameId"] == pitcher["gameId"]
            and hitter["team"]["abbreviation"] == pitcher["opponent"]["abbreviation"]
        ],
        key=lambda hitter: lineup_entries.get(hitter["playerId"], {}).get(
            "battingOrder",
            hitter["metrics"]["lineupSpot"],
        ),
    )

    return [
        {
            "playerId": hitter["playerId"],
            "playerName": hitter["playerName"],
            "teamAbbreviation": hitter["team"]["abbreviation"],
            "battingOrder": lineup_entries.get(hitter["playerId"], {}).get(
                "battingOrder",
                hitter["metrics"]["lineupSpot"],
            ),
            "bats": lineup_entries.get(hitter["playerId"], {}).get("bats", hitter["bats"]),
            "position": lineup_entries.get(hitter["playerId"], {}).get("position"),
            "status": lineup_entries.get(hitter["playerId"], {}).get(
                "status",
                "confirmed" if hitter["metrics"]["lineupConfirmed"] else "projected",
            ),
            "hitterScore": hitter["scores"]["overallHitScore"],
            "homeRunUpsideScore": hitter["scores"]["homeRunUpsideScore"],
            "recentForm": hitter["metrics"]["recentForm"],
            "pitchMixMatchupScore": hitter["metrics"]["pitchMixMatchupScore"],
            "batterVsPitcher": {
                "plateAppearances": hitter["metrics"]["batterVsPitcherPlateAppearances"],
                "ops": hitter["metrics"]["batterVsPitcherOps"],
                "homeRuns": hitter["metrics"]["batterVsPitcherHomeRuns"],
                "strikeoutRate": hitter["metrics"]["batterVsPitcherStrikeoutRate"],
                "score": hitter["metrics"]["batterVsPitcherScore"],
            },
        }
        for hitter in opposing_hitters
    ]


class PlayerDetailService:
    def __init__(
        self,
        analysis_service: DailyAnalysisService | None = None,
        player_stats_service: PlayerStatsService | None = None,
        cache: ResponseCache | None = None,
    ) -> None:
        self.analysis_service = analysis_service or DailyAnalysisService()
        self.player_stats_service = player_stats_service or PlayerStatsService()
        self.cache = cache or ResponseCache()

    def get_player_detail(
        self,
        *,
        player_id: str,
        role: str,
        analysis_date: str,
        game_id: str | None = None,
        force_refresh: bool = False,
    ) -> dict:
        cache_key = f"python-fastapi-player-detail:v1:{analysis_date}:{role}:{player_id}:{game_id or 'none'}"
        if force_refresh:
            self.cache.delete(cache_key)

        cached = None if force_refresh else self.cache.get(cache_key)
        if cached:
            response = copy.deepcopy(cached)
            response["meta"]["cacheStatus"] = "hit"
            return response

        analysis = self.analysis_service.get_daily_analysis({"date": analysis_date}, force_refresh=force_refresh)
        player = _find_player(analysis, role, player_id, game_id)
        if not player:
            raise ValueError("Player not found for the requested date and game.")

        resolved_game_id = game_id or player["gameId"]
        game = _find_game(analysis, resolved_game_id)
        season = analysis_date[:4]

        if role == "pitcher":
            person = self.player_stats_service.get_pitcher_stats([player_id], season).get(player_id)
            recent_games = _build_recent_pitcher_games(person)
            overview_stats = _build_pitcher_overview_stats(player, _season_stat(person))
            matchup_stats = _build_pitcher_matchup_stats(player, analysis)
            pitch_arsenal = _to_pitch_arsenal(
                self.player_stats_service.get_pitch_arsenal([player_id], season).get(player_id, [])
            )
            lineup_matchups = _build_pitcher_lineup_matchups(analysis, player, game)
            notes = [
                *player.get("notes", [])[:3],
                "Current lineup rows show each hitter's present slate metrics and batter-vs-pitcher history.",
            ]
        else:
            person = self.player_stats_service.get_hitter_stats([player_id], season).get(player_id)
            recent_games = _build_recent_hitter_games(person)
            overview_stats = _build_hitter_overview_stats(player, _season_stat(person))
            matchup_stats = _build_hitter_matchup_stats(player, analysis)
            pitch_arsenal = []
            lineup_matchups = []
            notes = list(player.get("notes", [])[:3])

        response = {
            "meta": {
                "analysisDate": analysis_date,
                "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "source": player.get("source", "live"),
                "cacheStatus": "miss",
                "role": role,
                "notes": notes,
            },
            "player": player,
            "game": game,
            "overviewStats": overview_stats,
            "matchupStats": matchup_stats,
            "recentGames": recent_games,
            "lineupMatchups": lineup_matchups,
            "pitchArsenal": [
                {
                    "code": pitch["code"],
                    "description": pitch["description"],
                    "usage": pitch["usage"],
                    "averageSpeed": pitch["averageSpeed"],
                    "count": pitch["count"],
                }
                for pitch in pitch_arsenal
            ],
        }
        validated = PlayerDetailResponse.model_validate(response).model_dump()
        self.cache.set(cache_key, validated)
        return validated
