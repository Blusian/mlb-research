from __future__ import annotations

from app.services.feature_builder import (
    STABILIZATION_ANCHORS,
    build_data_quality_flags,
    build_hitter_opportunity,
    distribution_mean,
    distribution_median,
    distribution_to_map,
    distribution_variance,
    empirical_bayes_rate,
    line_probabilities_from_distribution,
    numeric_weighted_average,
    relative_uncertainty_score,
    rule_era_flag,
)
from app.services.prop_models.calibration import calibrate_probability
from app.utils.math_utils import clamp, inverse_scale_to_score, quality_bucket, scale_to_score, weighted_average


def _opposing_pitcher_metrics(opposing_pitcher: dict | None, hitter_metrics: dict) -> dict:
    pitcher_metrics = (opposing_pitcher or {}).get("metrics", {}) if opposing_pitcher else {}
    return {
        "xwobaAllowed": pitcher_metrics.get("xwobaAllowed", hitter_metrics.get("xwobaVsHandedness", 0.320)),
        "xslgAllowed": pitcher_metrics.get("xslgAllowed", hitter_metrics.get("xslgVsHandedness", 0.405)),
        "averageExitVelocityAllowed": pitcher_metrics.get("averageExitVelocityAllowed", 89.0),
        "hardHitAllowed": pitcher_metrics.get("hardHitAllowed", hitter_metrics.get("opponentPitcherContactAllowed", 50.0)),
        "barrelAllowed": pitcher_metrics.get("barrelAllowed", hitter_metrics.get("opponentPitcherPowerAllowed", 5.0) * 10),
        "walkRate": pitcher_metrics.get("walkRate", hitter_metrics.get("opponentPitcherWalkRateAllowed", 8.0)),
        "strikeoutRate": pitcher_metrics.get("strikeoutRate", 22.0),
        "throwingHand": (opposing_pitcher or {}).get("throwingHand") or hitter_metrics.get("opposingPitcherHand") or "U",
    }


def _contact_quality_score(metrics: dict, opposing_pitcher_metrics: dict) -> float:
    return weighted_average(
        [
            (scale_to_score(metrics.get("xwobaVsHandedness", 0.320), 0.28, 0.44), 0.24),
            (scale_to_score(metrics.get("xbaVsHandedness", 0.245), 0.21, 0.34), 0.18),
            (scale_to_score(metrics.get("xslgVsHandedness", 0.405), 0.32, 0.68), 0.18),
            (scale_to_score(metrics.get("hardHitRate", 40.0), 28.0, 58.0), 0.12),
            (scale_to_score(metrics.get("barrelRate", 8.0), 2.0, 20.0), 0.10),
            (scale_to_score(metrics.get("averageExitVelocity", 89.0), 86.0, 96.0), 0.08),
            (inverse_scale_to_score(opposing_pitcher_metrics["xwobaAllowed"], 0.28, 0.39), 0.10),
        ],
        fallback=50.0,
    )


def _power_score(metrics: dict, opposing_pitcher_metrics: dict) -> float:
    return weighted_average(
        [
            (scale_to_score(metrics.get("xslgVsHandedness", 0.405), 0.32, 0.68), 0.24),
            (scale_to_score(metrics.get("isoVsHandedness", 0.165), 0.09, 0.33), 0.20),
            (scale_to_score(metrics.get("barrelRate", 8.0), 2.0, 20.0), 0.16),
            (scale_to_score(metrics.get("hardHitRate", 40.0), 28.0, 58.0), 0.10),
            (scale_to_score(metrics.get("averageBatSpeed", 72.0), 68.0, 79.0), 0.10),
            (scale_to_score(metrics.get("blastRate", 8.0), 3.0, 20.0), 0.08),
            (scale_to_score(opposing_pitcher_metrics["xslgAllowed"], 0.32, 0.58), 0.12),
        ],
        fallback=50.0,
    )


