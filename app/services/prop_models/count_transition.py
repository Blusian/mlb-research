from __future__ import annotations

from functools import lru_cache

from app.services.feature_builder import (
    STABILIZATION_ANCHORS,
    build_count_probabilities,
    build_data_quality_flags,
    build_pitcher_opportunity,
    distribution_mean,
    distribution_median,
    distribution_to_map,
    distribution_variance,
    empirical_bayes_rate,
    line_probabilities_from_distribution,
    relative_uncertainty_score,
    rule_era_flag,
)
from app.services.prop_models.calibration import calibrate_probability
from app.utils.math_utils import clamp, inverse_scale_to_score, quality_bucket, scale_to_score, weighted_average


def _arsenal_score(metrics: dict) -> float:
    velocity_score = scale_to_score(
        metrics.get("pitchVelocity", metrics.get("releaseSpeedMax", 93.0)),
        89.0,
        99.0,
    )
    movement_score = clamp(metrics.get("pitchShapeScore", 50.0), 0.0, 100.0)
    extension_score = scale_to_score(metrics.get("releaseExtension", 6.2), 5.5, 7.2)
    spin_score = scale_to_score(metrics.get("releaseSpin", 2300.0), 1900.0, 2800.0)
    return weighted_average(
        [
            (velocity_score, 0.30),
            (movement_score, 0.28),
            (extension_score, 0.16),
            (spin_score, 0.12),
            (metrics.get("pitchMixAdvantageScore", 50.0), 0.14),
        ],
        fallback=50.0,
    )


def _command_environment_score(metrics: dict) -> float:
    first_pitch_strike_rate = metrics.get("firstPitchStrikeRate", 60.5)
    zone_rate = metrics.get("zoneRate", 48.5)
    csw_rate = metrics.get("calledStrikePlusWhiffRate", 26.0)
    return weighted_average(
        [
            (scale_to_score(first_pitch_strike_rate, 55.0, 69.0), 0.22),
            (scale_to_score(zone_rate, 42.0, 56.0), 0.18),
            (scale_to_score(csw_rate, 20.0, 34.0), 0.20),
            (metrics.get("framingSupportScore", 50.0), 0.18),
            (metrics.get("umpireZoneScore", 50.0), 0.16),
            (inverse_scale_to_score(metrics.get("walkRate", 8.0), 4.0, 12.0), 0.06),
        ],
        fallback=50.0,
    )


def _opponent_contact_score(metrics: dict) -> float:
    return weighted_average(
        [
            (inverse_scale_to_score(metrics.get("opponentStrikeoutRate", 22.0), 18.0, 30.0), 0.34),
            (inverse_scale_to_score(metrics.get("opponentChaseRate", 29.5), 22.0, 36.0), 0.18),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 38.0, 66.0), 0.24),
            (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5.0, 12.0), 0.12),
            (scale_to_score(metrics.get("lineupStrikeoutRateVsHand", metrics.get("opponentStrikeoutRate", 22.0)), 18.0, 30.0), 0.12),
        ],
        fallback=50.0,
    )


