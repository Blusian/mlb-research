from __future__ import annotations

import copy
from collections import defaultdict
from datetime import datetime, timezone

from app.core.config import get_settings
from app.data_sources.fangraphs import FangraphsSource
from app.models.schemas import DailyAnalysisResponse
from app.scoring.engine import (
    derive_home_run_probability,
    derive_pitcher_outs_prop,
    derive_pitcher_walk_prop,
    derive_strikeout_prop,
    score_hitter,
    score_pitcher,
)
from app.services.explanation_engine import build_hitter_reasons, build_pitcher_reasons
from app.services.filtering import filter_games, filter_hitters, filter_pitchers
from app.services.matchup_engine import MatchupEngine
from app.services.schedule_service import ScheduleService
from app.utils.cache import ResponseCache
from app.utils.math_utils import average, clamp, inverse_scale_to_score, quality_bucket, scale_to_score, weighted_average


HITTER_SCORE_SORTERS = {
    "overall_hit_score": lambda hitter: hitter["scores"]["overallHitScore"],
    "home_run_upside_score": lambda hitter: hitter["scores"]["homeRunUpsideScore"],
    "floor_score": lambda hitter: hitter["scores"]["floorScore"],
    "risk_score": lambda hitter: hitter["scores"]["riskScore"],
}

PITCHER_SCORE_SORTERS = {
    "overall_pitcher_score": lambda pitcher: pitcher["scores"]["overallPitcherScore"],
    "strikeout_upside_score": lambda pitcher: pitcher["scores"]["strikeoutUpsideScore"],
    "safety_score": lambda pitcher: pitcher["scores"]["safetyScore"],
    "blowup_risk_score": lambda pitcher: pitcher["scores"]["blowupRiskScore"],
}

PROP_CONFIDENCE_RANK = {
    "elite": 4,
    "core": 3,
    "strong": 2,
    "watch": 1,
    "thin": 0,
}

TEAM_RUN_BASELINE = 4.3
GAME_TOTAL_BASELINE = TEAM_RUN_BASELINE * 2

CONFIDENCE_RATING_SCORES = {
    "elite": 92.0,
    "core": 84.0,
    "strong": 76.0,
    "watch": 60.0,
    "thin": 44.0,
}


def _normalize_matchup_value(value: str | None) -> str:
    return str(value or "").replace(" at ", "@").replace(" ", "").upper()


def _expected_plate_appearances(lineup_spot: int, lineup_confirmed: bool) -> float:
    if lineup_spot <= 2:
        baseline = 4.7
    elif lineup_spot <= 5:
        baseline = 4.45
    elif lineup_spot <= 7:
        baseline = 4.15
    else:
        baseline = 3.95
    return baseline if lineup_confirmed else baseline - 0.2


def _hitter_lineup_source(metrics: dict) -> str:
    return str(metrics.get("lineupSource") or ("official" if metrics.get("lineupConfirmed") else "projected"))


def _pitcher_lineup_source(metrics: dict) -> str:
    explicit_source = metrics.get("opponentLineupSource")
    if explicit_source in {"official", "projected", "mixed"}:
        return explicit_source
    tracked_spots = int(metrics.get("opponentLineupCount", 0))
    confirmed_spots = int(metrics.get("opponentConfirmedHitterCount", 0))
    if tracked_spots >= 9 and confirmed_spots >= 9:
        return "official"
    if confirmed_spots <= 0:
        return "projected"
    return "mixed"


def _pitcher_lineup_confirmed(metrics: dict) -> bool:
    return _pitcher_lineup_source(metrics) == "official"


def _hitter_projection_multiplier(score: float, floor: float = 0.65, ceiling: float = 1.32) -> float:
    return max(min(0.82 + (score - 50) * 0.0065, ceiling), floor)


def _derive_hits_projection(hitter: dict) -> float:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    expected_pa = _expected_plate_appearances(metrics["lineupSpot"], metrics["lineupConfirmed"])
    expected_at_bats = expected_pa * (1 - metrics["walkRate"] / 100 * 0.65)
    score = scores.get("marketConfidence", {}).get("hits", {}).get(
        "score",
        scores["totalHitPotentialScore"],
    )
    return round(
        metrics["averageVsHandedness"]
        * expected_at_bats
        * _hitter_projection_multiplier(score),
        2,
    )


def _derive_total_bases_projection(hitter: dict) -> float:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    expected_pa = _expected_plate_appearances(metrics["lineupSpot"], metrics["lineupConfirmed"])
    expected_at_bats = expected_pa * (1 - metrics["walkRate"] / 100 * 0.58)
    slugging_vs_handedness = (
        metrics.get("sluggingVsHandedness")
        or metrics.get("xslgVsHandedness")
        or (metrics["averageVsHandedness"] + metrics["isoVsHandedness"])
    )
    market_score = scores.get("marketConfidence", {}).get("totalBases", {}).get(
        "score",
        scores["homeRunUpsideScore"],
    )
    score_blend = scores["totalHitPotentialScore"] * 0.55 + market_score * 0.45
    return round(
        slugging_vs_handedness
        * expected_at_bats
        * _hitter_projection_multiplier(score_blend),
        2,
    )


def _derive_runs_projection(hitter: dict) -> float:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    expected_pa = _expected_plate_appearances(metrics["lineupSpot"], metrics["lineupConfirmed"])
    on_base_rate = max(
        metrics["obpVsHandedness"],
        metrics["averageVsHandedness"] + (metrics["walkRate"] / 100) * 0.72,
    )
    lineup_multiplier = 1.12 if metrics["lineupSpot"] <= 2 else 1.04 if metrics["lineupSpot"] <= 4 else 0.96 if metrics["lineupSpot"] <= 6 else 0.88
    park_multiplier = max(min(metrics.get("parkFactorVsHandedness", 100.0) / 100.0, 1.14), 0.9)
    score = scores.get("marketConfidence", {}).get("runs", {}).get("score", scores["overallHitScore"])
    return round(
        expected_pa
        * on_base_rate
        * lineup_multiplier
        * park_multiplier
        * _hitter_projection_multiplier(score, 0.58, 1.38)
        * 0.54,
        2,
    )