def _base_rates(metrics: dict, opposing_pitcher_metrics: dict) -> dict:
    split_sample = metrics.get("currentSplitPlateAppearances", 0.0)
    historical_sample = metrics.get("previousSeasonsPlateAppearances", 0.0)
    career_sample = metrics.get("careerPlateAppearances", 0.0)
    batting_average = empirical_bayes_rate(
        season_value=metrics.get("averageVsHandedness"),
        season_sample=split_sample,
        recent30_value=metrics.get("xbaVsHandedness"),
        recent30_sample=split_sample * 0.65,
        vs_hand_value=metrics.get("xbaVsHandedness"),
        vs_hand_sample=split_sample,
        career_value=metrics.get("averageVsHandedness"),
        career_sample=career_sample,
        anchor=STABILIZATION_ANCHORS["single_rate"],
        fallback=metrics.get("averageVsHandedness", 0.245),
    )
    expected_slugging = empirical_bayes_rate(
        season_value=metrics.get("sluggingVsHandedness", metrics.get("xslgVsHandedness")),
        season_sample=split_sample,
        recent30_value=metrics.get("xslgVsHandedness"),
        recent30_sample=split_sample * 0.65,
        vs_hand_value=metrics.get("xslgVsHandedness"),
        vs_hand_sample=split_sample,
        career_value=metrics.get("sluggingVsHandedness", metrics.get("xslgVsHandedness")),
        career_sample=career_sample,
        anchor=STABILIZATION_ANCHORS["extra_base_rate"],
        fallback=metrics.get("xslgVsHandedness", 0.405),
    )
    walk_rate = empirical_bayes_rate(
        season_value=metrics.get("walkRate"),
        season_sample=split_sample,
        recent30_value=metrics.get("walkRate"),
        recent30_sample=split_sample * 0.55,
        vs_hand_value=metrics.get("walkRate"),
        vs_hand_sample=split_sample,
        career_value=metrics.get("walkRate"),
        career_sample=career_sample,
        anchor=STABILIZATION_ANCHORS["walk_rate"],
        fallback=metrics.get("walkRate", 8.0),
    )
    contact_quality_score = _contact_quality_score(metrics, opposing_pitcher_metrics)
    power_score = _power_score(metrics, opposing_pitcher_metrics)
    hit_probability = clamp(
        batting_average * 0.54
        + metrics.get("xbaVsHandedness", batting_average) * 0.20
        + opposing_pitcher_metrics["xwobaAllowed"] * 0.10
        + (contact_quality_score - 50.0) * 0.0012
        - (opposing_pitcher_metrics["strikeoutRate"] - 22.0) * 0.0016,
        0.14,
        0.44,
    )
    walk_probability = clamp(
        walk_rate / 100.0 * 0.74
        + opposing_pitcher_metrics["walkRate"] / 100.0 * 0.24
        + (metrics.get("walkParkFactorVsHandedness", 100.0) - 100.0) * 0.0006,
        0.03,
        0.18,
    )
    home_run_probability = clamp(
        0.016
        + (power_score - 50.0) * 0.0011
        + (metrics.get("homeRunParkFactorVsHandedness", 100.0) - 100.0) * 0.0007
        + (opposing_pitcher_metrics["xslgAllowed"] - 0.405) * 0.25
        - (opposing_pitcher_metrics["strikeoutRate"] - 22.0) * 0.0004,
        0.008,
        min(hit_probability * 0.52, 0.16),
    )
    double_probability = clamp(
        hit_probability
        * clamp(
            0.17
            + (metrics.get("launchAngle", 12.0) - 12.0) * 0.007
            + (metrics.get("doubleParkFactorVsHandedness", 100.0) - 100.0) * 0.0014
            + (power_score - 50.0) * 0.001,
            0.10,
            0.30,
        ),
        0.02,
        max(hit_probability - home_run_probability - 0.03, 0.03),
    )
    triple_probability = clamp(
        hit_probability
        * clamp(
            0.015
            + (metrics.get("tripleParkFactorVsHandedness", 100.0) - 100.0) * 0.0004
            + (metrics.get("averageBatSpeed", 72.0) - 72.0) * 0.0006,
            0.006,
            0.035,
        ),
        0.004,
        0.018,
    )
    single_probability = clamp(
        hit_probability - home_run_probability - double_probability - triple_probability,
        0.05,
        0.30,
    )
    hbp_probability = clamp(0.009 + (metrics.get("lineupSpot", 6) <= 2) * 0.002, 0.006, 0.018)
    total_event_probability = walk_probability + hbp_probability + single_probability + double_probability + triple_probability + home_run_probability
    if total_event_probability >= 0.96:
        scale = 0.96 / total_event_probability
        walk_probability *= scale
        hbp_probability *= scale
        single_probability *= scale
        double_probability *= scale
        triple_probability *= scale
        home_run_probability *= scale
    return {
        "battingAverage": batting_average,
        "expectedSlugging": expected_slugging,
        "walkProbability": walk_probability,
        "hbpProbability": hbp_probability,
        "singleProbability": single_probability,
        "doubleProbability": double_probability,
        "tripleProbability": triple_probability,
        "homeRunProbability": home_run_probability,
        "contactQualityScore": contact_quality_score,
        "powerScore": power_score,
    }