def _shared_count_targets(metrics: dict, opportunity: dict) -> dict:
    arsenal_score = _arsenal_score(metrics)
    command_environment = _command_environment_score(metrics)
    opponent_contact_score = _opponent_contact_score(metrics)
    strikeout_talent = empirical_bayes_rate(
        season_value=metrics.get("strikeoutRate"),
        season_sample=metrics.get("battersFaced", 0.0),
        recent30_value=metrics.get("recentStrikeoutRate", metrics.get("strikeoutRate")),
        recent30_sample=metrics.get("recentBattersFaced", 0.0),
        vs_hand_value=metrics.get("lineupStrikeoutRateVsHand", metrics.get("opponentStrikeoutRate")),
        vs_hand_sample=metrics.get("opponentLineupCount", 0.0) * 4.0,
        career_value=metrics.get("strikeoutRate"),
        career_sample=metrics.get("careerBattersFaced", 0.0),
        anchor=STABILIZATION_ANCHORS["strikeout_rate"],
        fallback=metrics.get("strikeoutRate", 22.0),
    )
    walk_talent = empirical_bayes_rate(
        season_value=metrics.get("walkRate"),
        season_sample=metrics.get("battersFaced", 0.0),
        recent30_value=metrics.get("recentWalkRate", metrics.get("walkRate")),
        recent30_sample=metrics.get("recentBattersFaced", 0.0),
        vs_hand_value=metrics.get("handednessSplitWalkRate", metrics.get("walkRate")),
        vs_hand_sample=metrics.get("opponentLineupCount", 0.0) * 4.0,
        career_value=metrics.get("walkRate"),
        career_sample=metrics.get("careerBattersFaced", 0.0),
        anchor=STABILIZATION_ANCHORS["walk_rate"],
        fallback=metrics.get("walkRate", 8.0),
    )
    matchup_adjusted_k_rate = clamp(
        strikeout_talent * 0.72
        + metrics.get("opponentStrikeoutRate", 22.0) * 0.18
        + (arsenal_score - 50.0) * 0.07
        + (metrics.get("strikeoutParkFactor", 100.0) - 100.0) * 0.05
        + (metrics.get("umpireZoneScore", 50.0) - 50.0) * 0.04,
        12.0,
        39.0,
    )
    matchup_adjusted_walk_rate = clamp(
        walk_talent * 0.74
        + metrics.get("opponentWalkRate", 8.0) * 0.18
        - (command_environment - 50.0) * 0.05
        + (metrics.get("opponentPatienceScore", 50.0) - 50.0) * 0.04
        - (metrics.get("walkParkFactor", metrics.get("parkFactor", 100.0)) - 100.0) * 0.03,
        2.2,
        14.5,
    )
    return {
        "arsenalScore": round(arsenal_score, 1),
        "commandEnvironment": round(command_environment, 1),
        "opponentContactScore": round(opponent_contact_score, 1),
        "matchupAdjustedKRate": round(matchup_adjusted_k_rate, 1),
        "matchupAdjustedWalkRate": round(matchup_adjusted_walk_rate, 1),
        "projectedBattersFaced": opportunity["projectedBattersFaced"],
    }


def _transition_heads(metrics: dict, shared_targets: dict, balls: int, strikes: int, batter_index: int) -> dict:
    leverage = strikes - balls
    arsenal_score = shared_targets["arsenalScore"]
    command_environment = shared_targets["commandEnvironment"]
    opponent_contact_score = shared_targets["opponentContactScore"]
    take_ball_probability = clamp(
        0.67
        + (shared_targets["matchupAdjustedWalkRate"] - 8.0) * 0.018
        - (command_environment - 50.0) * 0.0048
        + balls * 0.055
        - strikes * 0.028,
        0.36,
        0.90,
    )
    swing_probability = clamp(
        0.48
        + leverage * 0.045
        + (metrics.get("opponentChaseRate", 29.5) - 29.5) * 0.003
        - (metrics.get("opponentPatienceScore", 50.0) - 50.0) * 0.002
        + (arsenal_score - 50.0) * 0.001
        - max(batter_index - 18, 0) * 0.003,
        0.28,
        0.78,
    )
    called_strike_on_take = clamp(
        0.29
        + (command_environment - 50.0) * 0.0044
        + leverage * 0.016
        + (metrics.get("framingSupportScore", 50.0) - 50.0) * 0.0018,
        0.14,
        0.62,
    )
    whiff_on_swing = clamp(
        0.18
        + (shared_targets["matchupAdjustedKRate"] - 22.0) * 0.008
        + (arsenal_score - 50.0) * 0.0016
        - (opponent_contact_score - 50.0) * 0.0013
        + (0.06 if strikes == 2 else 0.0),
        0.08,
        0.52,
    )
    foul_on_contact = clamp(
        0.34
        + (0.10 if strikes == 2 else 0.0)
        + (opponent_contact_score - 50.0) * 0.0012
        - (arsenal_score - 50.0) * 0.0007,
        0.16,
        0.62,
    )
    take_probability = 1 - swing_probability
    called_strike_probability = take_probability * called_strike_on_take
    ball_probability = take_probability * (1 - called_strike_on_take)
    swinging_strike_probability = swing_probability * whiff_on_swing
    contact_probability = max(swing_probability - swinging_strike_probability, 0.01)
    foul_probability = contact_probability * foul_on_contact
    in_play_probability = max(contact_probability - foul_probability, 0.02)
    total_probability = (
        called_strike_probability
        + ball_probability
        + swinging_strike_probability
        + foul_probability
        + in_play_probability
    )
    if total_probability <= 0:
        return {
            "called_strike_prob": 0.22,
            "ball_prob": 0.28,
            "swing_prob": swing_probability,
            "whiff_prob": 0.11,
            "foul_prob": 0.19,
            "in_play_prob": 0.20,
            "swinging_strike_prob": 0.11,
        }
    called_strike_probability /= total_probability
    ball_probability /= total_probability
    swinging_strike_probability /= total_probability
    foul_probability /= total_probability
    in_play_probability /= total_probability
    return {
        "called_strike_prob": called_strike_probability,
        "ball_prob": ball_probability,
        "swing_prob": swing_probability,
        "whiff_prob": whiff_on_swing,
        "foul_prob": foul_probability,
        "in_play_prob": in_play_probability,
        "swinging_strike_prob": swinging_strike_probability,
    }


