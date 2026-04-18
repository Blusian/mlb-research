from __future__ import annotations

import math

from app.scoring.weights import HITTER_WEIGHTS, PITCHER_WEIGHTS
from app.utils.math_utils import (
    clamp,
    inverse_scale_to_score,
    lineup_spot_score,
    logistic,
    quality_bucket,
    scale_to_score,
    weighted_average,
)


def _runs_lineup_score(spot: int) -> float:
    mapping = {
        1: 95,
        2: 100,
        3: 90,
        4: 82,
        5: 74,
        6: 66,
        7: 58,
        8: 50,
        9: 62,
    }
    return mapping.get(spot, 55)


def _rbi_lineup_score(spot: int) -> float:
    mapping = {
        1: 60,
        2: 76,
        3: 100,
        4: 96,
        5: 88,
        6: 72,
        7: 60,
        8: 48,
        9: 42,
    }
    return mapping.get(spot, 55)


def _market_confidence_entry(score: float, data_confidence: float, lineup_confirmed: bool) -> dict:
    confidence_value = weighted_average(
        [
            (score, 0.80),
            (data_confidence, 0.16),
            (100 if lineup_confirmed else 72, 0.04),
        ]
    )
    return {
        "score": round(score, 1),
        "confidenceRating": quality_bucket(confidence_value),
    }