def _derive_rbi_projection(hitter: dict) -> float:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    expected_pa = _expected_plate_appearances(metrics["lineupSpot"], metrics["lineupConfirmed"])
    production_rate = max(
        metrics["averageVsHandedness"] * (1.35 + metrics["isoVsHandedness"] * 2.0),
        0.22,
    )
    lineup_multiplier = 1.18 if 3 <= metrics["lineupSpot"] <= 5 else 1.02 if metrics["lineupSpot"] in {2, 6} else 0.8
    park_multiplier = max(
        min(
            (
                metrics.get("hitParkFactorVsHandedness", 100.0) * 0.45
                + metrics.get("homeRunParkFactorVsHandedness", 100.0) * 0.55
            )
            / 100.0,
            1.16,
        ),
        0.9,
    )
    score = scores.get("marketConfidence", {}).get("rbi", {}).get(
        "score",
        scores["homeRunUpsideScore"],
    )
    return round(
        expected_pa
        * production_rate
        * lineup_multiplier
        * park_multiplier
        * _hitter_projection_multiplier(score, 0.54, 1.42)
        * 0.42,
        2,
    )


def _derive_walks_projection(hitter: dict) -> float:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    expected_pa = _expected_plate_appearances(metrics["lineupSpot"], metrics["lineupConfirmed"])
    pitcher_walk_multiplier = max(
        min(0.92 + (metrics.get("opponentPitcherWalkRateAllowed", 8.0) - 8.0) * 0.03, 1.34),
        0.72,
    )
    score = scores.get("marketConfidence", {}).get("walks", {}).get(
        "score",
        scores["overallHitScore"],
    )
    return round(
        expected_pa
        * (metrics["walkRate"] / 100)
        * pitcher_walk_multiplier
        * _hitter_projection_multiplier(score, 0.58, 1.4),
        2,
    )


def _pitcher_prop_workload_snapshot(pitcher: dict) -> dict:
    metrics = pitcher["metrics"]
    expected_batters_faced = max(
        metrics.get("projectedBattersFaced") or metrics["inningsProjection"] * 4.15,
        8.0,
    )
    role_certainty = weighted_average(
        [
            (scale_to_score(metrics["inningsProjection"], 4.3, 6.9), 0.46),
            (inverse_scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.24),
            (scale_to_score(metrics.get("averagePitchCount", 85.0), 68, 102), 0.18),
            (metrics.get("opponentLineupConfidenceScore", 64.0), 0.12),
        ],
        fallback=58.0,
    )
    innings_volatility = weighted_average(
        [
            (scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.68),
            (scale_to_score(abs(metrics.get("recentForm7", metrics["recentForm"]) - metrics.get("recentForm30", metrics["recentForm"])), 0, 18), 0.32),
        ],
        fallback=38.0,
    )
    pitch_count_cap = weighted_average(
        [
            (inverse_scale_to_score(metrics.get("averagePitchCount", 85.0), 72, 102), 0.56),
            (inverse_scale_to_score(metrics.get("lastPitchCount", 88.0), 70, 108), 0.18),
            (scale_to_score(max(5.8 - metrics["inningsProjection"], 0), 0, 1.6), 0.26),
        ],
        fallback=42.0,
    )
    early_exit_risk = weighted_average(
        [
            (scale_to_score(metrics["walkRate"], 4, 12), 0.28),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 40, 65), 0.20),
            (scale_to_score(metrics["hardHitAllowed"], 28, 48), 0.18),
            (100 - metrics.get("recentForm", 50.0), 0.20),
            (scale_to_score(metrics["homeRunParkFactor"], 90, 120), 0.14),
        ],
        fallback=42.0,
    )
    lineup_confidence = metrics.get("opponentLineupConfidenceScore", 64.0)
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.32),
            (metrics.get("sampleConfidenceScore", 68.0), 0.26),
            (role_certainty, 0.16),
            (100 - early_exit_risk, 0.12),
            (lineup_confidence, 0.14),
        ],
        fallback=58.0,
    )
    return {
        "expectedBattersFaced": round(expected_batters_faced, 1),
        "roleCertainty": round(role_certainty, 1),
        "inningsVolatility": round(innings_volatility, 1),
        "pitchCountCap": round(pitch_count_cap, 1),
        "earlyExitRisk": round(early_exit_risk, 1),
        "lineupConfidence": round(lineup_confidence, 1),
        "confidenceScore": round(confidence_score, 1),
        "trackedLineupSpots": int(metrics.get("opponentLineupCount", 0)),
        "confirmedLineupSpots": int(metrics.get("opponentConfirmedHitterCount", 0)),
    }


def _derive_pitcher_walk_projection(pitcher: dict, workload: dict | None = None) -> tuple[float, float]:
    metrics = pitcher["metrics"]
    workload_snapshot = workload or _pitcher_prop_workload_snapshot(pitcher)
    matchup_walk_rate = clamp(
        metrics["walkRate"] * 0.74
        + metrics.get("opponentWalkRate", 8.0) * 0.26
        - (metrics.get("umpireZoneScore", 50.0) - 50.0) * 0.04
        - (metrics.get("pitchMixAdvantageScore", 50.0) - 50.0) * 0.015
        + (metrics.get("opponentContactQuality", 50.0) - 50.0) * 0.01,
        2.2,
        14.0,
    )
    workload_multiplier = clamp(
        0.92
        + workload_snapshot["roleCertainty"] * 0.0010
        - workload_snapshot["pitchCountCap"] * 0.0008
        - workload_snapshot["earlyExitRisk"] * 0.0009
        - workload_snapshot["inningsVolatility"] * 0.0005,
        0.78,
        1.08,
    )
    projection_value = clamp(
        workload_snapshot["expectedBattersFaced"] * (matchup_walk_rate / 100) * workload_multiplier,
        0.35,
        6.5,
    )
    return round(projection_value, 2), round(matchup_walk_rate, 1)


def _derive_pitcher_outs_projection(pitcher: dict, workload: dict | None = None) -> float:
    metrics = pitcher["metrics"]
    workload_snapshot = workload or _pitcher_prop_workload_snapshot(pitcher)
    projection_value = metrics["inningsProjection"] * 3.0
    workload_multiplier = clamp(
        0.96
        + workload_snapshot["roleCertainty"] * 0.0007
        - workload_snapshot["pitchCountCap"] * 0.0005
        - workload_snapshot["earlyExitRisk"] * 0.0007
        - workload_snapshot["inningsVolatility"] * 0.0004,
        0.84,
        1.06,
    )
    return round(clamp(projection_value * workload_multiplier, 6.0, 24.0), 2)


def _confidence_score(label: str | None) -> float:
    return CONFIDENCE_RATING_SCORES.get(str(label or "").lower(), 58.0)