def _solve_plate_appearance_probabilities(metrics: dict, shared_targets: dict, batter_index: int) -> dict:
    @lru_cache(maxsize=None)
    def solve_state(balls: int, strikes: int) -> tuple[float, float, float]:
        heads = _transition_heads(metrics, shared_targets, balls, strikes, batter_index)
        called_strike_probability = heads["called_strike_prob"]
        ball_probability = heads["ball_prob"]
        swinging_strike_probability = heads["swinging_strike_prob"]
        foul_probability = heads["foul_prob"]
        in_play_probability = heads["in_play_prob"]

        strike_advance_probability = called_strike_probability + swinging_strike_probability
        if strikes >= 2:
            denominator = max(1 - foul_probability, 1e-6)
            strikeout_probability = strike_advance_probability
            walk_probability = 0.0
            expected_pitches = 1.0
            if balls >= 3:
                walk_probability += ball_probability
            else:
                next_strikeout_probability, next_walk_probability, next_pitch_count = solve_state(balls + 1, strikes)
                walk_probability += ball_probability * next_walk_probability
                strikeout_probability += ball_probability * next_strikeout_probability
                expected_pitches += ball_probability * next_pitch_count
            return (
                clamp(strikeout_probability / denominator, 0.0, 1.0),
                clamp(walk_probability / denominator, 0.0, 1.0),
                max(expected_pitches / denominator, 1.0),
            )

        strikeout_probability = 0.0
        walk_probability = 0.0
        expected_pitches = 1.0
        if strikes + 1 >= 3:
            strikeout_probability += strike_advance_probability
        else:
            next_strikeout_probability, next_walk_probability, next_pitch_count = solve_state(balls, strikes + 1)
            strikeout_probability += strike_advance_probability * next_strikeout_probability
            walk_probability += strike_advance_probability * next_walk_probability
            expected_pitches += strike_advance_probability * next_pitch_count

        if balls + 1 >= 4:
            walk_probability += ball_probability
        else:
            next_strikeout_probability, next_walk_probability, next_pitch_count = solve_state(balls + 1, strikes)
            strikeout_probability += ball_probability * next_strikeout_probability
            walk_probability += ball_probability * next_walk_probability
            expected_pitches += ball_probability * next_pitch_count

        next_strikeout_probability, next_walk_probability, next_pitch_count = solve_state(balls, strikes + 1)
        strikeout_probability += foul_probability * next_strikeout_probability
        walk_probability += foul_probability * next_walk_probability
        expected_pitches += foul_probability * next_pitch_count
        return (
            clamp(strikeout_probability, 0.0, 1.0),
            clamp(walk_probability, 0.0, 1.0),
            max(expected_pitches, 1.0),
        )

    strikeout_probability, walk_probability, expected_pitches = solve_state(0, 0)
    target_k_probability = shared_targets["matchupAdjustedKRate"] / 100.0
    target_walk_probability = shared_targets["matchupAdjustedWalkRate"] / 100.0
    adjusted_strikeout_probability = clamp(
        strikeout_probability * 0.42 + target_k_probability * 0.58,
        0.08,
        0.48,
    )
    adjusted_walk_probability = clamp(
        walk_probability * 0.42 + target_walk_probability * 0.58,
        0.02,
        0.24,
    )
    if adjusted_strikeout_probability + adjusted_walk_probability >= 0.92:
        scale = 0.92 / (adjusted_strikeout_probability + adjusted_walk_probability)
        adjusted_strikeout_probability *= scale
        adjusted_walk_probability *= scale
    return {
        "strikeoutProbability": adjusted_strikeout_probability,
        "walkProbability": adjusted_walk_probability,
        "expectedPitches": expected_pitches,
        "heads": _transition_heads(metrics, shared_targets, 0, 0, batter_index),
    }