def score_hitter(hitter: dict) -> dict:
    metrics = hitter["metrics"]
    split_skill = weighted_average(
        [
            (scale_to_score(metrics["averageVsHandedness"], 0.21, 0.34), 0.15),
            (scale_to_score(metrics["obpVsHandedness"], 0.28, 0.43), 0.18),
            (scale_to_score(metrics["sluggingVsHandedness"], 0.32, 0.67), 0.18),
            (scale_to_score(metrics["opsVsHandedness"], 0.62, 1.08), 0.16),
            (scale_to_score(metrics["wobaVsHandedness"], 0.28, 0.45), 0.15),
            (scale_to_score(metrics["xwobaVsHandedness"], 0.28, 0.45), 0.18),
        ]
    )
    power = weighted_average(
        [
            (scale_to_score(metrics["isoVsHandedness"], 0.09, 0.33), 0.18),
            (scale_to_score(metrics["barrelRate"], 2, 20), 0.18),
            (scale_to_score(metrics["hardHitRate"], 28, 58), 0.16),
            (scale_to_score(metrics["averageExitVelocity"], 86, 96), 0.14),
            (scale_to_score(metrics["launchAngle"], 8, 22), 0.10),
            (scale_to_score(metrics["pullRate"], 30, 52), 0.10),
            (scale_to_score(metrics["flyBallRate"], 25, 52), 0.14),
        ]
    )
    discipline = weighted_average(
        [
            (inverse_scale_to_score(metrics["strikeoutRate"], 12, 35), 0.24),
            (scale_to_score(metrics["walkRate"], 4, 16), 0.14),
            (inverse_scale_to_score(metrics["chaseRate"], 22, 42), 0.16),
            (inverse_scale_to_score(metrics["whiffRate"], 18, 38), 0.16),
            (scale_to_score(metrics["contactRate"], 64, 88), 0.15),
            (scale_to_score(metrics["zoneContactRate"], 74, 94), 0.15),
        ]
    )
    contact_quality = weighted_average(
        [
            (scale_to_score(metrics["hardHitRate"], 28, 58), 0.20),
            (scale_to_score(metrics["barrelRate"], 2, 20), 0.20),
            (scale_to_score(metrics["averageExitVelocity"], 86, 96), 0.18),
            (scale_to_score(metrics["lineDriveRate"], 16, 30), 0.12),
            (scale_to_score(metrics["averageBatSpeed"], 68, 79), 0.14),
            (scale_to_score(metrics["squaredUpRate"], 18, 42), 0.16),
        ]
    )
    recent_form = weighted_average(
        [
            (metrics["recentForm7"], 0.4),
            (metrics["recentForm14"], 0.35),
            (metrics["recentForm30"], 0.25),
        ]
    )
    matchup_fit = weighted_average(
        [
            (metrics["batterVsPitcherScore"], 0.15),
            (metrics["pitchMixMatchupScore"], 0.27),
            (metrics["velocityBandScore"], 0.12),
            (metrics["zoneMatchupScore"], 0.12),
            (metrics["movementMatchupScore"], 0.08),
            (metrics["pitcherWeaknessExploitScore"], 0.18),
            (metrics["starterExposureScore"], 0.08),
        ]
    )
    environment = weighted_average(
        [
            (scale_to_score(metrics["parkFactorVsHandedness"], 88, 120), 0.20),
            (scale_to_score(metrics["hitParkFactorVsHandedness"], 88, 120), 0.18),
            (scale_to_score(metrics["homeRunParkFactorVsHandedness"], 84, 126), 0.22),
            (scale_to_score(metrics["weatherBoostScore"], 35, 70), 0.20),
            (scale_to_score(metrics["altitudeBoostScore"], 45, 80), 0.10),
            (metrics["homeAwayAdjustment"], 0.10),
        ]
    )
    context = weighted_average(
        [
            (lineup_spot_score(metrics["lineupSpot"]), 0.24),
            (100 if metrics["lineupConfirmed"] else 72, 0.10),
            (metrics["playingTimeConfidence"], 0.20),
            (metrics["bullpenQualityEdge"], 0.12),
            (metrics["bullpenHandednessEdge"], 0.10),
            (metrics["restScore"], 0.08),
            (metrics["injuryAdjustment"], 0.06),
            (metrics["umpireZoneBoost"], 0.05),
            (metrics["catcherFramingEdge"], 0.05),
        ]
    )
    total_hit_potential = weighted_average(
        [
            (split_skill, HITTER_WEIGHTS["hits"]["split_skill"]),
            (weighted_average([(discipline, 0.58), (contact_quality, 0.42)]), HITTER_WEIGHTS["hits"]["bat_to_ball"]),
            (scale_to_score(metrics["obpVsHandedness"], 0.28, 0.43), HITTER_WEIGHTS["hits"]["on_base"]),
            (matchup_fit, HITTER_WEIGHTS["hits"]["matchup_fit"]),
            (environment, HITTER_WEIGHTS["hits"]["environment"]),
            (recent_form, HITTER_WEIGHTS["hits"]["recent_form"]),
            (context, HITTER_WEIGHTS["hits"]["context"]),
        ]
    )
    home_run_upside = weighted_average(
        [
            (power, HITTER_WEIGHTS["home_run"]["raw_power"]),
            (scale_to_score(metrics["barrelRate"], 2, 20), HITTER_WEIGHTS["home_run"]["barrels"]),
            (weighted_average([(scale_to_score(metrics["launchAngle"], 10, 24), 0.55), (scale_to_score(metrics["flyBallRate"], 25, 52), 0.45)]), HITTER_WEIGHTS["home_run"]["airball_shape"]),
            (metrics["pitcherDamageScore"], HITTER_WEIGHTS["home_run"]["pitcher_damage"]),
            (weighted_average([(scale_to_score(metrics["homeRunParkFactorVsHandedness"], 84, 126), 0.65), (metrics["weatherBoostScore"], 0.35)]), HITTER_WEIGHTS["home_run"]["park_weather"]),
            (matchup_fit, HITTER_WEIGHTS["home_run"]["matchup_fit"]),
            (recent_form, HITTER_WEIGHTS["home_run"]["recent_form"]),
        ]
    )
    strikeout_risk = weighted_average(
        [
            (scale_to_score(metrics["strikeoutRate"], 15, 36), HITTER_WEIGHTS["risk"]["strikeouts"]),
            (scale_to_score(metrics["whiffRate"], 18, 40), HITTER_WEIGHTS["risk"]["whiff"]),
            (metrics["pitcherStrikeoutThreatScore"], HITTER_WEIGHTS["risk"]["pitcher_stuff"]),
            (100 - metrics["zoneMatchupScore"], HITTER_WEIGHTS["risk"]["zone_fit"]),
            (100 - context, HITTER_WEIGHTS["risk"]["context"]),
            (100 - recent_form, HITTER_WEIGHTS["risk"]["recent_slump"]),
        ]
    )
    overall = weighted_average(
        [
            (split_skill, HITTER_WEIGHTS["overall"]["split_skill"]),
            (power, HITTER_WEIGHTS["overall"]["power"]),
            (discipline, HITTER_WEIGHTS["overall"]["discipline"]),
            (contact_quality, HITTER_WEIGHTS["overall"]["contact_quality"]),
            (recent_form, HITTER_WEIGHTS["overall"]["recent_form"]),
            (matchup_fit, HITTER_WEIGHTS["overall"]["matchup_fit"]),
            (environment, HITTER_WEIGHTS["overall"]["environment"]),
            (context, HITTER_WEIGHTS["overall"]["context"]),
        ]
    )
    on_base_skill = weighted_average(
        [
            (scale_to_score(metrics["obpVsHandedness"], 0.28, 0.43), 0.38),
            (scale_to_score(metrics["walkRate"], 4, 16), 0.16),
            (inverse_scale_to_score(metrics["chaseRate"], 22, 42), 0.14),
            (scale_to_score(metrics["contactRate"], 64, 88), 0.14),
            (scale_to_score(metrics["zoneContactRate"], 74, 94), 0.18),
        ]
    )
    pitcher_contact_matchup = weighted_average(
        [
            (metrics.get("opponentPitcherContactAllowed", 50.0), 0.42),
            (metrics.get("pitcherWeaknessExploitScore", 50.0), 0.28),
            (matchup_fit, 0.18),
            (
                scale_to_score(
                    metrics.get(
                        "hitParkFactorVsHandedness",
                        metrics.get("parkFactorVsHandedness", 100.0),
                    ),
                    88,
                    120,
                ),
                0.12,
            ),
        ]
    )
    pitcher_damage_matchup = metrics.get(
        "pitcherDamageScore",
        metrics.get("opponentPitcherPowerAllowed", 5.0) * 10,
    )
    pitcher_walk_pressure = weighted_average(
        [
            (scale_to_score(metrics.get("opponentPitcherWalkRateAllowed", 8.0), 4.0, 12.5), 0.62),
            (scale_to_score(metrics.get("walkParkFactorVsHandedness", 100.0), 88, 120), 0.16),
            (matchup_fit, 0.22),
        ]
    )
    run_context = weighted_average(
        [
            (_runs_lineup_score(metrics["lineupSpot"]), 0.60),
            (context, 0.40),
        ]
    )
    rbi_context = weighted_average(
        [
            (_rbi_lineup_score(metrics["lineupSpot"]), 0.62),
            (context, 0.38),
        ]
    )
    extra_base_environment = weighted_average(
        [
            (
                scale_to_score(
                    metrics.get(
                        "singleParkFactorVsHandedness",
                        metrics.get("hitParkFactorVsHandedness", 100.0),
                    ),
                    88,
                    120,
                ),
                0.16,
            ),
            (
                scale_to_score(
                    metrics.get(
                        "doubleParkFactorVsHandedness",
                        metrics.get("hitParkFactorVsHandedness", 100.0),
                    ),
                    88,
                    120,
                ),
                0.22,
            ),
            (
                scale_to_score(
                    metrics.get(
                        "tripleParkFactorVsHandedness",
                        metrics.get("hitParkFactorVsHandedness", 100.0),
                    ),
                    84,
                    126,
                ),
                0.08,
            ),
            (scale_to_score(metrics.get("homeRunParkFactorVsHandedness", 100.0), 84, 126), 0.34),
            (metrics.get("weatherBoostScore", 50.0), 0.20),
        ]
    )
    hits_outlook = weighted_average(
        [
            (split_skill, 0.24),
            (on_base_skill, 0.18),
            (contact_quality, 0.16),
            (pitcher_contact_matchup, 0.18),
            (matchup_fit, 0.08),
            (recent_form, 0.08),
            (context, 0.08),
        ]
    )
    runs_outlook = weighted_average(
        [
            (on_base_skill, 0.24),
            (scale_to_score(metrics["wobaVsHandedness"], 0.28, 0.45), 0.14),
            (power, 0.12),
            (pitcher_contact_matchup, 0.14),
            (pitcher_damage_matchup, 0.10),
            (run_context, 0.12),
            (scale_to_score(metrics.get("parkFactorVsHandedness", 100.0), 88, 120), 0.08),
            (recent_form, 0.06),
        ]
    )
    rbi_outlook = weighted_average(
        [
            (power, 0.22),
            (scale_to_score(metrics["sluggingVsHandedness"], 0.32, 0.67), 0.16),
            (contact_quality, 0.10),
            (pitcher_damage_matchup, 0.18),
            (matchup_fit, 0.12),
            (rbi_context, 0.12),
            (scale_to_score(metrics.get("parkFactorVsHandedness", 100.0), 88, 120), 0.05),
            (recent_form, 0.05),
        ]
    )
    total_bases_outlook = weighted_average(
        [
            (
                weighted_average(
                    [
                        (scale_to_score(metrics["sluggingVsHandedness"], 0.32, 0.67), 0.58),
                        (scale_to_score(metrics["isoVsHandedness"], 0.09, 0.33), 0.42),
                    ]
                ),
                0.18,
            ),
            (power, 0.22),
            (contact_quality, 0.14),
            (pitcher_damage_matchup, 0.16),
            (matchup_fit, 0.12),
            (extra_base_environment, 0.10),
            (recent_form, 0.04),
            (context, 0.04),
        ]
    )
    walks_outlook = weighted_average(
        [
            (scale_to_score(metrics["walkRate"], 4, 16), 0.28),
            (inverse_scale_to_score(metrics["chaseRate"], 22, 42), 0.18),
            (inverse_scale_to_score(metrics["whiffRate"], 18, 38), 0.10),
            (pitcher_walk_pressure, 0.28),
            (scale_to_score(metrics["obpVsHandedness"], 0.28, 0.43), 0.08),
            (context, 0.08),
        ]
    )
    confidence_numeric = weighted_average(
        [
            (metrics["dataCoverageScore"], 0.34),
            (metrics["sampleConfidenceScore"], 0.24),
            (metrics.get("historicalConfidenceScore", metrics["sampleConfidenceScore"]), 0.18),
            (100 if metrics["lineupConfirmed"] else 70, 0.12),
            (metrics["weatherDataQualityScore"], 0.12),
        ]
    )
    return {
        "overallHitScore": round(overall, 1),
        "homeRunUpsideScore": round(home_run_upside, 1),
        "floorScore": round(total_hit_potential, 1),
        "riskScore": round(strikeout_risk, 1),
        "totalHitPotentialScore": round(total_hit_potential, 1),
        "confidenceRating": quality_bucket(confidence_numeric),
        "marketConfidence": {
            "hits": _market_confidence_entry(
                hits_outlook,
                confidence_numeric,
                metrics["lineupConfirmed"],
            ),
            "runs": _market_confidence_entry(
                runs_outlook,
                confidence_numeric,
                metrics["lineupConfirmed"],
            ),
            "rbi": _market_confidence_entry(
                rbi_outlook,
                confidence_numeric,
                metrics["lineupConfirmed"],
            ),
            "totalBases": _market_confidence_entry(
                total_bases_outlook,
                confidence_numeric,
                metrics["lineupConfirmed"],
            ),
            "walks": _market_confidence_entry(
                walks_outlook,
                confidence_numeric,
                metrics["lineupConfirmed"],
            ),
        },
    }


