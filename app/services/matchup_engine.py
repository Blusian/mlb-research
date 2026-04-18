from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.services.park_factor_service import ParkFactorService
from app.services.player_stats_service import PlayerStatsService
from app.services.statcast_service import StatcastService
from app.utils.math_utils import (
    average,
    clamp,
    inverse_scale_to_score,
    parse_decimal,
    parse_float,
    parse_innings_pitched,
    scale_to_score,
    weighted_average,
)


def _safe_handedness(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("code") or value.get("description") or value.get("name")
    normalized = str(value or "").strip().upper()
    if normalized in {"L", "LEFT"}:
        return "L"
    if normalized in {"R", "RIGHT"}:
        return "R"
    if normalized in {"S", "SWITCH"}:
        return "S"
    return "U"


def _hitter_lineup_source(entry: dict | None) -> str:
    return "official" if (entry or {}).get("status") == "confirmed" else "projected"


def _team_lineup_source(entries: list[dict] | None) -> str:
    lineup_entries = list(entries or [])[:9]
    if not lineup_entries:
        return "projected"
    statuses = {
        str(entry.get("status") or "").strip().lower()
        for entry in lineup_entries
        if entry.get("playerId")
    }
    if len(lineup_entries) >= 9 and statuses == {"confirmed"}:
        return "official"
    if not statuses or statuses <= {"projected"}:
        return "projected"
    return "mixed"


def _get_stat_block(person: dict | None, block_name: str) -> dict:
    for stat_block in (person or {}).get("stats") or []:
        if ((stat_block.get("type") or {}).get("displayName")) == block_name:
            return stat_block
    return {}


def _season_stat(person: dict | None) -> dict:
    splits = _get_stat_block(person, "season").get("splits") or []
    return (splits[0] or {}).get("stat") or {} if splits else {}


def _split_stat(person: dict | None, split_code: str) -> dict:
    splits = _get_stat_block(person, "statSplits").get("splits") or []
    for split in splits:
        if ((split.get("split") or {}).get("code")) == split_code:
            return split.get("stat") or {}
    return {}


def _game_logs(person: dict | None) -> list[dict]:
    return [split.get("stat") or {} for split in (_get_stat_block(person, "gameLog").get("splits") or [])]


def _career_stat(person: dict | None) -> dict:
    for block_name in ("career", "careerRegularSeason"):
        splits = _get_stat_block(person, block_name).get("splits") or []
        if splits:
            return (splits[0] or {}).get("stat") or {}
    return {}


def _raw_weighted_average(entries: list[tuple[float | None, float]], fallback: float) -> float:
    usable = [(float(value), float(weight)) for value, weight in entries if value is not None and weight > 0]
    if not usable:
        return fallback
    total_weight = sum(weight for _, weight in usable)
    if total_weight <= 0:
        return fallback
    return sum(value * weight for value, weight in usable) / total_weight


def _sample_weight(sample: float, *, scale: float, cap: float, bonus: float = 0.0) -> float:
    if sample <= 0:
        return 0.0
    return min(sample, cap) * scale + bonus


def _blend_value(
    current_value: float | None,
    current_sample: float,
    historical_value: float | None,
    historical_sample: float,
    career_value: float | None,
    career_sample: float,
    *,
    fallback: float,
    current_scale: float = 1.35,
    historical_scale: float = 0.75,
    career_scale: float = 0.30,
    current_cap: float = 260.0,
    historical_cap: float = 1800.0,
    career_cap: float = 3200.0,
    current_bonus: float = 18.0,
) -> float:
    return _raw_weighted_average(
        [
            (
                current_value,
                _sample_weight(
                    current_sample,
                    scale=current_scale,
                    cap=current_cap,
                    bonus=current_bonus,
                ),
            ),
            (
                historical_value,
                _sample_weight(historical_sample, scale=historical_scale, cap=historical_cap),
            ),
            (
                career_value,
                _sample_weight(career_sample, scale=career_scale, cap=career_cap),
            ),
        ],
        fallback,
    )


def _stabilize_current_metric(
    split_value: float | None,
    split_sample: float,
    overall_value: float | None,
    overall_sample: float,
    *,
    fallback: float,
) -> float:
    return _blend_value(
        split_value,
        split_sample,
        overall_value,
        max(overall_sample - split_sample, 0.0),
        overall_value,
        overall_sample,
        fallback=fallback,
        current_scale=1.0,
        historical_scale=0.55,
        career_scale=0.18,
        current_cap=220.0,
        historical_cap=480.0,
        career_cap=640.0,
        current_bonus=12.0,
    )


def _subtract_totals(total: dict[str, float], current: dict[str, float]) -> dict[str, float]:
    return {key: max(total.get(key, 0.0) - current.get(key, 0.0), 0.0) for key in total}


def _hitter_totals(stat: dict | None) -> dict[str, float]:
    stat = stat or {}
    hits = parse_float(stat.get("hits"), 0)
    at_bats = parse_float(stat.get("atBats"), 0)
    if at_bats <= 0 and hits > 0:
        average_stat = parse_decimal(stat.get("avg"), 0)
        at_bats = hits / average_stat if average_stat > 0 else 0.0
    doubles = parse_float(stat.get("doubles"), 0)
    triples = parse_float(stat.get("triples"), 0)
    home_runs = parse_float(stat.get("homeRuns"), 0)
    singles = max(hits - doubles - triples - home_runs, 0.0)
    total_bases = parse_float(
        stat.get("totalBases"),
        singles + doubles * 2 + triples * 3 + home_runs * 4,
    )
    return {
        "plateAppearances": parse_float(stat.get("plateAppearances"), 0),
        "atBats": at_bats,
        "hits": hits,
        "walks": parse_float(stat.get("baseOnBalls"), 0),
        "hitByPitch": parse_float(stat.get("hitByPitch"), 0),
        "strikeOuts": parse_float(stat.get("strikeOuts"), 0),
        "homeRuns": home_runs,
        "totalBases": total_bases,
    }


def _hitter_rates_from_totals(totals: dict[str, float], fallback: dict[str, float]) -> dict[str, float]:
    plate_appearances = totals.get("plateAppearances", 0.0)
    at_bats = totals.get("atBats", 0.0)
    hits = totals.get("hits", 0.0)
    walks = totals.get("walks", 0.0)
    hit_by_pitch = totals.get("hitByPitch", 0.0)
    strikeouts = totals.get("strikeOuts", 0.0)
    total_bases = totals.get("totalBases", 0.0)
    home_runs = totals.get("homeRuns", 0.0)
    average_stat = hits / at_bats if at_bats > 0 else fallback.get("average", 0.245)
    obp = (hits + walks + hit_by_pitch) / plate_appearances if plate_appearances > 0 else fallback.get("obp", 0.320)
    slugging = total_bases / at_bats if at_bats > 0 else fallback.get("slugging", 0.405)
    return {
        "average": average_stat,
        "obp": obp,
        "slugging": slugging,
        "ops": obp + slugging,
        "iso": max(slugging - average_stat, 0.0),
        "strikeoutRate": (strikeouts / plate_appearances) * 100 if plate_appearances > 0 else fallback.get("strikeoutRate", 22.0),
        "walkRate": (walks / plate_appearances) * 100 if plate_appearances > 0 else fallback.get("walkRate", 8.0),
        "homeRunRate": (home_runs / plate_appearances) * 100 if plate_appearances > 0 else fallback.get("homeRunRate", 3.2),
    }


def _pitcher_totals(stat: dict | None) -> dict[str, float]:
    stat = stat or {}
    innings_pitched = parse_innings_pitched(stat.get("inningsPitched"))
    earned_runs = parse_float(stat.get("earnedRuns"), 0)
    if earned_runs <= 0 and innings_pitched > 0:
        earned_runs = parse_float(stat.get("era"), 0) * innings_pitched / 9
    strikeouts = parse_float(stat.get("strikeOuts"), 0)
    walks = parse_float(stat.get("baseOnBalls"), 0)
    hits = parse_float(stat.get("hits"), 0)
    batters_faced = parse_float(stat.get("battersFaced"), 0)
    if batters_faced <= 0:
        batters_faced = max(strikeouts + walks + hits + innings_pitched * 2.6, 0.0)
    return {
        "inningsPitched": innings_pitched,
        "earnedRuns": earned_runs,
        "hits": hits,
        "walks": walks,
        "strikeOuts": strikeouts,
        "homeRuns": parse_float(stat.get("homeRuns"), 0),
        "battersFaced": batters_faced,
        "groundOuts": parse_float(stat.get("groundOuts"), 0),
        "airOuts": parse_float(stat.get("airOuts"), 0),
        "gamesStarted": parse_float(stat.get("gamesStarted"), 0),
    }


def _pitcher_rates_from_totals(totals: dict[str, float], fallback: dict[str, float]) -> dict[str, float]:
    innings_pitched = totals.get("inningsPitched", 0.0)
    batters_faced = totals.get("battersFaced", 0.0)
    strikeouts = totals.get("strikeOuts", 0.0)
    walks = totals.get("walks", 0.0)
    home_runs = totals.get("homeRuns", 0.0)
    hits = totals.get("hits", 0.0)
    ground_outs = totals.get("groundOuts", 0.0)
    air_outs = totals.get("airOuts", 0.0)
    balls_in_play_outs = ground_outs + air_outs
    return {
        "era": (totals.get("earnedRuns", 0.0) * 9 / innings_pitched) if innings_pitched > 0 else fallback.get("era", 4.10),
        "whip": ((walks + hits) / innings_pitched) if innings_pitched > 0 else fallback.get("whip", 1.28),
        "strikeoutRate": (strikeouts / batters_faced) * 100 if batters_faced > 0 else fallback.get("strikeoutRate", 22.0),
        "walkRate": (walks / batters_faced) * 100 if batters_faced > 0 else fallback.get("walkRate", 8.0),
        "homeRunRate": (home_runs / batters_faced) * 100 if batters_faced > 0 else fallback.get("homeRunRate", 2.8),
        "groundBallRate": (ground_outs / balls_in_play_outs) * 100 if balls_in_play_outs > 0 else fallback.get("groundBallRate", 43.0),
        "flyBallRate": (air_outs / balls_in_play_outs) * 100 if balls_in_play_outs > 0 else fallback.get("flyBallRate", 37.0),
        "inningsPerStart": innings_pitched / totals.get("gamesStarted", 1.0) if totals.get("gamesStarted", 0.0) > 0 else fallback.get("inningsPerStart", 5.4),
    }


def _history_confidence_score(
    current_sample: float,
    historical_sample: float,
    career_sample: float,
    *,
    current_range: tuple[float, float],
    historical_range: tuple[float, float],
    career_range: tuple[float, float],
) -> float:
    return weighted_average(
        [
            (scale_to_score(current_sample, current_range[0], current_range[1]), 0.45),
            (scale_to_score(historical_sample, historical_range[0], historical_range[1]), 0.35),
            (scale_to_score(career_sample, career_range[0], career_range[1]), 0.20),
        ],
        fallback=50.0,
    )


def _percent_change(current_value: float, baseline_value: float, *, invert: bool = False) -> float:
    if abs(baseline_value) < 1e-6:
        return 0.0
    change = ((current_value - baseline_value) / abs(baseline_value)) * 100
    if invert:
        change *= -1
    return clamp(change, -60.0, 60.0)


def _is_rookie_season(person: dict | None, analysis_date: str, historical_sample: float) -> bool:
    debut_date = str((person or {}).get("mlbDebutDate") or "").strip()
    analysis_year = str(analysis_date)[:4]
    if debut_date[:4] == analysis_year and analysis_year:
        return True
    return historical_sample <= 0


def _recent_hitter_form(logs: list[dict], window: int) -> float:
    sample = logs[-window:]
    if not sample:
        return 50.0
    avg_ops = average([parse_decimal(game.get("ops"), 0.68) for game in sample], 0.68)
    avg_hits = average([parse_float(game.get("hits"), 1) for game in sample], 1)
    home_runs = sum(parse_float(game.get("homeRuns"), 0) for game in sample)
    return clamp(
        scale_to_score(avg_ops, 0.45, 1.10) * 0.65
        + scale_to_score(avg_hits, 0, 2.4) * 0.20
        + scale_to_score(home_runs / len(sample), 0, 0.6) * 0.15,
        0,
        100,
    )


def _recent_pitcher_form(logs: list[dict], window: int) -> float:
    sample = logs[-window:]
    if not sample:
        return 50.0
    era = average([parse_float(game.get("era"), 4.00) for game in sample], 4.0)
    whip = average([parse_float(game.get("whip"), 1.28) for game in sample], 1.28)
    strikeouts_per_9 = average([parse_float(game.get("strikeoutsPer9Inn"), 8.2) for game in sample], 8.2)
    return clamp(
        inverse_scale_to_score(era, 1.8, 6.2) * 0.45
        + inverse_scale_to_score(whip, 0.85, 1.6) * 0.30
        + scale_to_score(strikeouts_per_9, 4.5, 13.0) * 0.25,
        0,
        100,
    )


def _sample_adjusted_score(raw_score: float, sample: float, full_confidence_at: float) -> float:
    confidence = clamp(sample / full_confidence_at, 0.15, 1.0)
    return clamp(50 + (raw_score - 50) * confidence, 0, 100)


def _standard_deviation(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = average(values, 0.0)
    variance = average([(value - mean) ** 2 for value in values], 0.0)
    return variance ** 0.5


def _pitch_count(log: dict) -> float:
    return parse_float(log.get("numberOfPitches") or log.get("pitchesThrown") or log.get("totalPitches"), 0)


def _batters_faced(log: dict) -> float:
    return parse_float(log.get("battersFaced"), 0)


def _build_matchup_groups(games: list[dict]) -> list[dict]:
    groups: dict[str, set[str]] = defaultdict(set)
    for game in games:
        home_pitcher_id = ((game["probablePitchers"].get("home") or {}).get("playerId")) or ""
        away_pitcher_id = ((game["probablePitchers"].get("away") or {}).get("playerId")) or ""
        if home_pitcher_id:
            for entry in game["lineups"]["away"]:
                groups[home_pitcher_id].add(entry["playerId"])
        if away_pitcher_id:
            for entry in game["lineups"]["home"]:
                groups[away_pitcher_id].add(entry["playerId"])
    return [
        {"opposingPlayerId": opposing_player_id, "personIds": sorted(person_ids)}
        for opposing_player_id, person_ids in groups.items()
    ]


def _build_bvp_history(split: dict | None) -> dict:
    stat = (split or {}).get("stat") or {}
    plate_appearances = parse_float(stat.get("plateAppearances"), 0)
    ops = parse_decimal(stat.get("ops"), 0.72)
    home_runs = parse_float(stat.get("homeRuns"), 0)
    strikeout_rate = (
        parse_float(stat.get("strikeOuts"), 0) / plate_appearances * 100 if plate_appearances else 22
    )
    raw_score = weighted_average(
        [
            (scale_to_score(ops, 0.55, 1.15), 0.50),
            (scale_to_score((home_runs / plate_appearances) if plate_appearances else 0, 0, 0.12), 0.20),
            (inverse_scale_to_score(strikeout_rate, 12, 42), 0.30),
        ]
    )
    return {
        "plateAppearances": int(plate_appearances),
        "ops": ops,
        "homeRuns": int(home_runs),
        "strikeoutRate": strikeout_rate,
        "score": _sample_adjusted_score(raw_score, plate_appearances, 18),
    }


def _to_pitch_arsenal(splits: list[dict]) -> list[dict]:
    arsenal: list[dict] = []
    for split in splits or []:
        stat = split.get("stat") or {}
        pitch_type = stat.get("type") or {}
        usage = parse_float(stat.get("percentage"), 0)
        if usage <= 1:
            usage *= 100
        if usage <= 0:
            continue
        arsenal.append(
            {
                "code": pitch_type.get("code") or "UNK",
                "description": pitch_type.get("description") or "Unknown",
                "usage": usage,
                "averageSpeed": parse_float(stat.get("averageSpeed"), 0),
                "count": parse_float(stat.get("count"), 0),
            }
        )
    return sorted(arsenal, key=lambda pitch: pitch["usage"], reverse=True)


def _total_bases(event_type: str, is_base_hit: bool) -> int:
    mapping = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
    if event_type in mapping:
        return mapping[event_type]
    return 1 if is_base_hit else 0


def _build_pitch_type_performance_map(splits: list[dict], pitcher_hand: str) -> dict[str, dict]:
    performance: dict[str, dict] = {}
    for split in splits or []:
        play = ((split.get("stat") or {}).get("play") or {})
        details = play.get("details") or {}
        if not details.get("isPlateAppearance"):
            continue
        observed_pitch_hand = _safe_handedness(((details.get("pitchHand") or {}).get("code")))
        if pitcher_hand != "U" and observed_pitch_hand not in {"U", pitcher_hand}:
            continue
        pitch_type = details.get("type") or {}
        code = pitch_type.get("code") or "UNK"
        entry = performance.setdefault(
            code,
            {
                "code": code,
                "description": pitch_type.get("description") or code,
                "plateAppearances": 0,
                "atBats": 0,
                "hits": 0,
                "walks": 0,
                "hitByPitch": 0,
                "strikeouts": 0,
                "homeRuns": 0,
                "totalBases": 0,
            },
        )
        event_type = str(details.get("eventType") or "").lower()
        entry["plateAppearances"] += 1
        if details.get("isAtBat"):
            entry["atBats"] += 1
        if details.get("isBaseHit"):
            entry["hits"] += 1
        if "walk" in event_type:
            entry["walks"] += 1
        if event_type == "hit_by_pitch":
            entry["hitByPitch"] += 1
        if "strikeout" in event_type:
            entry["strikeouts"] += 1
        if event_type == "home_run":
            entry["homeRuns"] += 1
        entry["totalBases"] += _total_bases(event_type, bool(details.get("isBaseHit")))
    for entry in performance.values():
        pa = max(entry["plateAppearances"], 1)
        at_bats = max(entry["atBats"], 1)
        obp = (entry["hits"] + entry["walks"] + entry["hitByPitch"]) / pa
        slg = entry["totalBases"] / at_bats
        strikeout_rate = entry["strikeouts"] / pa * 100
        hr_rate = entry["homeRuns"] / pa
        raw = weighted_average(
            [
                (scale_to_score(obp, 0.24, 0.44), 0.35),
                (scale_to_score(slg, 0.28, 0.80), 0.35),
                (scale_to_score(hr_rate, 0, 0.12), 0.15),
                (inverse_scale_to_score(strikeout_rate, 12, 42), 0.15),
            ]
        )
        entry["score"] = _sample_adjusted_score(raw, entry["plateAppearances"], 20)
    return performance


def _build_pitch_mix_matchup(arsenal: list[dict], performance: dict[str, dict]) -> dict:
    top_pitches = arsenal[:4]
    if not top_pitches:
        return {
            "score": 50.0,
            "sample": 0.0,
            "primaryPitchTypeCode": "UNK",
            "primaryPitchTypeDescription": "Unknown",
            "primaryPitchUsage": 0.0,
            "secondaryPitchTypeCode": "UNK",
            "secondaryPitchTypeDescription": "Unknown",
            "secondaryPitchUsage": 0.0,
        }
    weighted_entries = []
    sample = 0.0
    for pitch in top_pitches:
        pitch_performance = performance.get(pitch["code"])
        weighted_entries.append(((pitch_performance or {}).get("score", 50.0), pitch["usage"]))
        sample += ((pitch_performance or {}).get("plateAppearances", 0) * pitch["usage"]) / 100
    score = _sample_adjusted_score(weighted_average(weighted_entries), sample, 18)
    primary = top_pitches[0]
    secondary = top_pitches[1] if len(top_pitches) > 1 else None
    return {
        "score": score,
        "sample": round(sample, 1),
        "primaryPitchTypeCode": primary["code"],
        "primaryPitchTypeDescription": primary["description"],
        "primaryPitchUsage": round(primary["usage"], 1),
        "secondaryPitchTypeCode": secondary["code"] if secondary else "UNK",
        "secondaryPitchTypeDescription": secondary["description"] if secondary else "Unknown",
        "secondaryPitchUsage": round(secondary["usage"], 1) if secondary else 0.0,
    }


def _weather_boost(weather: dict | None) -> float:
    if not weather:
        return 50.0
    score = 50.0
    temperature = parse_float(weather.get("temperatureF"), 72)
    wind_speed = parse_float(weather.get("windSpeedMph"), 0)
    humidity = parse_float(weather.get("humidity"), 40)
    score += clamp((temperature - 70) * 0.6, -8, 10)
    if str(weather.get("windDirection") or "").upper() in {"S", "SW", "SE", "E"}:
        score += clamp(wind_speed * 0.7, 0, 12)
    else:
        score -= clamp(wind_speed * 0.5, 0, 8)
    score += clamp((humidity - 45) * 0.15, -4, 6)
    return clamp(score, 30, 78)


def _altitude_boost(home_team: str) -> float:
    if home_team == "COL":
        return 82.0
    if home_team in {"ARI", "ATL"}:
        return 56.0
    return 50.0


class MatchupEngine:
    def __init__(
        self,
        player_stats_service: PlayerStatsService | None = None,
        statcast_service: StatcastService | None = None,
        park_factor_service: ParkFactorService | None = None,
    ) -> None:
        self.player_stats_service = player_stats_service or PlayerStatsService()
        self.statcast_service = statcast_service or StatcastService()
        self.park_factor_service = park_factor_service or ParkFactorService()

    def build_candidates(self, games: list[dict], analysis_date: str) -> tuple[list[dict], list[dict], list[str]]:
        hitter_ids = sorted(
            {
                entry["playerId"]
                for game in games
                for entry in [*game["lineups"]["away"], *game["lineups"]["home"]]
            }
        )
        pitcher_ids = sorted(
            {
                pitcher["playerId"]
                for game in games
                for pitcher in [
                    game["probablePitchers"].get("away"),
                    game["probablePitchers"].get("home"),
                ]
                if pitcher and pitcher.get("playerId")
            }
        )
        season = analysis_date[:4]
        hitter_stats = self.player_stats_service.get_hitter_stats(hitter_ids, season)
        pitcher_stats = self.player_stats_service.get_pitcher_stats(pitcher_ids, season)
        pitch_arsenal = self.player_stats_service.get_pitch_arsenal(pitcher_ids, season)
        hitter_play_logs = self.player_stats_service.get_hitter_play_logs(hitter_ids, season)
        hitter_career_splits_getter = getattr(self.player_stats_service, "get_hitter_career_splits", None)
        hitter_career_splits = (
            hitter_career_splits_getter(hitter_ids) if callable(hitter_career_splits_getter) else {}
        )
        bvp_history = self.player_stats_service.get_batter_vs_pitcher_history(_build_matchup_groups(games))
        hitter_profiles = self.statcast_service.get_hitter_profiles(analysis_date)
        pitcher_profiles = self.statcast_service.get_pitcher_profiles(analysis_date)
        bat_tracking = self.statcast_service.get_bat_tracking_profiles(season)
        hitters: list[dict] = []
        notes = [
            "Python FastAPI analytics service combined MLB Stats API schedule/context with Baseball Savant Statcast data."
        ]

        for game in games:
            weather_boost = _weather_boost(game.get("weather"))
            game_venue_factors = self.park_factor_service.get_factors(game["homeTeam"]["abbreviation"], "R")
            game["venue"]["parkFactor"] = game_venue_factors["park_factor"]
            game["venue"]["homeRunFactor"] = game_venue_factors["home_run_factor"]
            for side, team, opponent, opposing_pitcher, is_home in [
                ("away", game["awayTeam"], game["homeTeam"], game["probablePitchers"].get("home"), False),
                ("home", game["homeTeam"], game["awayTeam"], game["probablePitchers"].get("away"), True),
            ]:
                opposing_pitcher_id = (opposing_pitcher or {}).get("playerId") or ""
                opposing_pitcher_person = pitcher_stats.get(opposing_pitcher_id)
                opposing_hand = _safe_handedness((opposing_pitcher or {}).get("throwingHand"))
                if opposing_hand == "U":
                    opposing_hand = _safe_handedness((opposing_pitcher_person or {}).get("pitchHand"))
                for entry in game["lineups"][side]:
                    person = hitter_stats.get(entry["playerId"])
                    hitter_hand = _safe_handedness(entry.get("bats"))
                    if hitter_hand == "U":
                        hitter_hand = _safe_handedness((person or {}).get("batSide"))
                    split_code = "vl" if opposing_hand == "L" else "vr"
                    season_stat = _season_stat(person)
                    career_stat = _career_stat(person)
                    split_stat = _split_stat(person, split_code)
                    career_split_stat = _split_stat(hitter_career_splits.get(entry["playerId"]), split_code)
                    logs = _game_logs(person)
                    savant_profile = hitter_profiles.get(entry["playerId"], {})
                    savant_split = savant_profile.get("vsLeft" if opposing_hand == "L" else "vsRight") or savant_profile.get("overall") or {}
                    savant_overall = savant_profile.get("overall") or {}
                    bat_tracking_profile = bat_tracking.get(entry["playerId"], {})
                    pitcher_profile = pitcher_profiles.get(opposing_pitcher_id, {})
                    pitcher_split = pitcher_profile.get("vsLeft" if hitter_hand == "L" else "vsRight") or pitcher_profile.get("overall") or {}
                    park = self.park_factor_service.get_factors(game["homeTeam"]["abbreviation"], hitter_hand)
                    bvp = _build_bvp_history(bvp_history.get(f"{entry['playerId']}:{opposing_pitcher_id}"))
                    arsenal = _to_pitch_arsenal(pitch_arsenal.get(opposing_pitcher_id, []))
                    pitch_type_performance = _build_pitch_type_performance_map(
                        hitter_play_logs.get(entry["playerId"], []),
                        opposing_hand,
                    )
                    pitch_mix = _build_pitch_mix_matchup(arsenal, pitch_type_performance)
                    recent7 = _recent_hitter_form(logs, 7)
                    recent14 = _recent_hitter_form(logs, 14)
                    recent30 = _recent_hitter_form(logs, 30)
                    season_totals = _hitter_totals(season_stat)
                    split_totals = _hitter_totals(split_stat)
                    career_totals = _hitter_totals(career_stat)
                    career_split_totals = _hitter_totals(career_split_stat)
                    previous_totals = _subtract_totals(career_totals, season_totals)
                    previous_split_totals = _subtract_totals(career_split_totals, split_totals)
                    current_rates = _hitter_rates_from_totals(season_totals, {})
                    current_split_rates = _hitter_rates_from_totals(split_totals, current_rates)
                    previous_rates = _hitter_rates_from_totals(previous_totals, current_rates)
                    previous_split_rates = _hitter_rates_from_totals(previous_split_totals, previous_rates)
                    career_rates = _hitter_rates_from_totals(career_totals, current_rates)
                    career_split_rates = _hitter_rates_from_totals(career_split_totals, career_rates)
                    split_sample = max(parse_float(savant_split.get("plateAppearances"), 0), split_totals["plateAppearances"])
                    overall_sample = max(parse_float(savant_overall.get("plateAppearances"), 0), season_totals["plateAppearances"])
                    historical_split_sample = previous_split_totals["plateAppearances"] or previous_totals["plateAppearances"]
                    career_split_sample = career_split_totals["plateAppearances"] or career_totals["plateAppearances"]
                    historical_split_rates = previous_split_rates if previous_split_totals["plateAppearances"] > 0 else previous_rates
                    career_baseline_rates = career_split_rates if career_split_totals["plateAppearances"] > 0 else career_rates
                    avg = _blend_value(
                        savant_split.get("average", current_split_rates["average"]),
                        split_sample,
                        historical_split_rates["average"],
                        historical_split_sample,
                        career_baseline_rates["average"],
                        career_split_sample,
                        fallback=current_split_rates["average"],
                    )
                    obp = _blend_value(
                        savant_split.get("obp", current_split_rates["obp"]),
                        split_sample,
                        historical_split_rates["obp"],
                        historical_split_sample,
                        career_baseline_rates["obp"],
                        career_split_sample,
                        fallback=current_split_rates["obp"],
                    )
                    slg = _blend_value(
                        savant_split.get("slugging", current_split_rates["slugging"]),
                        split_sample,
                        historical_split_rates["slugging"],
                        historical_split_sample,
                        career_baseline_rates["slugging"],
                        career_split_sample,
                        fallback=current_split_rates["slugging"],
                    )
                    ops = _blend_value(
                        savant_split.get("ops", current_split_rates["ops"]),
                        split_sample,
                        historical_split_rates["ops"],
                        historical_split_sample,
                        career_baseline_rates["ops"],
                        career_split_sample,
                        fallback=obp + slg,
                    )
                    iso = _blend_value(
                        savant_split.get("iso", current_split_rates["iso"]),
                        split_sample,
                        historical_split_rates["iso"],
                        historical_split_sample,
                        career_baseline_rates["iso"],
                        career_split_sample,
                        fallback=max(slg - avg, 0.08),
                    )
                    woba = _blend_value(
                        savant_split.get("woba", current_split_rates["obp"]),
                        split_sample,
                        historical_split_rates["obp"],
                        historical_split_sample,
                        career_baseline_rates["obp"],
                        career_split_sample,
                        fallback=obp,
                    )
                    xwoba = _blend_value(
                        savant_split.get("xwoba", current_split_rates["obp"]),
                        split_sample,
                        historical_split_rates["obp"],
                        historical_split_sample,
                        career_baseline_rates["obp"],
                        career_split_sample,
                        fallback=obp,
                    )
                    xba = _blend_value(
                        savant_split.get("xba", current_split_rates["average"]),
                        split_sample,
                        historical_split_rates["average"],
                        historical_split_sample,
                        career_baseline_rates["average"],
                        career_split_sample,
                        fallback=avg,
                    )
                    xslg = _blend_value(
                        savant_split.get("xslg", current_split_rates["slugging"]),
                        split_sample,
                        historical_split_rates["slugging"],
                        historical_split_sample,
                        career_baseline_rates["slugging"],
                        career_split_sample,
                        fallback=slg,
                    )
                    strikeout_rate = _blend_value(
                        savant_split.get("strikeoutRate", current_split_rates["strikeoutRate"]),
                        split_sample,
                        historical_split_rates["strikeoutRate"],
                        historical_split_sample,
                        career_baseline_rates["strikeoutRate"],
                        career_split_sample,
                        fallback=current_split_rates["strikeoutRate"],
                    )
                    walk_rate = _blend_value(
                        savant_split.get("walkRate", current_split_rates["walkRate"]),
                        split_sample,
                        historical_split_rates["walkRate"],
                        historical_split_sample,
                        career_baseline_rates["walkRate"],
                        career_split_sample,
                        fallback=current_split_rates["walkRate"],
                    )
                    barrel_rate = _stabilize_current_metric(
                        savant_split.get("barrelRate"),
                        split_sample,
                        savant_overall.get("barrelRate"),
                        overall_sample,
                        fallback=max(2.0, min(22.0, 3.0 + slg * 40)),
                    )
                    hard_hit = _stabilize_current_metric(
                        savant_split.get("hardHitRate"),
                        split_sample,
                        savant_overall.get("hardHitRate"),
                        overall_sample,
                        fallback=max(28.0, min(58.0, 28 + barrel_rate * 1.2)),
                    )
                    average_exit_velocity = _stabilize_current_metric(
                        savant_split.get("averageExitVelocity"),
                        split_sample,
                        savant_overall.get("averageExitVelocity"),
                        overall_sample,
                        fallback=89.0,
                    )
                    launch_angle = _stabilize_current_metric(
                        savant_split.get("launchAngle"),
                        split_sample,
                        savant_overall.get("launchAngle"),
                        overall_sample,
                        fallback=12.0,
                    )
                    chase_rate = _stabilize_current_metric(
                        savant_split.get("chaseRate"),
                        split_sample,
                        savant_overall.get("chaseRate"),
                        overall_sample,
                        fallback=29.0,
                    )
                    split_whiff_rate = _stabilize_current_metric(
                        savant_split.get("whiffRate"),
                        split_sample,
                        savant_overall.get("whiffRate"),
                        overall_sample,
                        fallback=28.0,
                    )
                    contact_rate = _stabilize_current_metric(
                        savant_split.get("contactRate"),
                        split_sample,
                        savant_overall.get("contactRate"),
                        overall_sample,
                        fallback=72.0,
                    )
                    zone_contact_rate = _stabilize_current_metric(
                        savant_split.get("zoneContactRate"),
                        split_sample,
                        savant_overall.get("zoneContactRate"),
                        overall_sample,
                        fallback=82.0,
                    )
                    pull_rate = _stabilize_current_metric(
                        savant_split.get("pullRate"),
                        split_sample,
                        savant_overall.get("pullRate"),
                        overall_sample,
                        fallback=42.0,
                    )
                    fly_ball_rate = _stabilize_current_metric(
                        savant_split.get("flyBallRate"),
                        split_sample,
                        savant_overall.get("flyBallRate"),
                        overall_sample,
                        fallback=35.0,
                    )
                    ground_ball_rate = _stabilize_current_metric(
                        savant_split.get("groundBallRate"),
                        split_sample,
                        savant_overall.get("groundBallRate"),
                        overall_sample,
                        fallback=42.0,
                    )
                    line_drive_rate = _stabilize_current_metric(
                        savant_split.get("lineDriveRate"),
                        split_sample,
                        savant_overall.get("lineDriveRate"),
                        overall_sample,
                        fallback=23.0,
                    )
                    average_bat_speed = parse_float(
                        bat_tracking_profile.get("averageBatSpeed"),
                        72.0,
                    )
                    velocity_score = inverse_scale_to_score(
                        abs(average([pitch["averageSpeed"] for pitch in arsenal], 92.0) - savant_overall.get("pitchVelocitySeen", 92.0)),
                        0,
                        6,
                    )
                    pitcher_power_allowed = weighted_average(
                        [
                            (scale_to_score(pitcher_split.get("barrelRate", 7), 3, 14), 0.34),
                            (scale_to_score(pitcher_split.get("hardHitRate", 38), 28, 50), 0.28),
                            (scale_to_score(pitcher_split.get("xslg", 0.405), 0.32, 0.58), 0.20),
                            (scale_to_score(parse_float(_season_stat(pitcher_stats.get(opposing_pitcher_id)).get("homeRuns"), 0), 0, 18), 0.18),
                        ]
                    )
                    historical_confidence = _history_confidence_score(
                        split_sample,
                        historical_split_sample,
                        career_split_sample,
                        current_range=(20, 220),
                        historical_range=(40, 1400),
                        career_range=(80, 2200),
                    )
                    is_rookie_season = _is_rookie_season(person, analysis_date, historical_split_sample)
                    current_split_skill = weighted_average(
                        [
                            (scale_to_score(current_split_rates["average"], 0.21, 0.34), 0.22),
                            (scale_to_score(current_split_rates["ops"], 0.62, 1.08), 0.34),
                            (scale_to_score(current_split_rates["iso"], 0.09, 0.33), 0.24),
                            (inverse_scale_to_score(current_split_rates["strikeoutRate"], 12, 35), 0.20),
                        ]
                    )
                    historical_split_skill = weighted_average(
                        [
                            (scale_to_score(historical_split_rates["average"], 0.21, 0.34), 0.22),
                            (scale_to_score(historical_split_rates["ops"], 0.62, 1.08), 0.34),
                            (scale_to_score(historical_split_rates["iso"], 0.09, 0.33), 0.24),
                            (inverse_scale_to_score(historical_split_rates["strikeoutRate"], 12, 35), 0.20),
                        ]
                    )
                    hitter_growth_percent = _percent_change(current_split_skill, historical_split_skill)
                    data_coverage = weighted_average(
                        [
                            (100 if savant_split else 45, 0.28),
                            (100 if bat_tracking_profile else 55, 0.16),
                            (100 if arsenal else 52, 0.14),
                            (100 if game.get("weather") else 50, 0.12),
                            (100 if logs else 55, 0.12),
                            (historical_confidence, 0.18),
                        ]
                    )
                    hitter_metrics = {
                        "averageVsHandedness": avg,
                        "obpVsHandedness": obp,
                        "sluggingVsHandedness": slg,
                        "opsVsHandedness": ops,
                        "isoVsHandedness": iso,
                        "wobaVsHandedness": woba,
                        "xwobaVsHandedness": xwoba,
                        "xbaVsHandedness": xba,
                        "xslgVsHandedness": xslg,
                        "strikeoutRate": strikeout_rate,
                        "walkRate": walk_rate,
                        "chaseRate": chase_rate,
                        "whiffRate": parse_float(
                            bat_tracking_profile.get("whiffRate"),
                            split_whiff_rate,
                        ),
                        "hardHitRate": hard_hit,
                        "barrelRate": barrel_rate,
                        "averageExitVelocity": average_exit_velocity,
                        "launchAngle": launch_angle,
                        "pullRate": pull_rate,
                        "flyBallRate": fly_ball_rate,
                        "groundBallRate": ground_ball_rate,
                        "lineDriveRate": line_drive_rate,
                        "contactRate": parse_float(
                            bat_tracking_profile.get("contactRate"),
                            contact_rate,
                        ),
                        "zoneContactRate": parse_float(
                            bat_tracking_profile.get("zoneContactRate"),
                            zone_contact_rate,
                        ),
                        "averageBatSpeed": average_bat_speed,
                        "hardSwingRate": parse_float(
                            bat_tracking_profile.get("hardSwingRate"),
                            18.0,
                        ),
                        "squaredUpRate": parse_float(
                            bat_tracking_profile.get("squaredUpRate"),
                            28.0,
                        ),
                        "blastRate": parse_float(
                            bat_tracking_profile.get("blastRate"),
                            8.0,
                        ),
                        "swingLength": parse_float(
                            bat_tracking_profile.get("swingLength"),
                            7.2,
                        ),
                        "batTrackingRunValue": parse_float(
                            bat_tracking_profile.get("batTrackingRunValue"),
                            0.0,
                        ),
                        "performanceByPitchType": pitch_type_performance,
                        "zoneProfile": {"hotZonesAvailable": False, "zoneMatchupScore": 50.0},
                        "recentForm7": recent7,
                        "recentForm14": recent14,
                        "recentForm30": recent30,
                        "recentForm": weighted_average([(recent7, 0.4), (recent14, 0.35), (recent30, 0.25)]),
                        "opponentPitcherContactAllowed": weighted_average(
                            [
                                (scale_to_score(pitcher_split.get("hardHitRate", 38), 28, 50), 0.4),
                                (scale_to_score(pitcher_split.get("xwoba", 0.320), 0.28, 0.39), 0.3),
                                (scale_to_score(pitcher_split.get("xba", 0.245), 0.21, 0.31), 0.3),
                            ]
                        ),
                        "opponentPitcherWalkRateAllowed": parse_float(
                            pitcher_split.get("walkRate"),
                            8.0,
                        ),
                        "opponentPitcherPowerAllowed": pitcher_power_allowed / 10,
                        "batterVsPitcherPlateAppearances": bvp["plateAppearances"],
                        "batterVsPitcherOps": bvp["ops"],
                        "batterVsPitcherHomeRuns": bvp["homeRuns"],
                        "batterVsPitcherStrikeoutRate": bvp["strikeoutRate"],
                        "batterVsPitcherScore": bvp["score"],
                        "pitchMixMatchupScore": pitch_mix["score"],
                        "pitchMixMatchupSample": pitch_mix["sample"],
                        "primaryPitchTypeCode": pitch_mix["primaryPitchTypeCode"],
                        "primaryPitchTypeDescription": pitch_mix["primaryPitchTypeDescription"],
                        "primaryPitchUsage": pitch_mix["primaryPitchUsage"],
                        "secondaryPitchTypeCode": pitch_mix["secondaryPitchTypeCode"],
                        "secondaryPitchTypeDescription": pitch_mix["secondaryPitchTypeDescription"],
                        "secondaryPitchUsage": pitch_mix["secondaryPitchUsage"],
                        "velocityBandScore": velocity_score,
                        "movementMatchupScore": 50.0,
                        "zoneMatchupScore": 50.0,
                        "pitcherWeaknessExploitScore": weighted_average(
                            [
                                (scale_to_score(woba, 0.28, 0.45), 0.35),
                                (scale_to_score(pitcher_split.get("xwoba", 0.320), 0.28, 0.39), 0.35),
                                (pitch_mix["score"], 0.30),
                            ]
                        ),
                        "pitcherDamageScore": pitcher_power_allowed,
                        "pitcherStrikeoutThreatScore": weighted_average(
                            [
                                (scale_to_score(pitcher_split.get("strikeoutRate", 22.0), 16, 34), 0.4),
                                (scale_to_score(pitcher_split.get("whiffRate", 24.0), 18, 34), 0.3),
                                (scale_to_score(parse_float(_season_stat(pitcher_stats.get(opposing_pitcher_id)).get("strikeOuts"), 0), 0, 120), 0.3),
                            ]
                        ),
                        "parkFactor": park["park_factor"],
                        "parkFactorVsHandedness": park["park_factor"],
                        "hitParkFactorVsHandedness": park["hit_factor"],
                        "singleParkFactorVsHandedness": park["single_factor"],
                        "doubleParkFactorVsHandedness": park["double_factor"],
                        "tripleParkFactorVsHandedness": park["triple_factor"],
                        "homeRunParkFactor": park["home_run_factor"],
                        "homeRunParkFactorVsHandedness": park["home_run_factor"],
                        "walkParkFactorVsHandedness": park["walk_factor"],
                        "strikeoutParkFactorVsHandedness": park["strikeout_factor"],
                        "weatherBoostScore": weather_boost,
                        "altitudeBoostScore": _altitude_boost(game["homeTeam"]["abbreviation"]),
                        "homeAwayAdjustment": 54.0 if is_home else 50.0,
                        "lineupSpot": entry["battingOrder"],
                        "lineupConfirmed": entry["status"] == "confirmed",
                        "lineupSource": _hitter_lineup_source(entry),
                        "playingTimeConfidence": 96.0 if entry["status"] == "confirmed" else 78.0,
                        "starterExposureScore": weighted_average(
                            [
                                (scale_to_score(max(6 - entry["battingOrder"], 0), 0, 5), 0.4),
                                (scale_to_score(parse_innings_pitched(_season_stat(pitcher_stats.get(opposing_pitcher_id)).get("inningsPitched")), 50, 180), 0.6),
                            ]
                        ),
                        "bullpenQualityEdge": 50.0,
                        "bullpenHandednessEdge": 50.0,
                        "restScore": 50.0,
                        "injuryAdjustment": 50.0,
                        "umpireZoneBoost": 50.0,
                        "catcherFramingEdge": 50.0,
                        "currentSplitPlateAppearances": split_sample,
                        "previousSeasonsPlateAppearances": historical_split_sample,
                        "careerPlateAppearances": career_split_sample,
                        "currentSeasonSkillScore": current_split_skill,
                        "historicalSkillScore": historical_split_skill,
                        "seasonGrowthPercent": hitter_growth_percent,
                        "isRookieSeason": is_rookie_season,
                        "rookieSeasonWarning": "First MLB season: lean more on current form and sample stability."
                        if is_rookie_season
                        else None,
                        "historicalConfidenceScore": historical_confidence,
                        "dataCoverageScore": data_coverage,
                        "sampleConfidenceScore": weighted_average(
                            [
                                (scale_to_score(split_sample, 20, 220), 0.30),
                                (historical_confidence, 0.30),
                                (scale_to_score(pitch_mix["sample"], 1, 16), 0.22),
                                (scale_to_score(bvp["plateAppearances"], 0, 14), 0.18),
                            ]
                        ),
                        "weatherDataQualityScore": 85.0 if game.get("weather") else 50.0,
                    }
                    hitters.append(
                        {
                            "playerId": entry["playerId"],
                            "playerName": entry["playerName"],
                            "team": team,
                            "opponent": opponent,
                            "bats": hitter_hand,
                            "opposingPitcherHand": opposing_hand,
                            "gameId": game["gameId"],
                            "matchupId": game["matchupId"],
                            "matchupLabel": game["matchupLabel"],
                            "metrics": hitter_metrics,
                            "notes": [
                                "MLB Stats API supplied current-season, historical split, career baseline, and game-log context.",
                                "Baseball Savant supplied Statcast quality-of-contact inputs.",
                                "Pitch mix fit and prior batter-vs-pitcher history are weighted by sample.",
                            ],
                            "source": "live",
                        }
                    )
        pitchers: list[dict] = []
        hitters_by_game_team = defaultdict(list)
        for hitter in hitters:
            hitters_by_game_team[(hitter["gameId"], hitter["team"]["abbreviation"])].append(hitter)
        for game in games:
            weather_boost = _weather_boost(game.get("weather"))
            for team, opponent, probable_pitcher, opponent_team_key, opponent_side in [
                (
                    game["awayTeam"],
                    game["homeTeam"],
                    game["probablePitchers"].get("away"),
                    game["homeTeam"]["abbreviation"],
                    "home",
                ),
                (
                    game["homeTeam"],
                    game["awayTeam"],
                    game["probablePitchers"].get("home"),
                    game["awayTeam"]["abbreviation"],
                    "away",
                ),
            ]:
                if not probable_pitcher or not probable_pitcher.get("playerId"):
                    continue
                pitcher_id = probable_pitcher["playerId"]
                person = pitcher_stats.get(pitcher_id)
                season_stat = _season_stat(person)
                career_stat = _career_stat(person)
                logs = _game_logs(person)
                savant_profile = pitcher_profiles.get(pitcher_id, {})
                overall_profile = savant_profile.get("overall") or {}
                arsenal = _to_pitch_arsenal(pitch_arsenal.get(pitcher_id, []))
                opposing_hitters = hitters_by_game_team.get((game["gameId"], opponent_team_key), [])
                season_totals = _pitcher_totals(season_stat)
                career_totals = _pitcher_totals(career_stat)
                historical_totals = _subtract_totals(career_totals, season_totals)
                current_pitcher_rates = _pitcher_rates_from_totals(season_totals, {})
                historical_pitcher_rates = _pitcher_rates_from_totals(historical_totals, current_pitcher_rates)
                career_pitcher_rates = _pitcher_rates_from_totals(career_totals, current_pitcher_rates)
                historical_batters_faced = historical_totals["battersFaced"]
                career_batters_faced = career_totals["battersFaced"]
                batters_faced = max(season_totals["battersFaced"], 1)
                innings_pitched = season_totals["inningsPitched"]
                strikeouts = season_totals["strikeOuts"]
                walks = season_totals["walks"]
                home_runs = season_totals["homeRuns"]
                ground_outs = season_totals["groundOuts"]
                air_outs = season_totals["airOuts"]
                starts = season_totals["gamesStarted"]
                recent7 = _recent_pitcher_form(logs, 2)
                recent14 = _recent_pitcher_form(logs, 4)
                recent30 = _recent_pitcher_form(logs, 8)
                recent_innings_values = [
                    parse_innings_pitched(log.get("inningsPitched"))
                    for log in logs[-6:]
                    if parse_innings_pitched(log.get("inningsPitched")) > 0
                ]
                recent_pitch_counts = [
                    _pitch_count(log)
                    for log in logs[-6:]
                    if _pitch_count(log) > 0
                ]
                recent_batters_faced_values = [
                    _batters_faced(log)
                    for log in logs[-6:]
                    if _batters_faced(log) > 0
                ]
                blended_walk_rate = _blend_value(
                    current_pitcher_rates["walkRate"],
                    batters_faced,
                    historical_pitcher_rates["walkRate"],
                    historical_batters_faced,
                    career_pitcher_rates["walkRate"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["walkRate"],
                    current_scale=1.35,
                    historical_scale=0.72,
                    career_scale=0.28,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=18.0,
                )
                average_pitch_count = average(
                    recent_pitch_counts,
                    clamp(parse_innings_pitched(season_stat.get("inningsPitched")) * 15.8, 72, 96),
                )
                last_pitch_count = recent_pitch_counts[-1] if recent_pitch_counts else average_pitch_count
                recent_innings_std = _standard_deviation(recent_innings_values)
                recent_batters_faced = average(
                    recent_batters_faced_values,
                    clamp(parse_innings_pitched(season_stat.get("inningsPitched")) * 4.2, 18, 29),
                )
                recent_walk_rate = average(
                    [
                        (parse_float(log.get("baseOnBalls"), 0) / _batters_faced(log)) * 100
                        for log in logs[-6:]
                        if _batters_faced(log) > 0
                    ],
                    blended_walk_rate,
                )
                average_batters_faced = max(
                    batters_faced / max(starts, 1.0),
                    recent_batters_faced,
                )
                recent_pitches_per_plate_appearance = average(
                    [
                        _pitch_count(log) / _batters_faced(log)
                        for log in logs[-6:]
                        if _pitch_count(log) > 0 and _batters_faced(log) > 0
                    ],
                    clamp(average_pitch_count / max(recent_batters_faced, 1.0), 3.55, 4.45),
                )
                pitches_per_plate_appearance = clamp(
                    average_pitch_count / max(average_batters_faced, 1.0),
                    3.55,
                    4.45,
                )
                recent_command_trend = clamp(
                    50.0 + (blended_walk_rate - recent_walk_rate) * 4.0,
                    15.0,
                    85.0,
                )
                recent_leash_trend = clamp(
                    50.0 + (last_pitch_count - average_pitch_count) * 2.1,
                    15.0,
                    85.0,
                )
                lineup_hitter_count = len(opposing_hitters)
                confirmed_hitter_count = sum(
                    1 for hitter in opposing_hitters if hitter["metrics"].get("lineupConfirmed", False)
                )
                lineup_confidence = clamp(
                    (lineup_hitter_count / 9) * 0.72
                    + (
                        (confirmed_hitter_count / lineup_hitter_count)
                        if lineup_hitter_count
                        else 0.0
                    )
                    * 0.28,
                    0.0,
                    1.0,
                )
                lineup_strikeout_rate_vs_hand = average(
                    [h["metrics"]["strikeoutRate"] for h in opposing_hitters],
                    22.0,
                )
                opponent_strikeout_rate = _raw_weighted_average(
                    [
                        (lineup_strikeout_rate_vs_hand, lineup_confidence),
                        (22.0, 1 - lineup_confidence),
                    ],
                    22.0,
                )
                lineup_power_rating = average(
                    [
                        weighted_average(
                            [
                                (scale_to_score(h["metrics"]["isoVsHandedness"], 0.09, 0.33), 0.34),
                                (scale_to_score(h["metrics"]["barrelRate"], 2, 20), 0.33),
                                (scale_to_score(h["metrics"]["hardHitRate"], 28, 58), 0.33),
                            ]
                        )
                        for h in opposing_hitters
                    ],
                    55.0,
                )
                opponent_power_rating = _raw_weighted_average(
                    [
                        (lineup_power_rating, lineup_confidence),
                        (55.0, 1 - lineup_confidence),
                    ],
                    55.0,
                )
                lineup_contact_quality = average(
                    [
                        weighted_average(
                            [
                                (h["metrics"]["hardHitRate"], 0.55),
                                (h["metrics"]["barrelRate"] * 4, 0.45),
                            ]
                        )
                        for h in opposing_hitters
                    ],
                    50.0,
                )
                opponent_contact_quality = _raw_weighted_average(
                    [
                        (lineup_contact_quality, lineup_confidence),
                        (50.0, 1 - lineup_confidence),
                    ],
                    50.0,
                )
                opponent_chase_rate = average(
                    [h["metrics"].get("chaseRate", 30.0) for h in opposing_hitters],
                    30.0,
                )
                opponent_patience_score = weighted_average(
                    [
                        (scale_to_score(average([h["metrics"].get("walkRate", 8.0) for h in opposing_hitters], 8.0), 5, 12), 0.58),
                        (inverse_scale_to_score(opponent_chase_rate, 22, 36), 0.42),
                    ],
                    fallback=50.0,
                )
                opponent_lineup_confirmed = bool(opposing_hitters) and confirmed_hitter_count == lineup_hitter_count
                opponent_lineup_source = _team_lineup_source(
                    (game.get("lineups") or {}).get(opponent_side) or []
                )
                lineup_pitch_mix_resistance = average(
                    [h["metrics"]["pitchMixMatchupScore"] for h in opposing_hitters],
                    50.0,
                )
                pitch_mix_advantage = clamp(
                    _raw_weighted_average(
                        [
                            (100 - lineup_pitch_mix_resistance, lineup_confidence),
                            (50.0, 1 - lineup_confidence),
                        ],
                        50.0,
                    ),
                    0.0,
                    100.0,
                )
                first_pitch_strike_rate = clamp(
                    60.5
                    - (blended_walk_rate - 8.0) * 1.6
                    + (min(38.0, overall_profile.get("whiffRate", 11.5) + 11.5) - 28.0) * 0.35,
                    54.0,
                    69.0,
                )
                zone_rate = clamp(
                    48.5
                    - (blended_walk_rate - 8.0) * 0.80
                    + (first_pitch_strike_rate - 61.0) * 0.32,
                    42.0,
                    56.0,
                )
                chase_induced_rate = clamp(
                    28.0
                    + (overall_profile.get("whiffRate", 11.5) - 11.5) * 0.75
                    + (pitch_mix_advantage - 50.0) * 0.06,
                    22.0,
                    38.0,
                )
                three_ball_count_rate = clamp(
                    16.5
                    + (blended_walk_rate - 8.0) * 1.35
                    - (first_pitch_strike_rate - 61.0) * 0.22
                    + (opponent_patience_score - 50.0) * 0.05
                    + (recent_pitches_per_plate_appearance - 3.9) * 2.4,
                    10.0,
                    30.0,
                )
                quick_hook_risk = weighted_average(
                    [
                        (scale_to_score(recent_innings_std, 0.15, 1.8), 0.28),
                        (100 - recent_leash_trend, 0.24),
                        (100 - weighted_average([(recent7, 0.45), (recent14, 0.35), (recent30, 0.20)]), 0.22),
                        (scale_to_score(blended_walk_rate, 4, 12), 0.14),
                        (scale_to_score(opponent_contact_quality, 40, 65), 0.12),
                    ],
                    fallback=48.0,
                )
                weather_run_prevention = clamp(100 - weather_boost + 50, 35, 80)
                avg_pitch_velocity = average([pitch["averageSpeed"] for pitch in arsenal], 93.0)
                historical_confidence = _history_confidence_score(
                    batters_faced,
                    historical_batters_faced,
                    career_batters_faced,
                    current_range=(60, 420),
                    historical_range=(120, 2600),
                    career_range=(220, 5200),
                )
                is_rookie_season = _is_rookie_season(person, analysis_date, historical_batters_faced)
                blended_era = _blend_value(
                    current_pitcher_rates["era"],
                    batters_faced,
                    historical_pitcher_rates["era"],
                    historical_batters_faced,
                    career_pitcher_rates["era"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["era"],
                    current_scale=1.40,
                    historical_scale=0.72,
                    career_scale=0.28,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=20.0,
                )
                blended_whip = _blend_value(
                    current_pitcher_rates["whip"],
                    batters_faced,
                    historical_pitcher_rates["whip"],
                    historical_batters_faced,
                    career_pitcher_rates["whip"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["whip"],
                    current_scale=1.40,
                    historical_scale=0.72,
                    career_scale=0.28,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=20.0,
                )
                blended_strikeout_rate = _blend_value(
                    current_pitcher_rates["strikeoutRate"],
                    batters_faced,
                    historical_pitcher_rates["strikeoutRate"],
                    historical_batters_faced,
                    career_pitcher_rates["strikeoutRate"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["strikeoutRate"],
                    current_scale=1.45,
                    historical_scale=0.70,
                    career_scale=0.25,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=22.0,
                )
                blended_home_run_rate = _blend_value(
                    current_pitcher_rates["homeRunRate"],
                    batters_faced,
                    historical_pitcher_rates["homeRunRate"],
                    historical_batters_faced,
                    career_pitcher_rates["homeRunRate"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["homeRunRate"],
                    current_scale=1.28,
                    historical_scale=0.74,
                    career_scale=0.30,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=18.0,
                )
                blended_ground_ball_rate = _blend_value(
                    current_pitcher_rates["groundBallRate"],
                    batters_faced,
                    historical_pitcher_rates["groundBallRate"],
                    historical_batters_faced,
                    career_pitcher_rates["groundBallRate"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["groundBallRate"],
                    current_scale=1.18,
                    historical_scale=0.68,
                    career_scale=0.26,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=14.0,
                )
                blended_fly_ball_rate = _blend_value(
                    current_pitcher_rates["flyBallRate"],
                    batters_faced,
                    historical_pitcher_rates["flyBallRate"],
                    historical_batters_faced,
                    career_pitcher_rates["flyBallRate"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["flyBallRate"],
                    current_scale=1.18,
                    historical_scale=0.68,
                    career_scale=0.26,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=14.0,
                )
                baseline_innings_per_start = _blend_value(
                    current_pitcher_rates["inningsPerStart"],
                    batters_faced,
                    historical_pitcher_rates["inningsPerStart"],
                    historical_batters_faced,
                    career_pitcher_rates["inningsPerStart"],
                    career_batters_faced,
                    fallback=current_pitcher_rates["inningsPerStart"] or 5.4,
                    current_scale=1.30,
                    historical_scale=0.72,
                    career_scale=0.26,
                    current_cap=520.0,
                    historical_cap=3200.0,
                    career_cap=5400.0,
                    current_bonus=16.0,
                )
                current_pitcher_skill = weighted_average(
                    [
                        (inverse_scale_to_score(current_pitcher_rates["era"], 2.2, 5.8), 0.32),
                        (scale_to_score(current_pitcher_rates["strikeoutRate"], 16, 34), 0.28),
                        (inverse_scale_to_score(current_pitcher_rates["walkRate"], 4, 12), 0.20),
                        (inverse_scale_to_score(current_pitcher_rates["homeRunRate"], 1, 5), 0.20),
                    ]
                )
                historical_pitcher_skill = weighted_average(
                    [
                        (inverse_scale_to_score(historical_pitcher_rates["era"], 2.2, 5.8), 0.32),
                        (scale_to_score(historical_pitcher_rates["strikeoutRate"], 16, 34), 0.28),
                        (inverse_scale_to_score(historical_pitcher_rates["walkRate"], 4, 12), 0.20),
                        (inverse_scale_to_score(historical_pitcher_rates["homeRunRate"], 1, 5), 0.20),
                    ]
                )
                pitcher_growth_percent = _percent_change(current_pitcher_skill, historical_pitcher_skill)
                park_factors = self.park_factor_service.get_factors(game["homeTeam"]["abbreviation"], "R")
                projected_batters_faced = clamp(
                    _raw_weighted_average(
                        [
                            (average_batters_faced, 0.34),
                            (recent_batters_faced, 0.28),
                            (
                                clamp(
                                    _raw_weighted_average(
                                        [
                                            (average([parse_innings_pitched(log.get("inningsPitched")) for log in logs[-4:]], baseline_innings_per_start), 0.62),
                                            (baseline_innings_per_start, 0.38),
                                        ],
                                        baseline_innings_per_start,
                                    ),
                                    4.5,
                                    7.2,
                                )
                                * 4.12,
                                0.38,
                            ),
                        ],
                        average_batters_faced,
                    ),
                    14.0,
                    30.0,
                )
                metrics = {
                    "era": blended_era,
                    "fip": parse_float(season_stat.get("fip"), blended_era * 0.92 + blended_walk_rate * 0.022),
                    "xFip": parse_float(season_stat.get("xFip"), blended_era * 0.96 + blended_home_run_rate * 0.12),
                    "whip": blended_whip,
                    "strikeoutRate": blended_strikeout_rate,
                    "walkRate": blended_walk_rate,
                    "swingingStrikeRate": overall_profile.get("whiffRate", 11.5),
                    "calledStrikePlusWhiffRate": min(38.0, overall_profile.get("whiffRate", 11.5) + 11.5),
                    "hardHitAllowed": overall_profile.get("hardHitRate", 38.0),
                    "barrelAllowed": overall_profile.get("barrelRate", 7.0),
                    "xwobaAllowed": overall_profile.get("xwoba", 0.320),
                    "xbaAllowed": overall_profile.get("xba", 0.245),
                    "xslgAllowed": overall_profile.get("xslg", 0.405),
                    "averageExitVelocityAllowed": overall_profile.get("averageExitVelocity", 89.0),
                    "homeRunRateAllowed": blended_home_run_rate,
                    "groundBallRate": blended_ground_ball_rate,
                    "flyBallRate": blended_fly_ball_rate,
                    "pitchUsage": arsenal,
                    "pitchVelocity": avg_pitch_velocity,
                    "pitchShapeScore": 55.0 if arsenal else 45.0,
                    "velocityScore": scale_to_score(avg_pitch_velocity, 88, 98),
                    "handednessSplits": {
                        "vsLeftXwoba": (savant_profile.get("vsLeft") or {}).get("xwoba", 0.320),
                        "vsRightXwoba": (savant_profile.get("vsRight") or {}).get("xwoba", 0.320),
                    },
                    "timesThroughOrderPenalty": scale_to_score(max(innings_pitched, 4.5), 4.5, 7.0),
                    "recentForm7": recent7,
                    "recentForm14": recent14,
                    "recentForm30": recent30,
                    "recentForm": weighted_average([(recent7, 0.45), (recent14, 0.35), (recent30, 0.20)]),
                    "inningsProjection": clamp(
                        _raw_weighted_average(
                            [
                                (average([parse_innings_pitched(log.get("inningsPitched")) for log in logs[-4:]], baseline_innings_per_start), 0.62),
                                (baseline_innings_per_start, 0.38),
                            ],
                            baseline_innings_per_start,
                        ),
                        4.5,
                        7.2,
                    ),
                    "gamesStarted": starts,
                    "battersFaced": batters_faced,
                    "previousSeasonsBattersFaced": historical_batters_faced,
                    "careerBattersFaced": career_batters_faced,
                    "currentSeasonSkillScore": current_pitcher_skill,
                    "historicalSkillScore": historical_pitcher_skill,
                    "seasonGrowthPercent": pitcher_growth_percent,
                    "isRookieSeason": is_rookie_season,
                    "rookieSeasonWarning": "First MLB season: track current form, workload, and command carefully."
                    if is_rookie_season
                    else None,
                    "recentBattersFaced": recent_batters_faced,
                    "averageBattersFaced": average_batters_faced,
                    "averageInningsPerStart": baseline_innings_per_start,
                    "recentInningsStd": recent_innings_std,
                    "averagePitchCount": average_pitch_count,
                    "lastPitchCount": last_pitch_count,
                    "pitchesPerPlateAppearance": pitches_per_plate_appearance,
                    "recentPitchesPerPlateAppearance": recent_pitches_per_plate_appearance,
                    "recentWalkRate": recent_walk_rate,
                    "recentCommandTrend": recent_command_trend,
                    "recentLeashTrend": recent_leash_trend,
                    "quickHookRisk": quick_hook_risk,
                    "projectedBattersFaced": projected_batters_faced,
                    "opponentStrikeoutRate": opponent_strikeout_rate,
                    "lineupStrikeoutRateVsHand": lineup_strikeout_rate_vs_hand,
                    "opponentWalkRate": average([h["metrics"]["walkRate"] for h in opposing_hitters], 8.0),
                    "opponentChaseRate": opponent_chase_rate,
                    "opponentPatienceScore": opponent_patience_score,
                    "opponentPowerRating": opponent_power_rating,
                    "opponentContactQuality": opponent_contact_quality,
                    "opponentLineupConfirmed": opponent_lineup_confirmed,
                    "opponentLineupSource": opponent_lineup_source,
                    "opponentLineupCount": lineup_hitter_count,
                    "opponentConfirmedHitterCount": confirmed_hitter_count,
                    "opponentLineupConfidenceScore": lineup_confidence * 100,
                    "parkFactor": game["venue"]["parkFactor"],
                    "homeRunParkFactor": park_factors["home_run_factor"],
                    "strikeoutParkFactor": park_factors["strikeout_factor"],
                    "walkParkFactor": park_factors["walk_factor"],
                    "weatherRunPreventionScore": weather_run_prevention,
                    "pitchMixAdvantageScore": pitch_mix_advantage,
                    "bullpenSupportScore": 50.0,
                    "framingSupportScore": 50.0,
                    "umpireZoneScore": 50.0,
                    "defenseSupportScore": 50.0,
                    "bullpenContextScore": 50.0,
                    "firstPitchStrikeRate": first_pitch_strike_rate,
                    "zoneRate": zone_rate,
                    "chaseInducedRate": chase_induced_rate,
                    "threeBallCountRate": three_ball_count_rate,
                    "restScore": 50.0,
                    "injuryAdjustment": 50.0,
                    "historicalConfidenceScore": historical_confidence,
                    "dataCoverageScore": weighted_average([(100 if overall_profile else 45, 0.30), (100 if arsenal else 58, 0.18), (100 if logs else 55, 0.16), (100 if game.get("weather") else 50, 0.14), (historical_confidence, 0.22)]),
                    "sampleConfidenceScore": weighted_average([(scale_to_score(batters_faced, 40, 420), 0.28), (scale_to_score(innings_pitched, 8, 120), 0.20), (historical_confidence, 0.32), (scale_to_score(baseline_innings_per_start, 4.5, 7.0), 0.20)]),
                    "weatherDataQualityScore": 85.0 if game.get("weather") else 50.0,
                    "winSupportRating": 50.0,
                }
                pitchers.append(
                    {
                        "playerId": probable_pitcher["playerId"],
                        "playerName": probable_pitcher["name"],
                        "team": team,
                        "opponent": opponent,
                        "throwingHand": _safe_handedness(probable_pitcher.get("throwingHand"))
                        if _safe_handedness(probable_pitcher.get("throwingHand")) != "U"
                        else _safe_handedness((person or {}).get("pitchHand")),
                        "gameId": game["gameId"],
                        "matchupId": game["matchupId"],
                        "matchupLabel": game["matchupLabel"],
                        "metrics": metrics,
                        "notes": [
                            "Pitcher profile blends current-season performance with previous-season history and a career baseline.",
                            "MLB workload/run-prevention context is stabilized before Statcast suppression data is layered in.",
                            "Pitch arsenal, recent form, and opponent swing-and-miss tendencies are included.",
                        ],
                        "source": "live",
                    }
                )
        return hitters, pitchers, notes