def _build_batter_probability_paths(metrics: dict, shared_targets: dict, opportunity: dict) -> dict:
    projected_batters_faced = opportunity["projectedBattersFaced"]
    whole_batters = int(projected_batters_faced)
    partial_batter_weight = projected_batters_faced - whole_batters
    strikeout_probabilities: list[float] = []
    walk_probabilities: list[float] = []
    pitch_expectations: list[float] = []
    head_samples: list[dict] = []
    total_batters = whole_batters + (1 if partial_batter_weight > 0.01 else 0)
    for batter_index in range(total_batters):
        pa_profile = _solve_plate_appearance_probabilities(metrics, shared_targets, batter_index + 1)
        fatigue_multiplier = clamp(
            1.0
            - max(batter_index + 1 - 18, 0) * 0.008
            - opportunity["inningsVolatility"] * 0.0007,
            0.82,
            1.06,
        )
        walk_fatigue_multiplier = clamp(
            1.0
            + max(batter_index + 1 - 18, 0) * 0.010
            + opportunity["pitchCountCap"] * 0.0007,
            0.86,
            1.22,
        )
        weight = partial_batter_weight if batter_index == whole_batters and partial_batter_weight > 0.01 else 1.0
        strikeout_probabilities.append(clamp(pa_profile["strikeoutProbability"] * fatigue_multiplier * weight, 0.0, 0.55))
        walk_probabilities.append(clamp(pa_profile["walkProbability"] * walk_fatigue_multiplier * weight, 0.0, 0.28))
        pitch_expectations.append(pa_profile["expectedPitches"])
        head_samples.append(pa_profile["heads"])
    average_heads = {
        "called_strike_prob": sum(sample["called_strike_prob"] for sample in head_samples) / max(len(head_samples), 1),
        "ball_prob": sum(sample["ball_prob"] for sample in head_samples) / max(len(head_samples), 1),
        "swing_prob": sum(sample["swing_prob"] for sample in head_samples) / max(len(head_samples), 1),
        "whiff_prob": sum(sample["whiff_prob"] for sample in head_samples) / max(len(head_samples), 1),
        "foul_prob": sum(sample["foul_prob"] for sample in head_samples) / max(len(head_samples), 1),
        "in_play_prob": sum(sample["in_play_prob"] for sample in head_samples) / max(len(head_samples), 1),
    }
    return {
        "strikeoutProbabilities": strikeout_probabilities,
        "walkProbabilities": walk_probabilities,
        "expectedPitchesPerPA": sum(pitch_expectations) / max(len(pitch_expectations), 1),
        "averageHeads": average_heads,
    }


