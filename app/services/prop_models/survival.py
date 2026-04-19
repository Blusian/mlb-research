from __future__ import annotations

from app.services.feature_builder import (
    build_data_quality_flags,
    build_pitcher_opportunity,
    distribution_mean,
    distribution_median,
    distribution_to_map,
    distribution_variance,
    line_probabilities_from_distribution,
    relative_uncertainty_score,
    rule_era_flag,
)
from app.services.prop_models.calibration import calibrate_probability
from app.services.prop_models.count_transition import project_pitcher_walks
from app.utils.math_utils import clamp, inverse_scale_to_score, quality_bucket, scale_to_score, weighted_average


def project_pitcher_outs(
    pitcher: dict,
    *,
    line_value: float = 15.5,
    analysis_date: str | None = None,
    walk_projection: dict | None = None,
) -> dict:
    metrics = pitcher["metrics"]
    opportunity = build_pitcher_opportunity(metrics)
    walk_projection = walk_projection or project_pitcher_walks(
        pitcher,
        line_value=2.5,
        analysis_date=analysis_date,
    )
    projected_walks = walk_projection["meanWalks"]
    projected_batters_faced = int(max(round(opportunity["projectedBattersFaced"] + 4), 16))
    baseline_out_rate = clamp(
        (metrics.get("inningsProjection", 5.4) * 3.0) / max(opportunity["baselineExpectedBattersFaced"], 1.0),
        0.58,
        0.79,
    )
    contact_management_score = weighted_average(
        [
            (inverse_scale_to_score(metrics.get("hardHitAllowed", 35.0), 28.0, 48.0), 0.36),
            (inverse_scale_to_score(metrics.get("barrelAllowed", 7.0), 3.0, 12.0), 0.32),
            (inverse_scale_to_score(metrics.get("averageExitVelocityAllowed", 89.0), 85.0, 93.0), 0.20),
            (scale_to_score(metrics.get("groundBallRate", 43.0), 30.0, 56.0), 0.12),
        ],
        fallback=50.0,
    )
    support_score = weighted_average(
        [
            (metrics.get("defenseSupportScore", 50.0), 0.34),
            (metrics.get("bullpenContextScore", 50.0), 0.18),
            (inverse_scale_to_score(metrics.get("parkFactor", 100.0), 95.0, 112.0), 0.24),
            (inverse_scale_to_score(metrics.get("homeRunParkFactor", 100.0), 90.0, 120.0), 0.14),
            (metrics.get("restScore", 50.0), 0.10),
        ],
        fallback=50.0,
    )
    opponent_resistance = weighted_average(
        [
            (scale_to_score(metrics.get("opponentWalkRate", 8.0), 5.0, 12.0), 0.24),
            (inverse_scale_to_score(metrics.get("opponentStrikeoutRate", 22.0), 18.0, 28.0), 0.24),
            (scale_to_score(metrics.get("opponentContactQuality", 50.0), 40.0, 65.0), 0.22),
            (metrics.get("opponentPatienceScore", 50.0), 0.18),
            (scale_to_score(metrics.get("parkFactor", 100.0), 95.0, 112.0), 0.12),
        ],
        fallback=50.0,
    )
    alive_distribution = [0.0] * 28
    alive_distribution[0] = 1.0
    finished_distribution = [0.0] * 28
    expected_batters_faced = 0.0
    expected_pitches_per_plate_appearance = clamp(
        weighted_average(
            [
                (scale_to_score(opportunity["pitchesPerPlateAppearance"], 3.45, 4.75), 0.38),
                (scale_to_score(opportunity["recentPitchesPerPlateAppearance"], 3.40, 4.90), 0.30),
                (scale_to_score(walk_projection["projectionLayer"].get("expectedPitchesPerPlateAppearance", opportunity["pitchesPerPlateAppearance"]), 3.45, 4.90), 0.32),
            ],
            fallback=50.0,
        ),
        0.0,
        100.0,
    )
    expected_pitches_per_plate_appearance = round(3.45 + expected_pitches_per_plate_appearance / 100 * 1.45, 2)
    for batter_index in range(projected_batters_faced):
        batter_number = batter_index + 1
        alive_probability = sum(alive_distribution)
        if alive_probability <= 1e-8:
            break
        expected_batters_faced += alive_probability
        cumulative_pitch_count = expected_pitches_per_plate_appearance * batter_number
        times_through_order = batter_number / 9.0
        times_through_penalty = weighted_average(
            [
                (scale_to_score(max(times_through_order - 2.0, 0.0), 0.0, 1.1), 0.46),
                (scale_to_score(max(batter_number - 18.0, 0.0), 0.0, 9.0), 0.22),
                (scale_to_score(metrics.get("timesThroughOrderPenalty", 50.0), 35.0, 80.0), 0.32),
            ],
            fallback=40.0,
        )
        removal_hazard = clamp(
            0.02
            + max(cumulative_pitch_count - opportunity["pitchBudget"], 0.0) * 0.008
            + max(batter_number - opportunity["projectedBattersFaced"], 0.0) * 0.026
            + projected_walks * 0.018
            + (opportunity["quickHookRisk"] / 100.0) * 0.18
            + max(times_through_order - 2.0, 0.0) * 0.07
            + (metrics.get("opponentPatienceScore", 50.0) - 50.0) * 0.0012,
            0.01,
            0.68,
        )
        out_probability = clamp(
            baseline_out_rate
            * clamp(
                0.98
                + (contact_management_score - 50.0) * 0.0022
                + (support_score - 50.0) * 0.0016
                - max(projected_walks - 2.1, 0.0) * 0.028
                - (opponent_resistance - 50.0) * 0.0019
                - (times_through_penalty - 40.0) * 0.0025,
                0.78,
                1.08,
            ),
            0.50,
            0.82,
        )
        next_alive_distribution = [0.0] * 28
        for outs_recorded, probability in enumerate(alive_distribution):
            if probability <= 0:
                continue
            stay_probability = 1 - removal_hazard
            zero_out_probability = probability * (1 - out_probability)
            one_out_probability = probability * out_probability
            next_alive_distribution[outs_recorded] += zero_out_probability * stay_probability
            finished_distribution[outs_recorded] += zero_out_probability * removal_hazard
            next_outs = min(outs_recorded + 1, 27)
            next_alive_distribution[next_outs] += one_out_probability * stay_probability
            finished_distribution[next_outs] += one_out_probability * removal_hazard
        alive_distribution = next_alive_distribution
    finished_distribution = [
        finished_distribution[index] + alive_distribution[index]
        for index in range(len(finished_distribution))
    ]
    total_probability = sum(finished_distribution)
    if total_probability > 0:
        finished_distribution = [value / total_probability for value in finished_distribution]
    mean_outs = distribution_mean(finished_distribution)
    variance = distribution_variance(finished_distribution)
    over_line_probability_raw, under_line_probability_raw = line_probabilities_from_distribution(
        finished_distribution,
        line_value,
    )
    rule_era = rule_era_flag(analysis_date)
    calibration = calibrate_probability(
        over_line_probability_raw,
        market="pitcher_outs",
        lineup_confirmed=opportunity["confirmedLineupSpots"] >= 9,
        rule_era=rule_era,
        validation_samples=int(metrics.get("battersFaced", 0.0)),
    )
    uncertainty_score = relative_uncertainty_score(mean_outs, variance, opportunity["quickHookRisk"])
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.24),
            (metrics.get("sampleConfidenceScore", 68.0), 0.20),
            (opportunity["roleCertainty"], 0.18),
            (100 - uncertainty_score, 0.18),
            (100 - opportunity["quickHookRisk"], 0.10),
            (opportunity["lineupConfidence"], 0.10),
        ],
        fallback=58.0,
    )
    projection_layer = {
        "expectedPitchBudget": opportunity["pitchBudget"],
        "expectedPitchesPerPlateAppearance": expected_pitches_per_plate_appearance,
        "pitchBudgetBattersFaced": round(opportunity["pitchBudget"] / max(expected_pitches_per_plate_appearance, 3.3), 1),
        "projectedBattersFaced": opportunity["projectedBattersFaced"],
        "projectedWalks": round(projected_walks, 2),
        "baselineOutRate": round(baseline_out_rate, 3),
        "contactManagementScore": round(contact_management_score, 1),
        "supportScore": round(support_score, 1),
        "opponentResistance": round(opponent_resistance, 1),
        "survivalBattersFaced": round(expected_batters_faced, 1),
        "calibrationMethod": calibration["method"],
        "ruleEra": calibration["ruleEra"],
    }
    risk_layer = {
        "roleCertainty": opportunity["roleCertainty"],
        "quickHookRisk": opportunity["quickHookRisk"],
        "inningsVolatility": opportunity["inningsVolatility"],
        "pitchCountCap": opportunity["pitchCountCap"],
        "earlyExitRisk": opportunity["earlyExitRisk"],
        "timesThroughOrderPenalty": round(weighted_average([(scale_to_score(max(expected_batters_faced - 18.0, 0.0), 0.0, 8.0), 0.52), (scale_to_score(metrics.get("timesThroughOrderPenalty", 50.0), 35.0, 80.0), 0.48)]), 1),
        "lineupConfidence": opportunity["lineupConfidence"],
        "pitchCountCapValue": opportunity["pitchBudget"],
    }
    return {
        "lineValue": line_value,
        "meanOuts": round(mean_outs, 2),
        "medianOuts": round(distribution_median(finished_distribution), 1),
        "meanValue": round(mean_outs, 2),
        "medianValue": round(distribution_median(finished_distribution), 1),
        "projectionValue": round(mean_outs, 2),
        "overLineProbability": calibration["probability"],
        "underLineProbability": round(clamp(1 - calibration["probability"], 0.01, 0.99), 4),
        "confidence": quality_bucket(confidence_score),
        "confidenceScore": round(confidence_score, 1),
        "uncertaintyScore": round(uncertainty_score, 1),
        "projectionLayer": projection_layer,
        "riskLayer": risk_layer,
        "distribution": distribution_to_map(finished_distribution),
        "modelType": "discrete_time_survival",
        "dataQualityFlags": build_data_quality_flags(
            metrics,
            lineup_confirmed=opportunity["confirmedLineupSpots"] >= 9,
            market="pitcher_outs",
            required_features=("inningsProjection", "averagePitchCount", "recentBattersFaced"),
        ),
    }
