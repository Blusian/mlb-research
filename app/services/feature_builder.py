from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from app.utils.math_utils import average, clamp, inverse_scale_to_score, quality_bucket, scale_to_score, weighted_average


DEFAULT_COMPONENT_WEIGHTS = {
    "season": 0.55,
    "recent30": 0.20,
    "vs_hand": 0.15,
    "career": 0.10,
}

STABILIZATION_ANCHORS = {
    "strikeout_rate": 70.0,
    "walk_rate": 170.0,
    "single_rate": 670.0,
    "extra_base_rate": 1450.0,
}


def numeric_weighted_average(entries: Iterable[tuple[float | None, float]], fallback: float) -> float:
    usable = [(float(value), float(weight)) for value, weight in entries if value is not None and weight > 0]
    if not usable:
        return fallback
    total_weight = sum(weight for _, weight in usable)
    if total_weight <= 0:
        return fallback
    return sum(value * weight for value, weight in usable) / total_weight


def stabilization_weight(
    sample: float | None,
    anchor: float,
    *,
    minimum_weight: float = 0.08,
    maximum_weight: float = 0.96,
) -> float:
    if not sample or sample <= 0:
        return minimum_weight
    return clamp(sample / max(anchor, 1.0), minimum_weight, maximum_weight)


def empirical_bayes_rate(
    *,
    season_value: float | None,
    season_sample: float,
    recent30_value: float | None = None,
    recent30_sample: float = 0.0,
    vs_hand_value: float | None = None,
    vs_hand_sample: float = 0.0,
    career_value: float | None = None,
    career_sample: float = 0.0,
    anchor: float,
    fallback: float,
) -> float:
    prior = numeric_weighted_average(
        [
            (season_value, DEFAULT_COMPONENT_WEIGHTS["season"]),
            (recent30_value, DEFAULT_COMPONENT_WEIGHTS["recent30"]),
            (vs_hand_value, DEFAULT_COMPONENT_WEIGHTS["vs_hand"]),
            (career_value, DEFAULT_COMPONENT_WEIGHTS["career"]),
        ],
        fallback,
    )
    entries: list[tuple[float, float]] = []
    prior_weight = 0.0
    components = [
        ("season", season_value, season_sample),
        ("recent30", recent30_value, recent30_sample),
        ("vs_hand", vs_hand_value, vs_hand_sample),
        ("career", career_value, career_sample),
    ]
    for key, value, sample in components:
        if value is None:
            prior_weight += DEFAULT_COMPONENT_WEIGHTS[key]
            continue
        confidence = stabilization_weight(sample, anchor)
        entries.append((float(value), DEFAULT_COMPONENT_WEIGHTS[key] * confidence))
        prior_weight += DEFAULT_COMPONENT_WEIGHTS[key] * (1 - confidence)
    entries.append((prior, max(prior_weight, 0.05)))
    return numeric_weighted_average(entries, prior)


def distribution_to_map(distribution: list[float], *, min_probability: float = 0.001) -> dict[str, float]:
    mapped: dict[str, float] = {}
    for index, probability in enumerate(distribution):
        if probability >= min_probability:
            mapped[str(index)] = round(probability, 4)
    return mapped


def distribution_mean(distribution: list[float]) -> float:
    return sum(index * probability for index, probability in enumerate(distribution))


def distribution_variance(distribution: list[float]) -> float:
    mean = distribution_mean(distribution)
    return sum(((index - mean) ** 2) * probability for index, probability in enumerate(distribution))


def distribution_median(distribution: list[float]) -> float:
    cumulative = 0.0
    for index, probability in enumerate(distribution):
        cumulative += probability
        if cumulative >= 0.5:
            return float(index)
    return float(max(len(distribution) - 1, 0))


def build_hitter_opportunity(metrics: dict) -> dict:
    lineup_spot = int(metrics.get("lineupSpot", 9) or 9)
    if lineup_spot <= 2:
        baseline_pa = 4.78
    elif lineup_spot <= 5:
        baseline_pa = 4.48
    elif lineup_spot <= 7:
        baseline_pa = 4.16
    else:
        baseline_pa = 3.92
    playing_time_confidence = clamp(metrics.get("playingTimeConfidence", 78.0), 35.0, 100.0)
    lineup_confirmed = bool(metrics.get("lineupConfirmed", False))
    lineup_confidence = weighted_average(
        [
            (100.0 if lineup_confirmed else 72.0, 0.56),
            (playing_time_confidence, 0.44),
        ],
        fallback=72.0,
    )
    projected_plate_appearances = clamp(
        baseline_pa
        * (0.88 + (playing_time_confidence - 50.0) * 0.0032)
        * (1.02 if lineup_confirmed else 0.97),
        2.8,
        5.6,
    )
    return {
        "projectedPlateAppearances": round(projected_plate_appearances, 2),
        "playingTimeConfidence": round(playing_time_confidence, 1),
        "lineupConfidence": round(lineup_confidence, 1),
    }