def _pack_strikeout_projection(
    metrics: dict,
    opportunity: dict,
    shared_targets: dict,
    modeled_paths: dict,
    *,
    line_value: float,
    analysis_date: str | None,
) -> dict:
    distribution = build_count_probabilities(modeled_paths["strikeoutProbabilities"])
    mean_value = distribution_mean(distribution)
    variance = distribution_variance(distribution)
    over_line_probability_raw, under_line_probability_raw = line_probabilities_from_distribution(distribution, line_value)
    rule_era = rule_era_flag(analysis_date)
    calibration = calibrate_probability(
        over_line_probability_raw,
        market="pitcher_strikeouts",
        lineup_confirmed=opportunity["confirmedLineupSpots"] >= 9,
        rule_era=rule_era,
        validation_samples=int(metrics.get("battersFaced", 0.0)),
    )
    over_3_5 = calibrate_probability(
        line_probabilities_from_distribution(distribution, 3.5)[0],
        market="pitcher_strikeouts",
        lineup_confirmed=opportunity["confirmedLineupSpots"] >= 9,
        rule_era=rule_era,
        validation_samples=int(metrics.get("battersFaced", 0.0)),
    )["probability"]
    over_4_5 = calibrate_probability(
        line_probabilities_from_distribution(distribution, 4.5)[0],
        market="pitcher_strikeouts",
        lineup_confirmed=opportunity["confirmedLineupSpots"] >= 9,
        rule_era=rule_era,
        validation_samples=int(metrics.get("battersFaced", 0.0)),
    )["probability"]
    contact_heavy_penalty = weighted_average(
        [
            (inverse_scale_to_score(metrics.get("opponentStrikeoutRate", 22.0), 18.0, 28.0), 0.58),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 40.0, 65.0), 0.42),
        ],
        fallback=40.0,
    )
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.28),
            (metrics.get("sampleConfidenceScore", 68.0), 0.22),
            (opportunity["roleCertainty"], 0.18),
            (100 - opportunity["inningsVolatility"], 0.10),
            (100 - opportunity["earlyExitRisk"], 0.10),
            (100 - contact_heavy_penalty, 0.08),
            (opportunity["lineupConfidence"], 0.04),
        ],
        fallback=58.0,
    )
    uncertainty_score = relative_uncertainty_score(mean_value, variance, opportunity["inningsVolatility"])
    projection_layer = {
        "calledStrikeProb": round(modeled_paths["averageHeads"]["called_strike_prob"], 4),
        "ballProb": round(modeled_paths["averageHeads"]["ball_prob"], 4),
        "swingProb": round(modeled_paths["averageHeads"]["swing_prob"], 4),
        "whiffProb": round(modeled_paths["averageHeads"]["whiff_prob"], 4),
        "foulProb": round(modeled_paths["averageHeads"]["foul_prob"], 4),
        "inPlayProb": round(modeled_paths["averageHeads"]["in_play_prob"], 4),
        "expectedPitchesPerPlateAppearance": round(modeled_paths["expectedPitchesPerPA"], 2),
        "projectedBattersFaced": opportunity["projectedBattersFaced"],
        "expectedBattersFaced": opportunity["projectedBattersFaced"],
        "lineupVsPitcherHandKRate": round(metrics.get("lineupStrikeoutRateVsHand", metrics.get("opponentStrikeoutRate", 22.0)), 1),
        "matchupAdjustedKRate": shared_targets["matchupAdjustedKRate"],
        "pitchMixAdvantage": round(metrics.get("pitchMixAdvantageScore", 50.0), 1),
        "lineupConfidence": opportunity["lineupConfidence"],
        "trackedLineupSpots": opportunity["trackedLineupSpots"],
        "confirmedLineupSpots": opportunity["confirmedLineupSpots"],
        "trueTalentKAbility": round(weighted_average([(scale_to_score(metrics.get("strikeoutRate", 22.0), 16.0, 34.0), 0.52), (scale_to_score(metrics.get("swingingStrikeRate", 11.5), 9.0, 17.5), 0.28), (scale_to_score(metrics.get("calledStrikePlusWhiffRate", 26.0), 20.0, 34.0), 0.20)]), 1),
        "opponentKTendencies": round(weighted_average([(scale_to_score(metrics.get("opponentStrikeoutRate", 22.0), 18.0, 28.0), 0.68), (inverse_scale_to_score(metrics.get("opponentContactQuality", 50.0), 40.0, 65.0), 0.32)]), 1),
        "umpireParkLineup": round(weighted_average([(scale_to_score(metrics.get("strikeoutParkFactor", 100.0), 92.0, 110.0), 0.42), (metrics.get("umpireZoneScore", 50.0), 0.24), (metrics.get("pitchMixAdvantageScore", 50.0), 0.18), (opportunity["lineupConfidence"], 0.16)]), 1),
        "pitchBudget": opportunity["pitchBudget"],
        "calibrationMethod": calibration["method"],
        "ruleEra": calibration["ruleEra"],
    }
    risk_layer = {
        "roleCertainty": opportunity["roleCertainty"],
        "inningsVolatility": opportunity["inningsVolatility"],
        "pitchCountCap": opportunity["pitchCountCap"],
        "earlyExitRisk": opportunity["earlyExitRisk"],
        "recentWorkload": round(weighted_average([(scale_to_score(metrics.get("lastPitchCount", metrics.get("averagePitchCount", 88.0)), 70.0, 108.0), 0.58), (scale_to_score(metrics.get("averagePitchCount", 85.0), 68.0, 102.0), 0.42)]), 1),
        "contactHeavyOpponentPenalty": round(contact_heavy_penalty, 1),
        "pitchBudget": opportunity["pitchBudget"],
    }
    return {
        "lineValue": line_value,
        "meanKs": round(mean_value, 2),
        "medianKs": round(distribution_median(distribution), 1),
        "meanValue": round(mean_value, 2),
        "medianValue": round(distribution_median(distribution), 1),
        "projectedStrikeouts": round(mean_value, 2),
        "overLineProbability": calibration["probability"],
        "underLineProbability": round(clamp(1 - calibration["probability"], 0.01, 0.99), 4),
        "over3_5Probability": over_3_5,
        "over4_5Probability": over_4_5,
        "confidence": "core" if confidence_score >= 78 or over_4_5 >= 0.62 else "strong" if confidence_score >= 64 or over_4_5 >= 0.48 else "watch",
        "confidenceScore": round(confidence_score, 1),
        "uncertaintyScore": round(uncertainty_score, 1),
        "projectionLayer": projection_layer,
        "riskLayer": risk_layer,
        "distribution": distribution_to_map(distribution),
        "modelType": "count_transition_markov",
    }