def _convolve_outcomes(
    projected_plate_appearances: float,
    outcome_weights: dict[str, float],
    *,
    total_bases: bool,
) -> list[float]:
    whole_plate_appearances = int(projected_plate_appearances)
    partial_plate_appearance = projected_plate_appearances - whole_plate_appearances
    distribution = [1.0]
    total_steps = whole_plate_appearances + (1 if partial_plate_appearance > 0.01 else 0)
    for appearance_index in range(total_steps):
        weight = partial_plate_appearance if appearance_index == whole_plate_appearances and partial_plate_appearance > 0.01 else 1.0
        if total_bases:
            step_distribution = [
                1
                - (
                    outcome_weights["single"]
                    + outcome_weights["double"]
                    + outcome_weights["triple"]
                    + outcome_weights["home_run"]
                )
                * weight,
                outcome_weights["single"] * weight,
                outcome_weights["double"] * weight,
                outcome_weights["triple"] * weight,
                outcome_weights["home_run"] * weight,
            ]
        else:
            hit_probability = (
                outcome_weights["single"]
                + outcome_weights["double"]
                + outcome_weights["triple"]
                + outcome_weights["home_run"]
            ) * weight
            step_distribution = [1 - hit_probability, hit_probability]
        next_distribution = [0.0] * (len(distribution) + len(step_distribution) - 1)
        for left_index, left_probability in enumerate(distribution):
            for right_index, right_probability in enumerate(step_distribution):
                next_distribution[left_index + right_index] += left_probability * right_probability
        distribution = next_distribution
    total_probability = sum(distribution)
    if total_probability <= 0:
        return [1.0]
    return [value / total_probability for value in distribution]