def _opposing_pitcher_resistance(pitcher: dict | None) -> float:
    if not pitcher:
        return 50.0

    scores = pitcher["scores"]
    metrics = pitcher["metrics"]
    return weighted_average(
        [
            (scores["overallPitcherScore"], 0.34),
            (scores["safetyScore"], 0.28),
            (100 - scores["blowupRiskScore"], 0.20),
            (inverse_scale_to_score(metrics["era"], 2.2, 5.8), 0.10),
            (inverse_scale_to_score(metrics["whip"], 0.95, 1.55), 0.08),
        ],
        fallback=50.0,
    )


def _build_team_run_projection(
    game: dict,
    team_abbreviation: str,
    hitters: list[dict],
    opposing_pitcher: dict | None,
) -> dict:
    ordered_hitters = sorted(
        hitters,
        key=lambda hitter: hitter["metrics"].get("lineupSpot", 99),
    )[:9]
    tracked_hitter_count = len(ordered_hitters)
    confirmed_hitter_count = sum(
        1 for hitter in ordered_hitters if hitter["metrics"].get("lineupConfirmed", False)
    )
    lineup_coverage = clamp(tracked_hitter_count / 9.0, 0.25, 1.0)

    runs_projection = sum(_derive_runs_projection(hitter) for hitter in ordered_hitters)
    rbi_projection = sum(_derive_rbi_projection(hitter) for hitter in ordered_hitters)
    walks_projection = sum(_derive_walks_projection(hitter) for hitter in ordered_hitters)

    offensive_quality = weighted_average(
        [
            (
                average(
                    [
                        hitter["scores"].get("marketConfidence", {}).get("runs", {}).get("score", 50.0)
                        for hitter in ordered_hitters
                    ],
                    50.0,
                ),
                0.38,
            ),
            (
                average(
                    [hitter["scores"]["overallHitScore"] for hitter in ordered_hitters],
                    50.0,
                ),
                0.20,
            ),
            (
                average(
                    [
                        scale_to_score(hitter["metrics"]["obpVsHandedness"], 0.28, 0.43)
                        for hitter in ordered_hitters
                    ],
                    50.0,
                ),
                0.18,
            ),
            (
                average(
                    [hitter["scores"]["homeRunUpsideScore"] for hitter in ordered_hitters],
                    50.0,
                ),
                0.10,
            ),
            (
                average(
                    [hitter["metrics"]["recentForm"] for hitter in ordered_hitters],
                    50.0,
                ),
                0.14,
            ),
        ],
        fallback=50.0,
    )
    matchup_quality = weighted_average(
        [
            (
                average(
                    [hitter["metrics"]["batterVsPitcherScore"] for hitter in ordered_hitters],
                    50.0,
                ),
                0.28,
            ),
            (
                average(
                    [hitter["metrics"]["pitchMixMatchupScore"] for hitter in ordered_hitters],
                    50.0,
                ),
                0.28,
            ),
            (
                average(
                    [hitter["metrics"]["opponentPitcherContactAllowed"] for hitter in ordered_hitters],
                    50.0,
                ),
                0.24,
            ),
            (
                average(
                    [hitter["metrics"]["opponentPitcherPowerAllowed"] * 10 for hitter in ordered_hitters],
                    50.0,
                ),
                0.20,
            ),
        ],
        fallback=50.0,
    )
    environment_score = weighted_average(
        [
            (
                average(
                    [
                        scale_to_score(hitter["metrics"]["parkFactorVsHandedness"], 88, 120)
                        for hitter in ordered_hitters
                    ],
                    scale_to_score(game["venue"]["parkFactor"], 88, 120),
                ),
                0.46,
            ),
            (
                average(
                    [
                        scale_to_score(hitter["metrics"]["homeRunParkFactorVsHandedness"], 84, 126)
                        for hitter in ordered_hitters
                    ],
                    scale_to_score(game["venue"]["homeRunFactor"], 84, 126),
                ),
                0.18,
            ),
            (
                average(
                    [hitter["metrics"].get("weatherBoostScore", 50.0) for hitter in ordered_hitters],
                    50.0,
                ),
                0.22,
            ),
            (
                scale_to_score(
                    game["venue"]["parkFactor"] * 0.62 + game["venue"]["homeRunFactor"] * 0.38,
                    90,
                    114,
                ),
                0.14,
            ),
        ],
        fallback=50.0,
    )
    lineup_confidence = weighted_average(
        [
            (scale_to_score(tracked_hitter_count, 4, 9), 0.42),
            (scale_to_score(confirmed_hitter_count, 0, 9), 0.34),
            (
                average(
                    [
                        _confidence_score(hitter["scores"].get("confidenceRating"))
                        for hitter in ordered_hitters
                    ],
                    58.0,
                ),
                0.24,
            ),
        ],
        fallback=54.0,
    )
    pitcher_resistance = _opposing_pitcher_resistance(opposing_pitcher)

    base_projection = runs_projection * 0.78 + rbi_projection * 0.18 + walks_projection * 0.04
    pitcher_multiplier = clamp(1.0 + (50 - pitcher_resistance) * 0.0042, 0.80, 1.18)
    environment_multiplier = clamp(1.0 + (environment_score - 50) * 0.0032, 0.88, 1.14)

    projected_runs = base_projection * pitcher_multiplier * environment_multiplier
    projected_runs = projected_runs * lineup_coverage + TEAM_RUN_BASELINE * (1 - lineup_coverage)
    projected_runs = clamp(projected_runs, 2.0, 8.8)

    reasons: list[str] = []
    if offensive_quality >= 62:
        reasons.append("Lineup grades above average for on-base skills and run creation.")
    elif offensive_quality <= 45:
        reasons.append("Offensive profile is below average for sustained run creation.")

    if matchup_quality >= 58:
        reasons.append("Pitch-mix fit and batter-vs-pitcher context lean positive.")
    elif matchup_quality <= 44:
        reasons.append("Starter matchup quality leans against this lineup.")

    if pitcher_resistance <= 44:
        reasons.append("Opposing starter grades as attackable.")
    elif pitcher_resistance >= 64:
        reasons.append("Opposing starter projects as a run suppressor.")

    if environment_score >= 58:
        reasons.append("Park and weather raise the scoring environment.")
    elif environment_score <= 44:
        reasons.append("Park and weather suppress run scoring.")

    if tracked_hitter_count < 7:
        reasons.append("Projection is blended toward league average because lineup coverage is limited.")
    elif confirmed_hitter_count == tracked_hitter_count and tracked_hitter_count >= 8:
        reasons.append("Confirmed lineup raises confidence in the team total.")

    return {
        "teamAbbreviation": team_abbreviation,
        "projectedRuns": round(projected_runs, 1),
        "offensiveQuality": round(offensive_quality, 1),
        "matchupQuality": round(matchup_quality, 1),
        "opposingPitcherResistance": round(pitcher_resistance, 1),
        "environmentScore": round(environment_score, 1),
        "lineupConfidence": round(lineup_confidence, 1),
        "reasons": reasons[:3],
    }