def _pack_walk_projection(
    metrics: dict,
    opportunity: dict,
    shared_targets: dict,
    modeled_paths: dict,
    *,
    line_value: float,
    analysis_date: str | None,
) -> dict:
    distribution = build_count_probabilities(modeled_paths["walkProbabilities"])
    mean_value = distribution_mean(distribution)
    variance = distribution_variance(distribution)
    over_line_probability_raw, under_line_probability_raw = line_probabilities_from_distribution(distribution, line_value)
    rule_era = rule_era_flag(analysis_date)
    calibration = calibrate_probability(
        over_line_probability_raw,
        market="pitcher_walks",
        lineup_confirmed=opportunity["confirmedLineupSpots"] >= 9,
        rule_era=rule_era,
        validation_samples=int(metrics.get("battersFaced", 0.0)),
    )
    command_score = weighted_average(
        [
            (inverse_scale_to_score(metrics.get("walkRate", 8.0), 4.0, 12.0), 0.22),
            (inverse_scale_to_score(metrics.get("recentWalkRate", metrics.get("walkRate", 8.0)), 4.0, 12.0), 0.20),
            (scale_to_score(metrics.get("firstPitchStrikeRate", 60.5), 55.0, 69.0), 0.16),
            (scale_to_score(metrics.get("zoneRate", 48.5), 42.0, 56.0), 0.12),
            (scale_to_score(metrics.get("chaseInducedRate", 28.0), 22.0, 38.0), 0.12),
            (scale_to_score(metrics.get("calledStrikePlusWhiffRate", 26.0), 20.0, 33.0), 0.10),
            (inverse_scale_to_score(metrics.get("threeBallCountRate", 16.5), 10.0, 30.0), 0.08),
        ],
        fallback=50.0,
    )
    lineup_patience_score = weighted_average(
        [
            (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5.0, 12.0), 0.42),
            (inverse_scale_to_score(metrics.get("opponentChaseRate", 29.5), 22.0, 36.0), 0.28),
            (metrics.get("opponentPatienceScore", 50.0), 0.18),
            (scale_to_score(metrics.get("handednessSplitWalkRate", metrics.get("walkRate", 8.0)), 4.0, 11.0), 0.12),
        ],
        fallback=50.0,
    )
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.26),
            (metrics.get("sampleConfidenceScore", 68.0), 0.22),
            (100 - relative_uncertainty_score(mean_value, variance, opportunity["inningsVolatility"]), 0.18),
            (opportunity["roleCertainty"], 0.14),
            (clamp(metrics.get("recentCommandTrend", 50.0), 0.0, 100.0), 0.10),
            (opportunity["lineupConfidence"], 0.10),
        ],
        fallback=58.0,
    )
    uncertainty_score = relative_uncertainty_score(mean_value, variance, lineup_patience_score)
    projection_layer = {
        "calledStrikeProb": round(modeled_paths["averageHeads"]["called_strike_prob"], 4),
        "ballProb": round(modeled_paths["averageHeads"]["ball_prob"], 4),
        "swingProb": round(modeled_paths["averageHeads"]["swing_prob"], 4),
        "whiffProb": round(modeled_paths["averageHeads"]["whiff_prob"], 4),
        "foulProb": round(modeled_paths["averageHeads"]["foul_prob"], 4),
        "inPlayProb": round(modeled_paths["averageHeads"]["in_play_prob"], 4),
        "projectedBattersFaced": opportunity["projectedBattersFaced"],
        "seasonWalkRate": round(metrics.get("walkRate", 8.0), 1),
        "recentWalkRate": round(metrics.get("recentWalkRate", metrics.get("walkRate", 8.0)), 1),
        "firstPitchStrikeRate": round(metrics.get("firstPitchStrikeRate", 60.5), 1),
        "zoneRate": round(metrics.get("zoneRate", 48.5), 1),
        "chaseInducedRate": round(metrics.get("chaseInducedRate", 28.0), 1),
        "calledStrikePlusWhiffRate": round(metrics.get("calledStrikePlusWhiffRate", 26.0), 1),
        "threeBallCountRate": round(metrics.get("threeBallCountRate", 16.5), 1),
        "opponentWalkRate": round(metrics.get("opponentWalkRate", 8.0), 1),
        "opponentChaseRate": round(metrics.get("opponentChaseRate", 29.5), 1),
        "opponentPatienceScore": round(metrics.get("opponentPatienceScore", 50.0), 1),
        "walkEnvironmentScore": round(weighted_average([(inverse_scale_to_score(metrics.get("walkParkFactor", metrics.get("parkFactor", 100.0)), 96.0, 104.0), 0.30), (metrics.get("framingSupportScore", 50.0), 0.34), (metrics.get("umpireZoneScore", 50.0), 0.28), (metrics.get("defenseSupportScore", 50.0), 0.08)]), 1),
        "matchupAdjustedWalkRate": shared_targets["matchupAdjustedWalkRate"],
        "handednessSplitWalkRate": round(metrics.get("handednessSplitWalkRate", metrics.get("walkRate", 8.0)), 1),
        "expectedPitchesPerPlateAppearance": round(modeled_paths["expectedPitchesPerPA"], 2),
        "calibrationMethod": calibration["method"],
        "ruleEra": calibration["ruleEra"],
    }
    risk_layer = {
        "roleCertainty": opportunity["roleCertainty"],
        "commandScore": round(command_score, 1),
        "inningsVolatility": opportunity["inningsVolatility"],
        "pitchCountCap": opportunity["pitchCountCap"],
        "earlyExitRisk": opportunity["earlyExitRisk"],
        "lineupConfidence": opportunity["lineupConfidence"],
        "recentCommandTrend": round(clamp(metrics.get("recentCommandTrend", 50.0), 0.0, 100.0), 1),
        "recentLeashTrend": opportunity["recentLeashTrend"],
    }
    return {
        "lineValue": line_value,
        "meanWalks": round(mean_value, 2),
        "medianWalks": round(distribution_median(distribution), 1),
        "meanValue": round(mean_value, 2),
        "medianValue": round(distribution_median(distribution), 1),
        "projectionValue": round(mean_value, 2),
        "overLineProbability": calibration["probability"],
        "underLineProbability": round(clamp(1 - calibration["probability"], 0.01, 0.99), 4),
        "confidence": quality_bucket(confidence_score),
        "confidenceScore": round(confidence_score, 1),
        "uncertaintyScore": round(uncertainty_score, 1),
        "projectionLayer": projection_layer,
        "riskLayer": risk_layer,
        "distribution": distribution_to_map(distribution),
        "modelType": "count_transition_markov",
    }