def score_pitcher(pitcher: dict) -> dict:
    metrics = pitcher["metrics"]
    run_prevention = weighted_average(
        [
            (inverse_scale_to_score(metrics["era"], 2.2, 5.8), 0.30),
            (inverse_scale_to_score(metrics["fip"], 2.5, 5.4), 0.24),
            (inverse_scale_to_score(metrics["xFip"], 2.7, 5.2), 0.20),
            (inverse_scale_to_score(metrics["whip"], 0.95, 1.55), 0.26),
        ]
    )
    strikeouts = weighted_average(
        [
            (scale_to_score(metrics["strikeoutRate"], 16, 34), 0.38),
            (scale_to_score(metrics["swingingStrikeRate"], 9, 17), 0.26),
            (scale_to_score(metrics["calledStrikePlusWhiffRate"], 20, 33), 0.14),
            (scale_to_score(metrics["pitchShapeScore"], 45, 78), 0.10),
            (scale_to_score(metrics["velocityScore"], 45, 82), 0.12),
        ]
    )
    control = weighted_average(
        [
            (inverse_scale_to_score(metrics["walkRate"], 4, 12), 0.42),
            (inverse_scale_to_score(metrics["whip"], 0.95, 1.55), 0.24),
            (inverse_scale_to_score(metrics["timesThroughOrderPenalty"], 0, 20), 0.14),
            (metrics["restScore"], 0.10),
            (metrics["injuryAdjustment"], 0.10),
        ]
    )
    contact_suppression = weighted_average(
        [
            (inverse_scale_to_score(metrics["hardHitAllowed"], 28, 48), 0.24),
            (inverse_scale_to_score(metrics["barrelAllowed"], 3, 12), 0.22),
            (inverse_scale_to_score(metrics["averageExitVelocityAllowed"], 85, 93), 0.18),
            (inverse_scale_to_score(metrics["homeRunRateAllowed"], 1, 5), 0.18),
            (scale_to_score(metrics["groundBallRate"], 30, 56), 0.10),
            (inverse_scale_to_score(metrics["flyBallRate"], 22, 48), 0.08),
        ]
    )
    recent_form = weighted_average(
        [
            (metrics["recentForm7"], 0.45),
            (metrics["recentForm14"], 0.35),
            (metrics["recentForm30"], 0.20),
        ]
    )
    matchup = weighted_average(
        [
            (metrics["opponentStrikeoutRate"], 0.20),
            (100 - metrics["opponentPowerRating"], 0.18),
            (100 - metrics["opponentContactQuality"], 0.16),
            (metrics["bullpenSupportScore"], 0.10),
            (metrics["framingSupportScore"], 0.08),
            (metrics["umpireZoneScore"], 0.08),
            (metrics["pitchMixAdvantageScore"], 0.20),
        ]
    )
    environment = weighted_average(
        [
            (inverse_scale_to_score(metrics["parkFactor"], 95, 112), 0.24),
            (inverse_scale_to_score(metrics["homeRunParkFactor"], 90, 120), 0.28),
            (scale_to_score(metrics["strikeoutParkFactor"], 92, 110), 0.26),
            (metrics["weatherRunPreventionScore"], 0.22),
        ]
    )
    overall = weighted_average(
        [
            (run_prevention, PITCHER_WEIGHTS["overall"]["run_prevention"]),
            (strikeouts, PITCHER_WEIGHTS["overall"]["strikeouts"]),
            (control, PITCHER_WEIGHTS["overall"]["control"]),
            (contact_suppression, PITCHER_WEIGHTS["overall"]["contact_suppression"]),
            (recent_form, PITCHER_WEIGHTS["overall"]["recent_form"]),
            (matchup, PITCHER_WEIGHTS["overall"]["matchup"]),
            (environment, PITCHER_WEIGHTS["overall"]["environment"]),
        ]
    )
    strikeout_upside = weighted_average(
        [
            (strikeouts, PITCHER_WEIGHTS["strikeout"]["strikeouts"]),
            (scale_to_score(metrics["swingingStrikeRate"], 9, 17), PITCHER_WEIGHTS["strikeout"]["swing_miss"]),
            (control, PITCHER_WEIGHTS["strikeout"]["command"]),
            (scale_to_score(metrics["opponentStrikeoutRate"], 18, 28), PITCHER_WEIGHTS["strikeout"]["opponent_k"]),
            (scale_to_score(metrics["inningsProjection"], 4.5, 7.0), PITCHER_WEIGHTS["strikeout"]["workload"]),
        ]
    )
    safety = weighted_average(
        [
            (run_prevention, 0.30),
            (control, 0.22),
            (contact_suppression, 0.22),
            (recent_form, 0.14),
            (environment, 0.12),
        ]
    )
    blowup = weighted_average(
        [
            (scale_to_score(metrics["hardHitAllowed"], 28, 48), 0.26),
            (scale_to_score(metrics["barrelAllowed"], 3, 12), 0.24),
            (scale_to_score(metrics["walkRate"], 4, 12), 0.18),
            (scale_to_score(metrics["homeRunRateAllowed"], 1, 5), 0.18),
            (scale_to_score(metrics["homeRunParkFactor"], 90, 120), 0.14),
        ]
    )
    confidence_numeric = weighted_average(
        [
            (metrics["dataCoverageScore"], 0.34),
            (metrics["sampleConfidenceScore"], 0.22),
            (metrics.get("historicalConfidenceScore", metrics["sampleConfidenceScore"]), 0.20),
            (metrics["weatherDataQualityScore"], 0.12),
            (metrics["restScore"], 0.12),
        ]
    )
    return {
        "overallPitcherScore": round(overall, 1),
        "strikeoutUpsideScore": round(strikeout_upside, 1),
        "safetyScore": round(safety, 1),
        "blowupRiskScore": round(blowup, 1),
        "confidenceRating": quality_bucket(confidence_numeric),
    }