def _attach_game_run_projections(games: list[dict], hitters: list[dict], pitchers: list[dict]) -> None:
    hitters_by_game_team: dict[tuple[str, str], list[dict]] = defaultdict(list)
    pitchers_by_game_team = {
        (pitcher["gameId"], pitcher["team"]["abbreviation"]): pitcher for pitcher in pitchers
    }

    for hitter in hitters:
        hitters_by_game_team[(hitter["gameId"], hitter["team"]["abbreviation"])].append(hitter)

    for game in games:
        away_team = game["awayTeam"]["abbreviation"]
        home_team = game["homeTeam"]["abbreviation"]

        away_projection = _build_team_run_projection(
            game,
            away_team,
            hitters_by_game_team.get((game["gameId"], away_team), []),
            pitchers_by_game_team.get((game["gameId"], home_team)),
        )
        home_projection = _build_team_run_projection(
            game,
            home_team,
            hitters_by_game_team.get((game["gameId"], home_team), []),
            pitchers_by_game_team.get((game["gameId"], away_team)),
        )

        total_runs = round(away_projection["projectedRuns"] + home_projection["projectedRuns"], 1)
        edge_vs_baseline = round(total_runs - GAME_TOTAL_BASELINE, 1)
        over_under_lean = (
            "over" if edge_vs_baseline >= 0.6 else "under" if edge_vs_baseline <= -0.6 else "neutral"
        )
        run_environment_score = round(scale_to_score(total_runs, 6.8, 10.6), 1)
        confidence_numeric = weighted_average(
            [
                (away_projection["lineupConfidence"], 0.28),
                (home_projection["lineupConfidence"], 0.28),
                (
                    average(
                        [
                            away_projection["offensiveQuality"],
                            home_projection["offensiveQuality"],
                        ],
                        50.0,
                    ),
                    0.12,
                ),
                (
                    average(
                        [
                            100 - away_projection["opposingPitcherResistance"],
                            100 - home_projection["opposingPitcherResistance"],
                        ],
                        50.0,
                    ),
                    0.16,
                ),
                (85.0 if game.get("weather") else 60.0, 0.16),
            ],
            fallback=58.0,
        )

        reasons: list[str] = []
        if total_runs >= GAME_TOTAL_BASELINE + 0.8:
            reasons.append("Both sides combine for an above-average scoring environment.")
        elif total_runs <= GAME_TOTAL_BASELINE - 0.8:
            reasons.append("This matchup projects below league-average for total runs.")

        if average(
            [away_projection["environmentScore"], home_projection["environmentScore"]],
            50.0,
        ) >= 58:
            reasons.append("Park and weather push the game toward higher scoring.")
        elif average(
            [away_projection["environmentScore"], home_projection["environmentScore"]],
            50.0,
        ) <= 44:
            reasons.append("Park and weather context mute offense.")

        average_pitcher_resistance = average(
            [
                away_projection["opposingPitcherResistance"],
                home_projection["opposingPitcherResistance"],
            ],
            50.0,
        )
        if average_pitcher_resistance <= 44:
            reasons.append("Both starters show enough vulnerability to open the total up.")
        elif average_pitcher_resistance >= 64:
            reasons.append("Starting pitching quality suppresses the total.")

        if game["lineupStatus"] == "confirmed":
            reasons.append("Confirmed lineups improve the confidence of the game total.")
        elif game["lineupStatus"] == "projected":
            reasons.append("Projected lineups lower confidence in the total.")

        lean_label = (
            "over lean" if over_under_lean == "over" else "under lean" if over_under_lean == "under" else "neutral lean"
        )
        game["runProjection"] = {
            "away": away_projection,
            "home": home_projection,
            "totalRuns": total_runs,
            "baselineTotal": GAME_TOTAL_BASELINE,
            "edgeVsBaseline": edge_vs_baseline,
            "runEnvironmentScore": run_environment_score,
            "overUnderLean": over_under_lean,
            "confidenceRating": quality_bucket(confidence_numeric),
            "summary": (
                f"Projected score {away_team} {away_projection['projectedRuns']:.1f}, "
                f"{home_team} {home_projection['projectedRuns']:.1f} "
                f"({total_runs:.1f} total, {lean_label})."
            ),
            "reasons": reasons[:3],
        }