def build_pitcher_count_transition_bundle(
    pitcher: dict,
    *,
    strikeout_line: float = 4.5,
    walk_line: float = 2.5,
    analysis_date: str | None = None,
) -> dict:
    metrics = pitcher["metrics"]
    opportunity = build_pitcher_opportunity(metrics)
    shared_targets = _shared_count_targets(metrics, opportunity)
    modeled_paths = _build_batter_probability_paths(metrics, shared_targets, opportunity)
    strikeout_projection = _pack_strikeout_projection(
        metrics,
        opportunity,
        shared_targets,
        modeled_paths,
        line_value=strikeout_line,
        analysis_date=analysis_date,
    )
    walk_projection = _pack_walk_projection(
        metrics,
        opportunity,
        shared_targets,
        modeled_paths,
        line_value=walk_line,
        analysis_date=analysis_date,
    )
    lineup_confirmed = opportunity["confirmedLineupSpots"] >= 9
    shared_flags = build_data_quality_flags(
        metrics,
        lineup_confirmed=lineup_confirmed,
        market="pitcher_strikeouts",
        required_features=("strikeoutRate", "walkRate", "swingingStrikeRate", "opponentStrikeoutRate"),
    )
    strikeout_projection["dataQualityFlags"] = shared_flags
    walk_projection["dataQualityFlags"] = build_data_quality_flags(
        metrics,
        lineup_confirmed=lineup_confirmed,
        market="pitcher_walks",
        required_features=("walkRate", "firstPitchStrikeRate", "zoneRate", "opponentWalkRate"),
    )
    return {
        "pitcher_strikeouts": strikeout_projection,
        "pitcher_walks": walk_projection,
    }


def project_pitcher_strikeouts(
    pitcher: dict,
    *,
    line_value: float = 4.5,
    analysis_date: str | None = None,
) -> dict:
    return build_pitcher_count_transition_bundle(
        pitcher,
        strikeout_line=line_value,
        walk_line=2.5,
        analysis_date=analysis_date,
    )["pitcher_strikeouts"]


def project_pitcher_walks(
    pitcher: dict,
    *,
    line_value: float = 2.5,
    analysis_date: str | None = None,
) -> dict:
    return build_pitcher_count_transition_bundle(
        pitcher,
        strikeout_line=4.5,
        walk_line=line_value,
        analysis_date=analysis_date,
    )["pitcher_walks"]