def _batters_per_inning(metrics: dict) -> float:
    return clamp(
        4.08
        + (metrics.get("opponentWalkRate", 8.0) - 8.0) * 0.035
        + (metrics.get("opponentContactQuality", 50.0) - 50.0) * 0.008
        + (metrics.get("walkRate", 7.0) - 7.0) * 0.03,
        3.85,
        4.75,
    )


def _negative_binomial_params(mean: float, variance: float) -> tuple[float, float]:
    adjusted_variance = max(variance, mean + 0.01)
    alpha = max((adjusted_variance - mean) / max(mean * mean, 1e-6), 1e-6)
    shape = max(1 / alpha, 1.0)
    probability = clamp(shape / (shape + mean), 1e-6, 1 - 1e-6)
    return shape, probability


def _negative_binomial_cdf(mean: float, variance: float, threshold: int) -> float:
    if threshold < 0:
        return 0.0
    shape, probability = _negative_binomial_params(mean, variance)
    cumulative = 0.0
    for strikeouts in range(threshold + 1):
        log_probability = (
            math.lgamma(strikeouts + shape)
            - math.lgamma(shape)
            - math.lgamma(strikeouts + 1)
            + shape * math.log(probability)
            + strikeouts * math.log(1 - probability)
        )
        cumulative += math.exp(log_probability)
    return clamp(cumulative, 0.0, 1.0)


def _negative_binomial_quantile(mean: float, variance: float, probability: float) -> int:
    capped_probability = clamp(probability, 0.0, 1.0)
    cumulative = 0.0
    upper_bound = max(16, int(math.ceil(mean + 8 * math.sqrt(max(variance, 1.0)))))
    for strikeouts in range(upper_bound + 1):
        cumulative = _negative_binomial_cdf(mean, variance, strikeouts)
        if cumulative >= capped_probability:
            return strikeouts
    return upper_bound


def _normal_cdf(value: float, mean: float, standard_deviation: float) -> float:
    adjusted_standard_deviation = max(standard_deviation, 0.01)
    z_score = (value - mean) / (adjusted_standard_deviation * math.sqrt(2))
    return clamp(0.5 * (1 + math.erf(z_score)), 0.0, 1.0)


def _count_line_probabilities(mean: float, variance: float, line_value: float) -> tuple[float, float]:
    integer_threshold = int(math.floor(line_value))
    over_probability = clamp(
        1 - _negative_binomial_cdf(mean, variance, integer_threshold),
        0.01,
        0.99,
    )
    under_probability = clamp(1 - over_probability, 0.01, 0.99)
    return over_probability, under_probability


def _continuous_line_probabilities(
    mean: float,
    standard_deviation: float,
    line_value: float,
) -> tuple[float, float]:
    over_probability = clamp(
        1 - _normal_cdf(line_value, mean, standard_deviation),
        0.01,
        0.99,
    )
    under_probability = clamp(1 - over_probability, 0.01, 0.99)
    return over_probability, under_probability