def build_pitcher_opportunity(metrics: dict) -> dict:
    innings_projection = max(metrics.get("inningsProjection", 5.4), 3.5)
    average_batters_faced = max(
        metrics.get("averageBattersFaced")
        or metrics.get("recentBattersFaced")
        or (metrics.get("battersFaced", 0.0) / max(metrics.get("gamesStarted", 0.0), 1.0))
        or innings_projection * 4.15,
        14.0,
    )
    recent_batters_faced = max(metrics.get("recentBattersFaced", average_batters_faced), 12.0)
    pitches_per_plate_appearance = clamp(
        metrics.get("pitchesPerPlateAppearance")
        or (metrics.get("averagePitchCount", innings_projection * 15.8) / max(average_batters_faced, 1.0)),
        3.45,
        4.75,
    )
    recent_pitches_per_plate_appearance = clamp(
        metrics.get("recentPitchesPerPlateAppearance", pitches_per_plate_appearance),
        3.40,
        4.90,
    )
    average_pitch_count = metrics.get("averagePitchCount", clamp(innings_projection * 15.8, 70.0, 104.0))
    last_pitch_count = metrics.get("lastPitchCount", average_pitch_count)
    pitch_budget = numeric_weighted_average(
        [
            (average_pitch_count, 0.45),
            (last_pitch_count, 0.24),
            (innings_projection * 15.8, 0.31),
        ],
        average_pitch_count,
    )
    baseline_expected_batters_faced = numeric_weighted_average(
        [
            (average_batters_faced, 0.38),
            (recent_batters_faced, 0.28),
            (innings_projection * 4.15, 0.34),
        ],
        innings_projection * 4.15,
    )
    recent_leash_trend = clamp(
        metrics.get("recentLeashTrend", 50.0 + (last_pitch_count - average_pitch_count) * 2.1),
        10.0,
        90.0,
    )
    quick_hook_risk = clamp(
        metrics.get(
            "quickHookRisk",
            weighted_average(
                [
                    (scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.26),
                    (100 - recent_leash_trend, 0.24),
                    (scale_to_score(metrics.get("walkRate", 8.0), 4.0, 12.0), 0.18),
                    (100 - metrics.get("recentForm", 50.0), 0.16),
                    (scale_to_score(metrics.get("opponentPatienceScore", 50.0), 35.0, 70.0), 0.16),
                ],
                fallback=48.0,
            ),
        ),
        12.0,
        92.0,
    )
    role_certainty = weighted_average(
        [
            (scale_to_score(innings_projection, 4.2, 6.9), 0.28),
            (scale_to_score(pitch_budget, 70.0, 102.0), 0.24),
            (inverse_scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.16),
            (recent_leash_trend, 0.16),
            (metrics.get("opponentLineupConfidenceScore", 64.0), 0.16),
        ],
        fallback=58.0,
    )
    innings_volatility = weighted_average(
        [
            (scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.52),
            (scale_to_score(abs(recent_batters_faced - average_batters_faced), 0.0, 4.6), 0.20),
            (
                scale_to_score(
                    abs(metrics.get("recentForm7", metrics.get("recentForm", 50.0)) - metrics.get("recentForm30", metrics.get("recentForm", 50.0))),
                    0.0,
                    18.0,
                ),
                0.14,
            ),
            (quick_hook_risk, 0.14),
        ],
        fallback=42.0,
    )
    pitch_count_cap = weighted_average(
        [
            (inverse_scale_to_score(pitch_budget, 72.0, 102.0), 0.54),
            (inverse_scale_to_score(last_pitch_count, 70.0, 108.0), 0.18),
            (scale_to_score(max(5.9 - innings_projection, 0.0), 0.0, 1.8), 0.14),
            (100 - recent_leash_trend, 0.14),
        ],
        fallback=42.0,
    )
    early_exit_risk = weighted_average(
        [
            (scale_to_score(metrics.get("walkRate", 8.0), 4.0, 12.0), 0.24),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 40.0, 65.0), 0.18),
            (scale_to_score(metrics.get("hardHitAllowed", 35.0), 28.0, 48.0), 0.16),
            (100 - metrics.get("recentForm", 50.0), 0.18),
            (scale_to_score(metrics.get("homeRunParkFactor", 100.0), 90.0, 120.0), 0.12),
            (quick_hook_risk, 0.12),
        ],
        fallback=44.0,
    )
    projected_batters_faced = clamp(
        numeric_weighted_average(
            [
                (baseline_expected_batters_faced, 0.52),
                (pitch_budget / max(recent_pitches_per_plate_appearance, 3.3), 0.28),
                (metrics.get("projectedBattersFaced"), 0.20),
            ],
            baseline_expected_batters_faced,
        )
        * clamp(
            0.93
            + role_certainty * 0.0009
            - pitch_count_cap * 0.0005
            - early_exit_risk * 0.0006,
            0.80,
            1.08,
        ),
        12.0,
        30.0,
    )
    lineup_confidence = clamp(metrics.get("opponentLineupConfidenceScore", 64.0), 35.0, 100.0)
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.30),
            (metrics.get("sampleConfidenceScore", 68.0), 0.24),
            (role_certainty, 0.18),
            (100 - early_exit_risk, 0.12),
            (lineup_confidence, 0.16),
        ],
        fallback=58.0,
    )
    return {
        "averageBattersFaced": round(average_batters_faced, 1),
        "recentBattersFaced": round(recent_batters_faced, 1),
        "pitchesPerPlateAppearance": round(pitches_per_plate_appearance, 2),
        "recentPitchesPerPlateAppearance": round(recent_pitches_per_plate_appearance, 2),
        "pitchBudget": round(pitch_budget, 1),
        "baselineExpectedBattersFaced": round(baseline_expected_batters_faced, 1),
        "projectedBattersFaced": round(projected_batters_faced, 1),
        "roleCertainty": round(role_certainty, 1),
        "recentLeashTrend": round(recent_leash_trend, 1),
        "quickHookRisk": round(quick_hook_risk, 1),
        "inningsVolatility": round(innings_volatility, 1),
        "pitchCountCap": round(pitch_count_cap, 1),
        "earlyExitRisk": round(early_exit_risk, 1),
        "lineupConfidence": round(lineup_confidence, 1),
        "confidenceScore": round(confidence_score, 1),
        "trackedLineupSpots": int(metrics.get("opponentLineupCount", 0)),
        "confirmedLineupSpots": int(metrics.get("opponentConfirmedHitterCount", 0)),
    }