class DailyAnalysisService:
    def __init__(
        self,
        schedule_service: ScheduleService | None = None,
        matchup_engine: MatchupEngine | None = None,
        cache: ResponseCache | None = None,
        fangraphs_source: FangraphsSource | None = None,
    ) -> None:
        self.settings = get_settings()
        self.schedule_service = schedule_service or ScheduleService()
        self.matchup_engine = matchup_engine or MatchupEngine()
        self.cache = cache or ResponseCache()
        self.fangraphs_source = fangraphs_source or FangraphsSource()

    def get_daily_analysis(self, query: dict, force_refresh: bool = False) -> dict:
        analysis_date = query.get("date") or self.settings.default_analysis_date
        if not analysis_date:
            analysis_date = datetime.now(timezone.utc).date().isoformat()
        cache_key = f"python-fastapi-analysis:v8:{analysis_date}"
        if force_refresh:
            self.cache.delete(cache_key)
        cached = None if force_refresh else self.cache.get(cache_key)
        if cached:
            return self._apply_filters(copy.deepcopy(cached), query, "hit")
        response = self._build_unfiltered_response(analysis_date)
        self.cache.set(cache_key, response)
        return self._apply_filters(copy.deepcopy(response), query, "miss")

    def _build_unfiltered_response(self, analysis_date: str) -> dict:
        games = self.schedule_service.get_games(analysis_date)
        hitters, pitchers, engine_notes = self.matchup_engine.build_candidates(games, analysis_date)
        for hitter in hitters:
            hitter["scores"] = score_hitter(hitter)
            hitter["reasons"] = build_hitter_reasons(hitter)
        for pitcher in pitchers:
            pitcher["scores"] = score_pitcher(pitcher)
            strikeout_breakdown = derive_strikeout_prop(pitcher)
            pitcher["metrics"]["projectedStrikeoutsVsOpponent"] = strikeout_breakdown["meanKs"]
            pitcher["metrics"]["medianStrikeoutsVsOpponent"] = strikeout_breakdown["medianKs"]
            pitcher["metrics"]["projectedBattersFaced"] = strikeout_breakdown["projectionLayer"]["expectedBattersFaced"]
            pitcher["metrics"]["lineupVsPitcherHandKRate"] = strikeout_breakdown["projectionLayer"]["lineupVsPitcherHandKRate"]
            pitcher["metrics"]["matchupAdjustedKRate"] = strikeout_breakdown["projectionLayer"]["matchupAdjustedKRate"]
            pitcher["metrics"]["opponentLineupConfidenceScore"] = strikeout_breakdown["projectionLayer"]["lineupConfidence"]
            pitcher["reasons"] = build_pitcher_reasons(pitcher)
        _attach_game_run_projections(games, hitters, pitchers)
        hitters.sort(key=lambda hitter: hitter["scores"]["overallHitScore"], reverse=True)
        pitchers.sort(key=lambda pitcher: pitcher["scores"]["overallPitcherScore"], reverse=True)
        pitchers_to_attack = []
        for pitcher in pitchers:
            attack_score = round(
                pitcher["scores"]["blowupRiskScore"] * 0.64 + (100 - pitcher["scores"]["safetyScore"]) * 0.36,
                1,
            )
            attack_entry = dict(pitcher)
            attack_entry["attackScore"] = attack_score
            attack_entry["attackReasons"] = pitcher["reasons"]
            pitchers_to_attack.append(attack_entry)
        pitchers_to_attack.sort(key=lambda pitcher: pitcher["attackScore"], reverse=True)
        home_run_candidates = sorted(hitters, key=lambda hitter: hitter["scores"]["homeRunUpsideScore"], reverse=True)
        hitter_hits_candidates = sorted(
            hitters,
            key=lambda hitter: hitter["scores"].get("marketConfidence", {}).get("hits", {}).get("score", 0),
            reverse=True,
        )
        hitter_runs_candidates = sorted(
            hitters,
            key=lambda hitter: hitter["scores"].get("marketConfidence", {}).get("runs", {}).get("score", 0),
            reverse=True,
        )
        hitter_rbis_candidates = sorted(
            hitters,
            key=lambda hitter: hitter["scores"].get("marketConfidence", {}).get("rbi", {}).get("score", 0),
            reverse=True,
        )
        hitter_total_bases_candidates = sorted(
            hitters,
            key=lambda hitter: hitter["scores"].get("marketConfidence", {}).get("totalBases", {}).get("score", 0),
            reverse=True,
        )
        hitter_walks_candidates = sorted(
            hitters,
            key=lambda hitter: hitter["scores"].get("marketConfidence", {}).get("walks", {}).get("score", 0),
            reverse=True,
        )
        hitters_to_avoid = sorted(
            hitters,
            key=lambda hitter: hitter["scores"]["riskScore"] * 0.65 + (100 - hitter["scores"]["floorScore"]) * 0.35,
            reverse=True,
        )
        probable_pitcher_names = [
            pitcher["name"]
            for game in games
            for pitcher in [game["probablePitchers"].get("away"), game["probablePitchers"].get("home")]
            if pitcher and pitcher.get("name")
        ]
        notes = [
            f"Python FastAPI analysis loaded {len(games)} games for {analysis_date}.",
            f"{sum(1 for game in games if game['lineupStatus'] == 'confirmed')} games have confirmed lineups.",
            "Game totals blend team run creation, opposing starter quality, park, weather, and lineup certainty.",
            *engine_notes,
            *self.fangraphs_source.get_support_notes(probable_pitcher_names),
        ]
        response = {
            "meta": {
                "analysisDate": analysis_date,
                "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "source": "live",
                "providerName": "python-fastapi-matchup-engine",
                "cacheStatus": "miss",
                "notes": notes,
            },
            "filters": {
                "teams": sorted(
                    {
                        game["awayTeam"]["abbreviation"]
                        for game in games
                    }
                    | {game["homeTeam"]["abbreviation"] for game in games}
                ),
                "matchups": [{"value": game["matchupId"], "label": game["matchupLabel"]} for game in games],
                "handedness": ["L", "R", "S"],
                "hitterScoreTypes": list(HITTER_SCORE_SORTERS.keys()),
                "pitcherScoreTypes": list(PITCHER_SCORE_SORTERS.keys()),
            },
            "games": games,
            "props": {
                "hitterHomeRuns": self._build_home_run_props(home_run_candidates),
                "hitterHits": self._build_hitter_stat_props(
                    hitter_hits_candidates,
                    market="hitter_hits",
                    confidence_key="hits",
                    label_suffix="hits",
                    line_value=1.5,
                    projection_fn=_derive_hits_projection,
                ),
                "hitterRuns": self._build_hitter_stat_props(
                    hitter_runs_candidates,
                    market="hitter_runs",
                    confidence_key="runs",
                    label_suffix="runs",
                    line_value=0.5,
                    projection_fn=_derive_runs_projection,
                ),
                "hitterRbis": self._build_hitter_stat_props(
                    hitter_rbis_candidates,
                    market="hitter_rbis",
                    confidence_key="rbi",
                    label_suffix="RBI",
                    line_value=0.5,
                    projection_fn=_derive_rbi_projection,
                ),
                "hitterTotalBases": self._build_hitter_stat_props(
                    hitter_total_bases_candidates,
                    market="hitter_total_bases",
                    confidence_key="totalBases",
                    label_suffix="total bases",
                    line_value=1.5,
                    projection_fn=_derive_total_bases_projection,
                ),
                "hitterWalks": self._build_hitter_stat_props(
                    hitter_walks_candidates,
                    market="hitter_walks",
                    confidence_key="walks",
                    label_suffix="walks",
                    line_value=0.5,
                    projection_fn=_derive_walks_projection,
                ),
                "pitcherStrikeouts": self._build_pitcher_props(pitchers),
                "pitcherWalks": self._build_pitcher_line_props(
                    pitchers,
                    market="pitcher_walks",
                    label_suffix="walks allowed",
                    line_value=2.5,
                ),
                "pitcherOuts": self._build_pitcher_line_props(
                    pitchers,
                    market="pitcher_outs",
                    label_suffix="outs recorded",
                    line_value=15.5,
                ),
            },
            "rankings": {
                "hitters": hitters,
                "homeRunCandidates": home_run_candidates,
                "hittersToAvoid": hitters_to_avoid,
                "pitchers": pitchers,
                "pitchersToAttack": pitchers_to_attack,
            },
        }
        return DailyAnalysisResponse.model_validate(response).model_dump()

    def _build_home_run_props(self, hitters: list[dict]) -> list[dict]:
        props = []
        for hitter in hitters:
            breakdown = derive_home_run_probability(hitter)
            blended = breakdown["blendedProbability"]
            confidence = "core" if blended >= 0.21 or hitter["scores"]["homeRunUpsideScore"] >= 80 else "strong" if blended >= 0.15 or hitter["scores"]["homeRunUpsideScore"] >= 70 else "watch"
            props.append(
                {
                    "market": "hitter_home_run",
                    "entityId": hitter["playerId"],
                    "gameId": hitter["gameId"],
                    "label": f"{hitter['playerName']} to hit a home run",
                    "playerName": hitter["playerName"],
                    "teamAbbreviation": hitter["team"]["abbreviation"],
                    "opponentAbbreviation": hitter["opponent"]["abbreviation"],
                    "matchupLabel": hitter["matchupLabel"],
                    "lineupSpot": hitter["metrics"]["lineupSpot"],
                    "lineupConfirmed": hitter["metrics"]["lineupConfirmed"],
                    "lineupSource": _hitter_lineup_source(hitter["metrics"]),
                    "homeRunScore": hitter["scores"]["homeRunUpsideScore"],
                    "blendedProbability": breakdown["blendedProbability"],
                    "heuristicProbability": breakdown["heuristicProbability"],
                    "learnedProbability": None,
                    "modelType": "heuristic",
                    "trainingSamples": 0,
                    "confidence": confidence,
                    "reasons": hitter["reasons"],
                    "metrics": {
                        "hardHitRate": hitter["metrics"]["hardHitRate"],
                        "barrelRate": hitter["metrics"]["barrelRate"],
                        "averageBatSpeed": hitter["metrics"]["averageBatSpeed"],
                        "blastRate": hitter["metrics"]["blastRate"],
                        "squaredUpRate": hitter["metrics"]["squaredUpRate"],
                        "batterVsPitcherPlateAppearances": hitter["metrics"]["batterVsPitcherPlateAppearances"],
                        "batterVsPitcherOps": hitter["metrics"]["batterVsPitcherOps"],
                        "batterVsPitcherHomeRuns": hitter["metrics"]["batterVsPitcherHomeRuns"],
                        "batterVsPitcherScore": hitter["metrics"]["batterVsPitcherScore"],
                        "pitchMixMatchupScore": hitter["metrics"]["pitchMixMatchupScore"],
                        "pitchMixMatchupSample": hitter["metrics"]["pitchMixMatchupSample"],
                        "primaryPitchTypeDescription": hitter["metrics"]["primaryPitchTypeDescription"],
                        "primaryPitchUsage": hitter["metrics"]["primaryPitchUsage"],
                        "secondaryPitchTypeDescription": hitter["metrics"]["secondaryPitchTypeDescription"],
                        "secondaryPitchUsage": hitter["metrics"]["secondaryPitchUsage"],
                        "homeRunParkFactor": hitter["metrics"]["homeRunParkFactor"],
                        "homeRunParkFactorVsHandedness": hitter["metrics"]["homeRunParkFactorVsHandedness"],
                        "opponentPitcherPowerAllowed": hitter["metrics"]["opponentPitcherPowerAllowed"],
                        "recentForm": hitter["metrics"]["recentForm"],
                    },
                }
            )
        return props

    def _build_hitter_stat_props(
        self,
        hitters: list[dict],
        market: str,
        confidence_key: str,
        label_suffix: str,
        line_value: float,
        projection_fn,
    ) -> list[dict]:
        props = []
        for hitter in hitters:
            market_confidence = hitter["scores"].get("marketConfidence", {}).get(confidence_key)
            if not market_confidence:
                continue
            projection_value = projection_fn(hitter)
            metrics = hitter["metrics"]
            props.append(
                {
                    "market": market,
                    "entityId": hitter["playerId"],
                    "gameId": hitter["gameId"],
                    "label": f"{hitter['playerName']} over {line_value:.1f} {label_suffix}",
                    "playerName": hitter["playerName"],
                    "teamAbbreviation": hitter["team"]["abbreviation"],
                    "opponentAbbreviation": hitter["opponent"]["abbreviation"],
                    "matchupLabel": hitter["matchupLabel"],
                    "lineupSpot": metrics["lineupSpot"],
                    "lineupConfirmed": metrics["lineupConfirmed"],
                    "lineupSource": _hitter_lineup_source(metrics),
                    "marketScore": market_confidence["score"],
                    "lineValue": line_value,
                    "projectionValue": projection_value,
                    "deltaVsLine": round(projection_value - line_value, 2),
                    "confidence": market_confidence["confidenceRating"],
                    "reasons": hitter["reasons"],
                    "metrics": {
                        "averageVsHandedness": metrics["averageVsHandedness"],
                        "obpVsHandedness": metrics["obpVsHandedness"],
                        "sluggingVsHandedness": metrics["sluggingVsHandedness"],
                        "isoVsHandedness": metrics["isoVsHandedness"],
                        "walkRate": metrics["walkRate"],
                        "strikeoutRate": metrics["strikeoutRate"],
                        "recentForm": metrics["recentForm"],
                        "batterVsPitcherScore": metrics["batterVsPitcherScore"],
                        "pitchMixMatchupScore": metrics["pitchMixMatchupScore"],
                        "opponentPitcherContactAllowed": metrics.get("opponentPitcherContactAllowed", 50.0),
                        "opponentPitcherWalkRateAllowed": metrics.get("opponentPitcherWalkRateAllowed", 8.0),
                        "parkFactorVsHandedness": metrics.get("parkFactorVsHandedness", 100.0),
                        "hitParkFactorVsHandedness": metrics.get("hitParkFactorVsHandedness", 100.0),
                        "walkParkFactorVsHandedness": metrics.get("walkParkFactorVsHandedness", 100.0),
                        "projectedPlateAppearances": round(
                            _expected_plate_appearances(
                                metrics["lineupSpot"],
                                metrics["lineupConfirmed"],
                            ),
                            2,
                        ),
                        "seasonGrowthPercent": metrics.get("seasonGrowthPercent"),
                        "isRookieSeason": metrics.get("isRookieSeason"),
                        "rookieSeasonWarning": metrics.get("rookieSeasonWarning"),
                    },
                }
            )
        props.sort(
            key=lambda prop: (
                PROP_CONFIDENCE_RANK.get(prop["confidence"], 0),
                prop["deltaVsLine"],
                prop["marketScore"],
            ),
            reverse=True,
        )
        return props

    def _build_pitcher_props(self, pitchers: list[dict]) -> list[dict]:
        props = []
        for pitcher in pitchers:
            breakdown = derive_strikeout_prop(pitcher)
            props.append(
                {
                    "market": "pitcher_strikeouts",
                    "entityId": pitcher["playerId"],
                    "gameId": pitcher["gameId"],
                    "label": f"{pitcher['playerName']} projected Ks vs {pitcher['opponent']['abbreviation']}",
                    "playerName": pitcher["playerName"],
                    "teamAbbreviation": pitcher["team"]["abbreviation"],
                    "opponentAbbreviation": pitcher["opponent"]["abbreviation"],
                    "matchupLabel": pitcher["matchupLabel"],
                    "lineupConfirmed": _pitcher_lineup_confirmed(pitcher["metrics"]),
                    "lineupSource": _pitcher_lineup_source(pitcher["metrics"]),
                    "strikeoutScore": pitcher["scores"]["strikeoutUpsideScore"],
                    "projectedStrikeouts": breakdown["meanKs"],
                    "meanKs": breakdown["meanKs"],
                    "medianKs": breakdown["medianKs"],
                    "over3_5Probability": breakdown["over3_5Probability"],
                    "over4_5Probability": breakdown["over4_5Probability"],
                    "inningsProjection": pitcher["metrics"]["inningsProjection"],
                    "confidence": breakdown["confidence"],
                    "reasons": pitcher["reasons"],
                    "metrics": {
                        "strikeoutRate": pitcher["metrics"]["strikeoutRate"],
                        "swingingStrikeRate": pitcher["metrics"]["swingingStrikeRate"],
                        "opponentStrikeoutRate": pitcher["metrics"]["opponentStrikeoutRate"],
                        "lineupVsPitcherHandKRate": pitcher["metrics"].get(
                            "lineupStrikeoutRateVsHand",
                            pitcher["metrics"]["opponentStrikeoutRate"],
                        ),
                        "pitchMixAdvantageScore": pitcher["metrics"].get("pitchMixAdvantageScore", 50.0),
                        "opponentLineupCount": pitcher["metrics"].get("opponentLineupCount", 0),
                        "opponentConfirmedHitterCount": pitcher["metrics"].get("opponentConfirmedHitterCount", 0),
                        "opponentLineupConfidenceScore": pitcher["metrics"].get(
                            "opponentLineupConfidenceScore",
                            breakdown["projectionLayer"]["lineupConfidence"],
                        ),
                        "strikeoutParkFactor": pitcher["metrics"]["strikeoutParkFactor"],
                        "walkRate": pitcher["metrics"]["walkRate"],
                        "projectionLayer": breakdown["projectionLayer"],
                        "riskLayer": breakdown["riskLayer"],
                    },
                }
            )
        return props

    def _build_pitcher_line_props(
        self,
        pitchers: list[dict],
        market: str,
        label_suffix: str,
        line_value: float,
    ) -> list[dict]:
        props = []
        for pitcher in pitchers:
            metrics = pitcher["metrics"]
            if market == "pitcher_walks":
                breakdown = derive_pitcher_walk_prop(pitcher, line_value)
                projection_value = breakdown["meanWalks"]
                market_score = weighted_average(
                    [
                        (scale_to_score(projection_value, 0.8, 3.8), 0.28),
                        (breakdown["overLineProbability"] * 100, 0.28),
                        (breakdown["confidenceScore"], 0.18),
                        (100 - breakdown["riskLayer"]["commandScore"], 0.14),
                        (breakdown["riskLayer"]["roleCertainty"], 0.12),
                    ],
                    fallback=50.0,
                )
            else:
                breakdown = derive_pitcher_outs_prop(pitcher, line_value)
                projection_value = breakdown["meanOuts"]
                market_score = weighted_average(
                    [
                        (scale_to_score(projection_value, 12, 20), 0.34),
                        (breakdown["overLineProbability"] * 100, 0.28),
                        (breakdown["confidenceScore"], 0.18),
                        (breakdown["riskLayer"]["roleCertainty"], 0.10),
                        (100 - breakdown["riskLayer"]["quickHookRisk"], 0.10),
                    ],
                    fallback=50.0,
                )

            props.append(
                {
                    "market": market,
                    "entityId": pitcher["playerId"],
                    "gameId": pitcher["gameId"],
                    "label": f"{pitcher['playerName']} over {line_value:.1f} {label_suffix}",
                    "playerName": pitcher["playerName"],
                    "teamAbbreviation": pitcher["team"]["abbreviation"],
                    "opponentAbbreviation": pitcher["opponent"]["abbreviation"],
                    "matchupLabel": pitcher["matchupLabel"],
                    "lineupConfirmed": _pitcher_lineup_confirmed(metrics),
                    "lineupSource": _pitcher_lineup_source(metrics),
                    "marketScore": round(market_score, 1),
                    "lineValue": line_value,
                    "projectionValue": projection_value,
                    "meanValue": projection_value,
                    "medianValue": breakdown["medianWalks"] if market == "pitcher_walks" else breakdown["medianOuts"],
                    "deltaVsLine": round(projection_value - line_value, 2),
                    "overLineProbability": breakdown["overLineProbability"],
                    "underLineProbability": breakdown["underLineProbability"],
                    "confidenceScore": breakdown["confidenceScore"],
                    "uncertaintyScore": breakdown["uncertaintyScore"],
                    "modelType": "hybrid_workload_command" if market == "pitcher_walks" else "hybrid_workload_survival",
                    "confidence": breakdown["confidence"],
                    "reasons": pitcher["reasons"],
                    "metrics": {
                        "inningsProjection": round(metrics["inningsProjection"], 1),
                        "projectedOuts": round(metrics["inningsProjection"] * 3.0, 1),
                        "expectedBattersFaced": breakdown["projectionLayer"]["projectedBattersFaced"],
                        "strikeoutRate": round(metrics["strikeoutRate"], 1),
                        "walkRate": round(metrics["walkRate"], 1),
                        "opponentWalkRate": round(metrics.get("opponentWalkRate", 8.0), 1),
                        "recentForm": round(metrics["recentForm"], 1),
                        "roleCertainty": breakdown["riskLayer"]["roleCertainty"],
                        "inningsVolatility": breakdown["riskLayer"]["inningsVolatility"],
                        "pitchCountCap": breakdown["riskLayer"]["pitchCountCap"],
                        "earlyExitRisk": breakdown["riskLayer"]["earlyExitRisk"],
                        "lineupConfidence": breakdown["riskLayer"]["lineupConfidence"],
                        "trackedLineupSpots": metrics.get("opponentLineupCount", 0),
                        "confirmedLineupSpots": metrics.get("opponentConfirmedHitterCount", 0),
                        "matchupAdjustedWalkRate": breakdown["projectionLayer"].get("matchupAdjustedWalkRate"),
                        "averagePitchCount": round(metrics.get("averagePitchCount", 85.0), 1),
                        "lastPitchCount": round(metrics.get("lastPitchCount", metrics.get("averagePitchCount", 85.0)), 1),
                        "averageBattersFaced": round(metrics.get("averageBattersFaced", metrics.get("recentBattersFaced", 0.0)), 1),
                        "averageInningsPerStart": round(metrics.get("averageInningsPerStart", metrics["inningsProjection"]), 2),
                        "pitchesPerPlateAppearance": round(metrics.get("pitchesPerPlateAppearance", 3.9), 2),
                        "recentPitchesPerPlateAppearance": round(metrics.get("recentPitchesPerPlateAppearance", metrics.get("pitchesPerPlateAppearance", 3.9)), 2),
                        "recentWalkRate": round(metrics.get("recentWalkRate", metrics["walkRate"]), 1),
                        "recentCommandTrend": round(metrics.get("recentCommandTrend", breakdown["riskLayer"].get("recentCommandTrend", 50.0)), 1),
                        "recentLeashTrend": round(metrics.get("recentLeashTrend", breakdown["riskLayer"].get("recentLeashTrend", 50.0)), 1),
                        "quickHookRisk": round(metrics.get("quickHookRisk", breakdown["riskLayer"].get("quickHookRisk", 50.0)), 1),
                        "walkParkFactor": round(metrics.get("walkParkFactor", metrics.get("parkFactor", 100.0)), 1),
                        "opponentChaseRate": round(metrics.get("opponentChaseRate", 29.5), 1),
                        "opponentPatienceScore": round(metrics.get("opponentPatienceScore", 50.0), 1),
                        "framingSupportScore": round(metrics.get("framingSupportScore", 50.0), 1),
                        "umpireZoneScore": round(metrics.get("umpireZoneScore", 50.0), 1),
                        "defenseSupportScore": round(metrics.get("defenseSupportScore", 50.0), 1),
                        "bullpenContextScore": round(metrics.get("bullpenContextScore", 50.0), 1),
                        "firstPitchStrikeRate": metrics.get("firstPitchStrikeRate"),
                        "zoneRate": metrics.get("zoneRate"),
                        "chaseInducedRate": metrics.get("chaseInducedRate"),
                        "threeBallCountRate": metrics.get("threeBallCountRate"),
                        "projectionLayer": breakdown["projectionLayer"],
                        "riskLayer": breakdown["riskLayer"],
                    },
                }
            )

        props.sort(
            key=lambda prop: (
                PROP_CONFIDENCE_RANK.get(prop["confidence"], 0),
                prop["deltaVsLine"],
                prop["marketScore"],
            ),
            reverse=True,
        )
        return props

    def _apply_filters(self, response: dict, query: dict, cache_status: str) -> dict:
        response["meta"]["cacheStatus"] = cache_status
        response["games"] = filter_games(response["games"], query)
        response["rankings"]["hitters"] = self._sort_hitters(filter_hitters(response["rankings"]["hitters"], query), query.get("hitterScoreType"))
        response["rankings"]["homeRunCandidates"] = filter_hitters(response["rankings"]["homeRunCandidates"], query)
        response["rankings"]["hittersToAvoid"] = filter_hitters(response["rankings"]["hittersToAvoid"], query)
        response["rankings"]["pitchers"] = self._sort_pitchers(filter_pitchers(response["rankings"]["pitchers"], query), query.get("pitcherScoreType"))
        response["rankings"]["pitchersToAttack"] = filter_pitchers(response["rankings"]["pitchersToAttack"], query)
        if query.get("team") and query["team"] != "ALL":
            for prop_key in (
                "hitterHomeRuns",
                "hitterHits",
                "hitterRuns",
                "hitterRbis",
                "hitterTotalBases",
                "hitterWalks",
                "pitcherStrikeouts",
                "pitcherWalks",
                "pitcherOuts",
            ):
                response["props"][prop_key] = [
                    prop
                    for prop in response["props"][prop_key]
                    if prop["teamAbbreviation"] == query["team"]
                ]
        if query.get("matchup") and query["matchup"] != "ALL":
            matchup_value = _normalize_matchup_value(query["matchup"])
            for prop_key in (
                "hitterHomeRuns",
                "hitterHits",
                "hitterRuns",
                "hitterRbis",
                "hitterTotalBases",
                "hitterWalks",
                "pitcherStrikeouts",
                "pitcherWalks",
                "pitcherOuts",
            ):
                response["props"][prop_key] = [
                    prop
                    for prop in response["props"][prop_key]
                    if _normalize_matchup_value(prop["matchupLabel"]) == matchup_value
                ]
        return response

    @staticmethod
    def _sort_hitters(hitters: list[dict], score_type: str | None) -> list[dict]:
        if score_type not in HITTER_SCORE_SORTERS:
            return hitters
        return sorted(hitters, key=HITTER_SCORE_SORTERS[score_type], reverse=True)

    @staticmethod
    def _sort_pitchers(pitchers: list[dict], score_type: str | None) -> list[dict]:
        if score_type not in PITCHER_SCORE_SORTERS:
            return pitchers
        return sorted(pitchers, key=PITCHER_SCORE_SORTERS[score_type], reverse=True)