def _pitcher_workload_profile(metrics: dict) -> dict:
    average_batters_faced = max(
        metrics.get("averageBattersFaced")
        or metrics.get("recentBattersFaced")
        or (
            metrics.get("battersFaced", 0.0)
            / max(metrics.get("gamesStarted", 0.0), 1.0)
        )
        or (metrics["inningsProjection"] * _batters_per_inning(metrics)),
        16.0,
    )
    recent_batters_faced = max(
        metrics.get("recentBattersFaced", average_batters_faced),
        14.0,
    )
    pitches_per_plate_appearance = clamp(
        metrics.get("pitchesPerPlateAppearance")
        or (
            metrics.get("averagePitchCount", 85.0)
            / max(average_batters_faced, 1.0)
        ),
        3.55,
        4.45,
    )
    recent_pitches_per_plate_appearance = clamp(
        metrics.get("recentPitchesPerPlateAppearance", pitches_per_plate_appearance),
        3.50,
        4.60,
    )
    average_pitch_count = metrics.get(
        "averagePitchCount",
        clamp(metrics["inningsProjection"] * 15.8, 70, 102),
    )
    last_pitch_count = metrics.get("lastPitchCount", average_pitch_count)
    pitch_budget = weighted_average(
        [
            (average_pitch_count, 0.48),
            (last_pitch_count, 0.22),
            (metrics["inningsProjection"] * 15.8, 0.30),
        ],
        fallback=average_pitch_count,
    )
    baseline_expected_batters_faced = weighted_average(
        [
            (average_batters_faced, 0.34),
            (recent_batters_faced, 0.28),
            (metrics["inningsProjection"] * _batters_per_inning(metrics), 0.38),
        ],
        fallback=metrics["inningsProjection"] * _batters_per_inning(metrics),
    )
    recent_leash_trend = clamp(
        metrics.get(
            "recentLeashTrend",
            50.0 + (last_pitch_count - average_pitch_count) * 2.1,
        ),
        15.0,
        85.0,
    )
    quick_hook_risk = clamp(
        metrics.get(
            "quickHookRisk",
            weighted_average(
                [
                    (scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.24),
                    (100 - recent_leash_trend, 0.18),
                    (
                        scale_to_score(
                            max(
                                metrics.get(
                                    "averageInningsPerStart",
                                    metrics["inningsProjection"],
                                )
                                - metrics["inningsProjection"],
                                0.0,
                            ),
                            0.0,
                            1.2,
                        ),
                        0.18,
                    ),
                    (100 - metrics.get("recentForm", 50.0), 0.20),
                    (scale_to_score(metrics.get("walkRate", 7.0), 4, 12), 0.20),
                ],
                fallback=48.0,
            ),
        ),
        12.0,
        88.0,
    )
    role_certainty = weighted_average(
        [
            (scale_to_score(metrics["inningsProjection"], 4.3, 6.9), 0.28),
            (scale_to_score(pitch_budget, 72, 102), 0.24),
            (inverse_scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.16),
            (recent_leash_trend, 0.16),
            (metrics.get("opponentLineupConfidenceScore", 64.0), 0.16),
        ],
        fallback=58.0,
    )
    innings_volatility = weighted_average(
        [
            (scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.54),
            (
                scale_to_score(
                    abs(
                        metrics.get("recentForm7", metrics.get("recentForm", 50.0))
                        - metrics.get("recentForm30", metrics.get("recentForm", 50.0))
                    ),
                    0,
                    18,
                ),
                0.18,
            ),
            (scale_to_score(abs(recent_batters_faced - average_batters_faced), 0.0, 4.5), 0.14),
            (quick_hook_risk, 0.14),
        ],
        fallback=40.0,
    )
    pitch_count_cap = weighted_average(
        [
            (inverse_scale_to_score(pitch_budget, 72, 102), 0.54),
            (inverse_scale_to_score(last_pitch_count, 70, 108), 0.18),
            (scale_to_score(max(5.9 - metrics["inningsProjection"], 0.0), 0.0, 1.8), 0.14),
            (100 - recent_leash_trend, 0.14),
        ],
        fallback=42.0,
    )
    early_exit_risk = weighted_average(
        [
            (scale_to_score(metrics["walkRate"], 4, 12), 0.24),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 40, 65), 0.18),
            (scale_to_score(metrics["hardHitAllowed"], 28, 48), 0.16),
            (100 - metrics.get("recentForm", 50.0), 0.18),
            (scale_to_score(metrics["homeRunParkFactor"], 90, 120), 0.12),
            (quick_hook_risk, 0.12),
        ],
        fallback=44.0,
    )
    projected_batters_faced = clamp(
        weighted_average(
            [
                (baseline_expected_batters_faced, 0.62),
                (pitch_budget / max(recent_pitches_per_plate_appearance, 3.4), 0.38),
            ],
            fallback=baseline_expected_batters_faced,
        )
        * clamp(
            0.92
            + role_certainty * 0.0009
            - pitch_count_cap * 0.0005
            - early_exit_risk * 0.0006,
            0.78,
            1.08,
        ),
        12.0,
        30.0,
    )
    lineup_confidence = metrics.get("opponentLineupConfidenceScore", 64.0)
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
        "expectedBattersFaced": round(projected_batters_faced, 1),
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


def derive_home_run_probability(hitter: dict) -> dict:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    raw = scores["homeRunUpsideScore"]
    heuristic = clamp(
        logistic(
            -4.2
            + raw * 0.051
            + (metrics["lineupSpot"] <= 4) * 0.15
            + (metrics["homeRunParkFactorVsHandedness"] - 100) * 0.009
            + (metrics["weatherBoostScore"] - 50) * 0.011
            + (metrics["pitchMixMatchupScore"] - 50) * 0.010
            + (metrics["batterVsPitcherScore"] - 50)
            * min(metrics["batterVsPitcherPlateAppearances"] / 10, 1)
            * 0.006
            - (scores["riskScore"] - 50) * 0.008
        ),
        0.01,
        0.55,
    )
    return {
        "rawScore": raw,
        "heuristicProbability": round(heuristic, 4),
        "learnedProbability": None,
        "blendedProbability": round(heuristic, 4),
        "modelType": "python_weighted_model",
        "trainingSamples": 0,
    }