def build_data_quality_flags(
    metrics: dict,
    *,
    lineup_confirmed: bool,
    market: str,
    required_features: Iterable[str] | None = None,
) -> list[str]:
    flags: list[str] = []
    if not lineup_confirmed:
        flags.append("projected_lineup")
    if metrics.get("dataCoverageScore", 100.0) < 72:
        flags.append("limited_data_coverage")
    if metrics.get("sampleConfidenceScore", 100.0) < 64:
        flags.append("sparse_sample")
    if metrics.get("weatherDataQualityScore", 100.0) < 70:
        flags.append("weather_fallback")
    if market.startswith("pitcher_") and int(metrics.get("opponentLineupCount", 9)) < 9:
        flags.append("incomplete_opponent_lineup")
    if market.startswith("hitter_") and metrics.get("playingTimeConfidence", 100.0) < 80:
        flags.append("uncertain_playing_time")
    missing = [feature for feature in required_features or [] if metrics.get(feature) is None]
    if missing:
        flags.append(f"missing_features:{','.join(missing[:4])}")
    return flags


def feature_snapshot_timestamp(reference_timestamp: str | None = None) -> str:
    if reference_timestamp:
        return reference_timestamp
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def rule_era_flag(analysis_date: str | None) -> str:
    year = int(str(analysis_date or "")[:4] or 0)
    return "post_abs_2026" if year >= 2026 else "pre_abs_2026"


def summarize_probability_confidence(confidence_score: float) -> str:
    return quality_bucket(confidence_score)


def build_count_probabilities(probabilities: list[float]) -> list[float]:
    distribution = [1.0]
    for probability in probabilities:
        clipped = clamp(probability, 0.0, 1.0)
        next_distribution = [0.0] * (len(distribution) + 1)
        for count, existing_probability in enumerate(distribution):
            next_distribution[count] += existing_probability * (1 - clipped)
            next_distribution[count + 1] += existing_probability * clipped
        distribution = next_distribution
    total_probability = sum(distribution)
    if total_probability <= 0:
        return [1.0]
    return [value / total_probability for value in distribution]


def line_probabilities_from_distribution(distribution: list[float], line_value: float) -> tuple[float, float]:
    threshold = int(line_value // 1)
    over_probability = clamp(sum(distribution[threshold + 1 :]), 0.01, 0.99)
    under_probability = clamp(1 - over_probability, 0.01, 0.99)
    return over_probability, under_probability


def relative_uncertainty_score(mean_value: float, variance: float, volatility: float) -> float:
    if mean_value <= 0:
        return 60.0
    spread = (variance ** 0.5) / max(mean_value, 0.1)
    return weighted_average(
        [
            (scale_to_score(spread, 0.18, 1.05), 0.58),
            (volatility, 0.42),
        ],
        fallback=48.0,
    )


def mean_from_map(mapped_distribution: dict[str, float]) -> float:
    return average([int(key) * probability for key, probability in mapped_distribution.items()], 0.0)