def _pack_hitter_projection(
    hitter: dict,
    opposing_pitcher: dict | None,
    *,
    market: str,
    line_value: float,
    analysis_date: str | None,
) -> dict:
    metrics = hitter["metrics"]
    opportunity = build_hitter_opportunity(metrics)
    opposing_pitcher_metrics = _opposing_pitcher_metrics(opposing_pitcher, metrics)
    base_rates = _base_rates(metrics, opposing_pitcher_metrics)
    projected_plate_appearances = opportunity["projectedPlateAppearances"]
    distribution = _convolve_outcomes(
        projected_plate_appearances,
        {
            "single": base_rates["singleProbability"],
            "double": base_rates["doubleProbability"],
            "triple": base_rates["tripleProbability"],
            "home_run": base_rates["homeRunProbability"],
        },
        total_bases=market == "hitter_total_bases",
    )
    mean_value = distribution_mean(distribution)
    variance = distribution_variance(distribution)
    over_line_probability_raw, under_line_probability_raw = line_probabilities_from_distribution(distribution, line_value)
    rule_era = rule_era_flag(analysis_date)
    calibration = calibrate_probability(
        over_line_probability_raw,
        market=market,
        lineup_confirmed=bool(metrics.get("lineupConfirmed", False)),
        rule_era=rule_era,
        validation_samples=int(metrics.get("currentSplitPlateAppearances", 0.0)),
    )
    strikeout_risk = weighted_average(
        [
            (scale_to_score(metrics.get("strikeoutRate", 22.0), 15.0, 36.0), 0.52),
            (inverse_scale_to_score(metrics.get("contactRate", 75.0), 64.0, 88.0), 0.24),
            (scale_to_score(opposing_pitcher_metrics["strikeoutRate"], 18.0, 34.0), 0.24),
        ],
        fallback=50.0,
    )
    pitcher_resistance = weighted_average(
        [
            (inverse_scale_to_score(opposing_pitcher_metrics["xwobaAllowed"], 0.28, 0.39), 0.34),
            (inverse_scale_to_score(opposing_pitcher_metrics["xslgAllowed"], 0.32, 0.58), 0.26),
            (inverse_scale_to_score(opposing_pitcher_metrics["averageExitVelocityAllowed"], 86.0, 94.0), 0.20),
            (inverse_scale_to_score(opposing_pitcher_metrics["hardHitAllowed"], 30.0, 48.0), 0.20),
        ],
        fallback=50.0,
    )
    uncertainty_score = relative_uncertainty_score(
        mean_value,
        variance,
        weighted_average(
            [
                (strikeout_risk, 0.34),
                (100 - opportunity["playingTimeConfidence"], 0.30),
                (scale_to_score(metrics.get("barrelRate", 8.0), 2.0, 20.0), 0.18),
                (100 - pitcher_resistance, 0.18),
            ],
            fallback=48.0,
        ),
    )
    confidence_score = weighted_average(
        [
            (metrics.get("dataCoverageScore", 70.0), 0.26),
            (metrics.get("sampleConfidenceScore", 68.0), 0.24),
            (opportunity["lineupConfidence"], 0.18),
            (100 - uncertainty_score, 0.16),
            (pitcher_resistance, 0.16),
        ],
        fallback=58.0,
    )
    projection_layer = {
        "projectedPlateAppearances": projected_plate_appearances,
        "walkProbabilityPerPA": round(base_rates["walkProbability"], 4),
        "hitProbabilityPerPA": round(
            base_rates["singleProbability"]
            + base_rates["doubleProbability"]
            + base_rates["tripleProbability"]
            + base_rates["homeRunProbability"],
            4,
        ),
        "singleProbabilityPerPA": round(base_rates["singleProbability"], 4),
        "doubleProbabilityPerPA": round(base_rates["doubleProbability"], 4),
        "tripleProbabilityPerPA": round(base_rates["tripleProbability"], 4),
        "homeRunProbabilityPerPA": round(base_rates["homeRunProbability"], 4),
        "expectedBattingAverage": round(base_rates["battingAverage"], 3),
        "expectedSlugging": round(base_rates["expectedSlugging"], 3),
        "contactQualityEdge": round(base_rates["contactQualityScore"], 1),
        "pitcherResistance": round(pitcher_resistance, 1),
        "parkFactorVsHandedness": round(metrics.get("parkFactorVsHandedness", 100.0), 1),
        "hitParkFactorVsHandedness": round(metrics.get("hitParkFactorVsHandedness", 100.0), 1),
        "lineupConfidence": opportunity["lineupConfidence"],
        "calibrationMethod": calibration["method"],
        "ruleEra": calibration["ruleEra"],
    }
    risk_layer = {
        "playingTimeConfidence": opportunity["playingTimeConfidence"],
        "strikeoutRisk": round(strikeout_risk, 1),
        "pitcherResistance": round(pitcher_resistance, 1),
        "lineupVolatility": round(100 - opportunity["lineupConfidence"], 1),
        "extraBaseVolatility": round(scale_to_score(metrics.get("barrelRate", 8.0), 2.0, 20.0), 1),
    }
    return {
        "lineValue": line_value,
        "projectionValue": round(mean_value, 2),
        "meanValue": round(mean_value, 2),
        "medianValue": round(distribution_median(distribution), 1),
        "overLineProbability": calibration["probability"],
        "underLineProbability": round(clamp(1 - calibration["probability"], 0.01, 0.99), 4),
        "confidence": quality_bucket(confidence_score),
        "confidenceScore": round(confidence_score, 1),
        "uncertaintyScore": round(uncertainty_score, 1),
        "projectionLayer": projection_layer,
        "riskLayer": risk_layer,
        "distribution": distribution_to_map(distribution),
        "modelType": "pa_outcome_convolution",
        "dataQualityFlags": build_data_quality_flags(
            metrics,
            lineup_confirmed=bool(metrics.get("lineupConfirmed", False)),
            market=market,
            required_features=(
                "averageVsHandedness",
                "xbaVsHandedness",
                "xslgVsHandedness",
                "walkRate",
            ),
        ),
    }


def build_hitter_outcome_bundle(
    hitter: dict,
    opposing_pitcher: dict | None = None,
    *,
    hits_line: float = 1.5,
    total_bases_line: float = 1.5,
    analysis_date: str | None = None,
) -> dict:
    return {
        "hitter_hits": _pack_hitter_projection(
            hitter,
            opposing_pitcher,
            market="hitter_hits",
            line_value=hits_line,
            analysis_date=analysis_date,
        ),
        "hitter_total_bases": _pack_hitter_projection(
            hitter,
            opposing_pitcher,
            market="hitter_total_bases",
            line_value=total_bases_line,
            analysis_date=analysis_date,
        ),
    }


def project_hitter_hits(
    hitter: dict,
    opposing_pitcher: dict | None = None,
    *,
    line_value: float = 1.5,
    analysis_date: str | None = None,
) -> dict:
    return build_hitter_outcome_bundle(
        hitter,
        opposing_pitcher,
        hits_line=line_value,
        total_bases_line=1.5,
        analysis_date=analysis_date,
    )["hitter_hits"]


def project_hitter_total_bases(
    hitter: dict,
    opposing_pitcher: dict | None = None,
    *,
    line_value: float = 1.5,
    analysis_date: str | None = None,
) -> dict:
    return build_hitter_outcome_bundle(
        hitter,
        opposing_pitcher,
        hits_line=1.5,
        total_bases_line=line_value,
        analysis_date=analysis_date,
    )["hitter_total_bases"]