def derive_strikeout_prop(pitcher: dict) -> dict:
    metrics = pitcher["metrics"]
    lineup_vs_pitcher_hand_k_rate = metrics.get(
        "lineupStrikeoutRateVsHand",
        metrics["opponentStrikeoutRate"],
    )
    lineup_confidence_score = metrics.get(
        "opponentLineupConfidenceScore",
        100.0 if metrics.get("opponentLineupConfirmed", False) else 72.0,
    )
    true_talent_k_rate = clamp(
        metrics["strikeoutRate"] * 0.78
        + metrics["swingingStrikeRate"] * 0.45
        + (metrics.get("calledStrikePlusWhiffRate", 26.0) - 25.0) * 0.20
        + (metrics.get("pitchMixAdvantageScore", 50.0) - 50.0) * 0.04,
        14.0,
        39.0,
    )
    true_talent_k_ability = weighted_average(
        [
            (scale_to_score(metrics["strikeoutRate"], 16, 34), 0.52),
            (scale_to_score(metrics["swingingStrikeRate"], 9, 17), 0.28),
            (scale_to_score(metrics["calledStrikePlusWhiffRate"], 20, 33), 0.20),
        ]
    )
    opponent_k_tendencies = weighted_average(
        [
            (scale_to_score(metrics["opponentStrikeoutRate"], 18, 28), 0.68),
            (inverse_scale_to_score(metrics["opponentContactQuality"], 40, 65), 0.32),
        ]
    )
    umpire_park_lineup = weighted_average(
        [
            (scale_to_score(metrics["strikeoutParkFactor"], 92, 110), 0.42),
            (metrics.get("umpireZoneScore", 50.0), 0.24),
            (metrics.get("pitchMixAdvantageScore", 50.0), 0.18),
            (lineup_confidence_score, 0.16),
        ]
    )
    expected_batters_faced = metrics["inningsProjection"] * _batters_per_inning(metrics)

    role_certainty = weighted_average(
        [
            (scale_to_score(metrics["inningsProjection"], 4.5, 6.9), 0.46),
            (inverse_scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.32),
            (scale_to_score(metrics.get("averagePitchCount", 85.0), 68, 102), 0.22),
        ],
        fallback=58.0,
    )
    innings_volatility = weighted_average(
        [
            (scale_to_score(metrics.get("recentInningsStd", 0.9), 0.15, 1.8), 0.70),
            (scale_to_score(abs(metrics["recentForm7"] - metrics["recentForm30"]), 0, 18), 0.30),
        ],
        fallback=38.0,
    )
    pitch_count_cap = weighted_average(
        [
            (inverse_scale_to_score(metrics.get("averagePitchCount", 85.0), 72, 102), 0.62),
            (scale_to_score(max(5.8 - metrics["inningsProjection"], 0), 0, 1.6), 0.38),
        ],
        fallback=42.0,
    )
    early_exit_risk = weighted_average(
        [
            (scale_to_score(metrics["walkRate"], 4, 12), 0.28),
            (scale_to_score(metrics["opponentContactQuality"], 40, 65), 0.22),
            (scale_to_score(metrics["hardHitAllowed"], 28, 48), 0.18),
            (100 - metrics.get("recentForm", 50.0), 0.20),
            (scale_to_score(metrics["homeRunParkFactor"], 90, 120), 0.12),
        ],
        fallback=42.0,
    )
    recent_workload = weighted_average(
        [
            (scale_to_score(metrics.get("lastPitchCount", 88.0), 70, 108), 0.58),
            (scale_to_score(metrics.get("averagePitchCount", 85.0), 68, 102), 0.42),
        ],
        fallback=46.0,
    )
    contact_heavy_penalty = weighted_average(
        [
            (inverse_scale_to_score(metrics["opponentStrikeoutRate"], 18, 28), 0.56),
            (scale_to_score(metrics["opponentContactQuality"], 40, 65), 0.44),
        ],
        fallback=40.0,
    )

    matchup_k_rate = clamp(
        true_talent_k_rate * 0.74
        + metrics["opponentStrikeoutRate"] * 0.26
        + (metrics["strikeoutParkFactor"] - 100.0) * 0.06
        + (metrics.get("umpireZoneScore", 50.0) - 50.0) * 0.03
        + (metrics.get("pitchMixAdvantageScore", 50.0) - 50.0) * 0.02,
        12.5,
        36.0,
    )
    base_mean = expected_batters_faced * (matchup_k_rate / 100)
    workload_multiplier = clamp(
        0.90
        + role_certainty * 0.0012
        - innings_volatility * 0.0010
        - pitch_count_cap * 0.0008
        - early_exit_risk * 0.0011
        - recent_workload * 0.0004
        - contact_heavy_penalty * 0.0006,
        0.72,
        1.05,
    )
    mean_ks = clamp(base_mean * workload_multiplier, 1.2, 12.5)
    risk_index = weighted_average(
        [
            (100 - role_certainty, 0.22),
            (innings_volatility, 0.20),
            (pitch_count_cap, 0.18),
            (early_exit_risk, 0.18),
            (recent_workload, 0.10),
            (contact_heavy_penalty, 0.12),
        ],
        fallback=46.0,
    )
    variance = mean_ks + (0.04 + risk_index / 100 * 0.20) * mean_ks * mean_ks
    median_ks = float(_negative_binomial_quantile(mean_ks, variance, 0.5))
    over_3_5 = clamp(1 - _negative_binomial_cdf(mean_ks, variance, 3), 0.01, 0.99)
    over_4_5 = clamp(1 - _negative_binomial_cdf(mean_ks, variance, 4), 0.01, 0.99)
    confidence_score = weighted_average(
        [
            (metrics["dataCoverageScore"], 0.28),
            (metrics["sampleConfidenceScore"], 0.22),
            (role_certainty, 0.18),
            (100 - innings_volatility, 0.10),
            (100 - early_exit_risk, 0.10),
            (100 - contact_heavy_penalty, 0.08),
            (lineup_confidence_score, 0.04),
        ],
        fallback=58.0,
    )
    confidence = (
        "core"
        if confidence_score >= 78 or (mean_ks >= 6.2 and over_4_5 >= 0.62)
        else "strong"
        if confidence_score >= 64 or over_4_5 >= 0.48
        else "watch"
    )
    return {
        "meanKs": round(mean_ks, 2),
        "medianKs": round(median_ks, 1),
        "over3_5Probability": round(over_3_5, 4),
        "over4_5Probability": round(over_4_5, 4),
        "confidence": confidence,
        "confidenceScore": round(confidence_score, 1),
        "projectionLayer": {
            "trueTalentKAbility": round(true_talent_k_ability, 1),
            "opponentKTendencies": round(opponent_k_tendencies, 1),
            "umpireParkLineup": round(umpire_park_lineup, 1),
            "expectedBattersFaced": round(expected_batters_faced, 1),
            "lineupVsPitcherHandKRate": round(lineup_vs_pitcher_hand_k_rate, 1),
            "matchupAdjustedKRate": round(matchup_k_rate, 1),
            "pitchMixAdvantage": round(metrics.get("pitchMixAdvantageScore", 50.0), 1),
            "lineupConfidence": round(lineup_confidence_score, 1),
            "trackedLineupSpots": int(metrics.get("opponentLineupCount", 0)),
            "confirmedLineupSpots": int(metrics.get("opponentConfirmedHitterCount", 0)),
        },
        "riskLayer": {
            "roleCertainty": round(role_certainty, 1),
            "inningsVolatility": round(innings_volatility, 1),
            "pitchCountCap": round(pitch_count_cap, 1),
            "earlyExitRisk": round(early_exit_risk, 1),
            "recentWorkload": round(recent_workload, 1),
            "contactHeavyOpponentPenalty": round(contact_heavy_penalty, 1),
        },
    }


def derive_pitcher_walk_prop(pitcher: dict, line_value: float = 2.5) -> dict:
    metrics = pitcher["metrics"]
    workload = _pitcher_workload_profile(metrics)
    recent_walk_rate = metrics.get("recentWalkRate", metrics["walkRate"])
    csw_rate = metrics.get("calledStrikePlusWhiffRate", 26.0)
    first_pitch_strike_rate = clamp(
        metrics.get(
            "firstPitchStrikeRate",
            60.5
            - (metrics["walkRate"] - 8.0) * 1.6
            + (csw_rate - 28.0) * 0.35
            + (metrics.get("framingSupportScore", 50.0) - 50.0) * 0.05
            + (metrics.get("umpireZoneScore", 50.0) - 50.0) * 0.05,
        ),
        54.0,
        69.0,
    )
    zone_rate = clamp(
        metrics.get(
            "zoneRate",
            48.5
            - (metrics["walkRate"] - 8.0) * 0.80
            + (first_pitch_strike_rate - 61.0) * 0.32
            + (metrics.get("umpireZoneScore", 50.0) - 50.0) * 0.03,
        ),
        42.0,
        56.0,
    )
    chase_induced_rate = clamp(
        metrics.get(
            "chaseInducedRate",
            28.0
            + (metrics.get("swingingStrikeRate", 11.5) - 11.5) * 0.75
            + (metrics.get("pitchMixAdvantageScore", 50.0) - 50.0) * 0.06,
        ),
        22.0,
        38.0,
    )
    opponent_chase_rate = metrics.get("opponentChaseRate", 29.5)
    opponent_patience_score = clamp(
        metrics.get(
            "opponentPatienceScore",
            weighted_average(
                [
                    (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5, 12), 0.58),
                    (inverse_scale_to_score(opponent_chase_rate, 22, 36), 0.42),
                ],
                fallback=50.0,
            ),
        ),
        10.0,
        90.0,
    )
    three_ball_count_rate = clamp(
        metrics.get(
            "threeBallCountRate",
            16.5
            + (metrics["walkRate"] - 8.0) * 1.35
            - (first_pitch_strike_rate - 61.0) * 0.22
            + (opponent_patience_score - 50.0) * 0.05,
        ),
        10.0,
        30.0,
    )
    recent_command_trend = clamp(
        metrics.get(
            "recentCommandTrend",
            50.0 + (metrics["walkRate"] - recent_walk_rate) * 4.0,
        ),
        15.0,
        85.0,
    )
    handedness_split_walk_rate = metrics.get("handednessSplitWalkRate", metrics["walkRate"])
    walk_park_factor = metrics.get("walkParkFactor", metrics.get("parkFactor", 100.0))
    framing_support = metrics.get("framingSupportScore", 50.0)
    umpire_zone_score = metrics.get("umpireZoneScore", 50.0)
    command_score = weighted_average(
        [
            (inverse_scale_to_score(metrics["walkRate"], 4, 12), 0.22),
            (inverse_scale_to_score(recent_walk_rate, 4, 12), 0.20),
            (scale_to_score(first_pitch_strike_rate, 55, 69), 0.16),
            (scale_to_score(zone_rate, 42, 56), 0.12),
            (scale_to_score(chase_induced_rate, 22, 38), 0.12),
            (scale_to_score(csw_rate, 20, 33), 0.10),
            (inverse_scale_to_score(three_ball_count_rate, 10, 30), 0.08),
        ],
        fallback=50.0,
    )
    lineup_patience_score = weighted_average(
        [
            (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5, 12), 0.42),
            (inverse_scale_to_score(opponent_chase_rate, 22, 36), 0.28),
            (opponent_patience_score, 0.18),
            (scale_to_score(handedness_split_walk_rate, 4, 11), 0.12),
        ],
        fallback=50.0,
    )
    environment_score = weighted_average(
        [
            (inverse_scale_to_score(walk_park_factor, 96, 104), 0.30),
            (framing_support, 0.34),
            (umpire_zone_score, 0.28),
            (metrics.get("defenseSupportScore", 50.0), 0.08),
        ],
        fallback=50.0,
    )
    base_walk_probability = clamp(
        (
            metrics["walkRate"] * 0.44
            + recent_walk_rate * 0.22
            + metrics.get("opponentWalkRate", 8.0) * 0.18
            + handedness_split_walk_rate * 0.10
            + max(three_ball_count_rate - 16.0, 0.0) * 0.22
        )
        / 100,
        0.025,
        0.18,
    )
    adjusted_walk_probability = clamp(
        base_walk_probability
        * clamp(
            1
            + (lineup_patience_score - 50.0) * 0.0048
            - (command_score - 50.0) * 0.0058
            - (environment_score - 50.0) * 0.0026
            - (recent_command_trend - 50.0) * 0.0016,
            0.62,
            1.42,
        ),
        0.02,
        0.20,
    )
    mean_walks = clamp(
        workload["expectedBattersFaced"] * adjusted_walk_probability,
        0.35,
        6.5,
    )
    uncertainty_score = weighted_average(
        [
            (100 - command_score, 0.22),
            (workload["inningsVolatility"], 0.20),
            (workload["earlyExitRisk"], 0.18),
            (scale_to_score(abs(recent_walk_rate - metrics["walkRate"]), 0, 3.2), 0.18),
            (lineup_patience_score, 0.12),
            (100 - workload["lineupConfidence"], 0.10),
        ],
        fallback=46.0,
    )
    variance = mean_walks + (0.08 + uncertainty_score / 100 * 0.18) * mean_walks * mean_walks
    median_walks = float(_negative_binomial_quantile(mean_walks, variance, 0.5))
    over_line_probability, under_line_probability = _count_line_probabilities(
        mean_walks,
        variance,
        line_value,
    )
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.26),
            (metrics.get("sampleConfidenceScore", 68.0), 0.22),
            (100 - uncertainty_score, 0.18),
            (workload["roleCertainty"], 0.14),
            (recent_command_trend, 0.10),
            (workload["lineupConfidence"], 0.10),
        ],
        fallback=58.0,
    )
    return {
        "meanWalks": round(mean_walks, 2),
        "medianWalks": round(median_walks, 1),
        "overLineProbability": round(over_line_probability, 4),
        "underLineProbability": round(under_line_probability, 4),
        "confidence": quality_bucket(confidence_score),
        "confidenceScore": round(confidence_score, 1),
        "uncertaintyScore": round(uncertainty_score, 1),
        "projectionLayer": {
            "adjustedWalkProbability": round(adjusted_walk_probability, 4),
            "projectedBattersFaced": workload["expectedBattersFaced"],
            "seasonWalkRate": round(metrics["walkRate"], 1),
            "recentWalkRate": round(recent_walk_rate, 1),
            "firstPitchStrikeRate": round(first_pitch_strike_rate, 1),
            "zoneRate": round(zone_rate, 1),
            "chaseInducedRate": round(chase_induced_rate, 1),
            "calledStrikePlusWhiffRate": round(csw_rate, 1),
            "threeBallCountRate": round(three_ball_count_rate, 1),
            "opponentWalkRate": round(metrics.get("opponentWalkRate", 8.0), 1),
            "opponentChaseRate": round(opponent_chase_rate, 1),
            "opponentPatienceScore": round(opponent_patience_score, 1),
            "walkEnvironmentScore": round(environment_score, 1),
            "matchupAdjustedWalkRate": round(adjusted_walk_probability * 100, 1),
            "handednessSplitWalkRate": round(handedness_split_walk_rate, 1),
        },
        "riskLayer": {
            "roleCertainty": workload["roleCertainty"],
            "commandScore": round(command_score, 1),
            "inningsVolatility": workload["inningsVolatility"],
            "pitchCountCap": workload["pitchCountCap"],
            "earlyExitRisk": workload["earlyExitRisk"],
            "lineupConfidence": workload["lineupConfidence"],
            "recentCommandTrend": round(recent_command_trend, 1),
        },
    }


def derive_pitcher_outs_prop(pitcher: dict, line_value: float = 15.5) -> dict:
    metrics = pitcher["metrics"]
    workload = _pitcher_workload_profile(metrics)
    walk_breakdown = derive_pitcher_walk_prop(pitcher, 2.5)
    projected_walks = walk_breakdown["meanWalks"]
    opponent_patience_score = metrics.get(
        "opponentPatienceScore",
        weighted_average(
            [
                (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5, 12), 0.58),
                (inverse_scale_to_score(metrics.get("opponentChaseRate", 29.5), 22, 36), 0.42),
            ],
            fallback=50.0,
        ),
    )
    opponent_resistance = weighted_average(
        [
            (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5, 12), 0.24),
            (inverse_scale_to_score(metrics["opponentStrikeoutRate"], 18, 28), 0.24),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 40, 65), 0.22),
            (opponent_patience_score, 0.18),
            (scale_to_score(metrics.get("parkFactor", 100.0), 95, 112), 0.12),
        ],
        fallback=50.0,
    )
    generated_pitches_per_plate_appearance = clamp(
        3.70
        + projected_walks * 0.11
        + (metrics["strikeoutRate"] - 22.0) * 0.018
        + (opponent_resistance - 50.0) * 0.006
        + (
            workload["recentPitchesPerPlateAppearance"]
            - workload["pitchesPerPlateAppearance"]
        )
        * 0.40,
        3.55,
        4.65,
    )
    expected_pitches_per_plate_appearance = clamp(
        weighted_average(
            [
                (workload["pitchesPerPlateAppearance"], 0.38),
                (workload["recentPitchesPerPlateAppearance"], 0.30),
                (generated_pitches_per_plate_appearance, 0.32),
            ],
            fallback=generated_pitches_per_plate_appearance,
        ),
        3.55,
        4.65,
    )
    pitch_budget_batters_faced = workload["pitchBudget"] / max(expected_pitches_per_plate_appearance, 3.4)
    survival_batters_faced = clamp(
        weighted_average(
            [
                (workload["expectedBattersFaced"], 0.52),
                (pitch_budget_batters_faced, 0.48),
            ],
            fallback=workload["expectedBattersFaced"],
        )
        * clamp(
            0.95
            + workload["roleCertainty"] * 0.0008
            - workload["quickHookRisk"] * 0.0008
            - workload["pitchCountCap"] * 0.0005,
            0.82,
            1.06,
        ),
        12.0,
        30.0,
    )
    baseline_out_rate = clamp(
        (metrics["inningsProjection"] * 3.0)
        / max(workload["baselineExpectedBattersFaced"], 1.0),
        0.62,
        0.76,
    )
    contact_management_score = weighted_average(
        [
            (inverse_scale_to_score(metrics["hardHitAllowed"], 28, 48), 0.36),
            (inverse_scale_to_score(metrics["barrelAllowed"], 3, 12), 0.32),
            (inverse_scale_to_score(metrics["averageExitVelocityAllowed"], 85, 93), 0.20),
            (scale_to_score(metrics["groundBallRate"], 30, 56), 0.12),
        ],
        fallback=50.0,
    )
    support_score = weighted_average(
        [
            (metrics.get("defenseSupportScore", 50.0), 0.34),
            (metrics.get("bullpenContextScore", 50.0), 0.18),
            (inverse_scale_to_score(metrics["parkFactor"], 95, 112), 0.24),
            (inverse_scale_to_score(metrics["homeRunParkFactor"], 90, 120), 0.14),
            (metrics.get("restScore", 50.0), 0.10),
        ],
        fallback=50.0,
    )
    times_through_penalty = weighted_average(
        [
            (scale_to_score(max(survival_batters_faced - 18.0, 0.0), 0.0, 6.0), 0.44),
            (scale_to_score(max(survival_batters_faced - 27.0, 0.0), 0.0, 3.0), 0.20),
            (scale_to_score(metrics.get("timesThroughOrderPenalty", 50.0), 35.0, 80.0), 0.36),
        ],
        fallback=40.0,
    )
    out_conversion_multiplier = clamp(
        0.98
        + (contact_management_score - 50.0) * 0.0022
        + (support_score - 50.0) * 0.0014
        - max(projected_walks - 2.2, 0.0) * 0.030
        - (opponent_resistance - 50.0) * 0.0018
        - (times_through_penalty - 40.0) * 0.0024,
        0.78,
        1.08,
    )
    mean_outs = clamp(
        survival_batters_faced * baseline_out_rate * out_conversion_multiplier,
        6.0,
        24.5,
    )
    uncertainty_score = weighted_average(
        [
            (workload["inningsVolatility"], 0.24),
            (workload["quickHookRisk"], 0.22),
            (times_through_penalty, 0.16),
            (opponent_resistance, 0.14),
            (scale_to_score(expected_pitches_per_plate_appearance, 3.6, 4.5), 0.12),
            (scale_to_score(abs(projected_walks - 2.0), 0.0, 2.5), 0.12),
        ],
        fallback=44.0,
    )
    standard_deviation = clamp(1.45 + uncertainty_score / 100 * 2.9, 1.4, 4.7)
    over_line_probability, under_line_probability = _continuous_line_probabilities(
        mean_outs,
        standard_deviation,
        line_value,
    )
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.24),
            (metrics.get("sampleConfidenceScore", 68.0), 0.20),
            (workload["roleCertainty"], 0.18),
            (100 - uncertainty_score, 0.18),
            (100 - workload["quickHookRisk"], 0.10),
            (workload["lineupConfidence"], 0.10),
        ],
        fallback=58.0,
    )
    return {
        "meanOuts": round(mean_outs, 2),
        "medianOuts": round(mean_outs, 1),
        "overLineProbability": round(over_line_probability, 4),
        "underLineProbability": round(under_line_probability, 4),
        "confidence": quality_bucket(confidence_score),
        "confidenceScore": round(confidence_score, 1),
        "uncertaintyScore": round(uncertainty_score, 1),
        "projectionLayer": {
            "expectedPitchBudget": workload["pitchBudget"],
            "expectedPitchesPerPlateAppearance": round(expected_pitches_per_plate_appearance, 2),
            "pitchBudgetBattersFaced": round(pitch_budget_batters_faced, 1),
            "projectedBattersFaced": workload["expectedBattersFaced"],
            "projectedWalks": round(projected_walks, 2),
            "baselineOutRate": round(baseline_out_rate, 3),
            "contactManagementScore": round(contact_management_score, 1),
            "supportScore": round(support_score, 1),
            "opponentResistance": round(opponent_resistance, 1),
            "survivalBattersFaced": round(survival_batters_faced, 1),
        },
        "riskLayer": {
            "roleCertainty": workload["roleCertainty"],
            "quickHookRisk": workload["quickHookRisk"],
            "inningsVolatility": workload["inningsVolatility"],
            "pitchCountCap": workload["pitchCountCap"],
            "earlyExitRisk": workload["earlyExitRisk"],
            "timesThroughOrderPenalty": round(times_through_penalty, 1),
            "lineupConfidence": workload["lineupConfidence"],
        },
    }


def estimate_pitcher_strikeouts(pitcher: dict) -> float:
    return derive_strikeout_prop(pitcher)["meanKs"]


def estimate_pitcher_walks(pitcher: dict) -> float:
    return derive_pitcher_walk_prop(pitcher)["meanWalks"]


def estimate_pitcher_outs(pitcher: dict) -> float:
    return derive_pitcher_outs_prop(pitcher)["meanOuts"]
