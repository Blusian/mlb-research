from __future__ import annotations

import math

from app.utils.math_utils import clamp, logistic


MARKET_SIGMOID_DEFAULTS: dict[str, tuple[float, float]] = {
    "pitcher_strikeouts": (1.08, -0.02),
    "pitcher_walks": (1.04, 0.01),
    "pitcher_outs": (1.02, -0.01),
    "hitter_hits": (1.00, -0.02),
    "hitter_total_bases": (1.06, -0.01),
}


def _logit(probability: float) -> float:
    clipped = clamp(probability, 1e-6, 1 - 1e-6)
    return math.log(clipped / (1 - clipped))


def _sigmoid_calibration(probability: float, alpha: float, beta: float) -> float:
    return logistic(alpha * _logit(probability) + beta)


def _isotonic_calibration(probability: float, isotonic_points: list[tuple[float, float]]) -> float:
    if not isotonic_points:
        return probability
    sorted_points = sorted((clamp(raw, 0.0, 1.0), clamp(calibrated, 0.0, 1.0)) for raw, calibrated in isotonic_points)
    if probability <= sorted_points[0][0]:
        return sorted_points[0][1]
    if probability >= sorted_points[-1][0]:
        return sorted_points[-1][1]
    for index in range(1, len(sorted_points)):
        left_raw, left_calibrated = sorted_points[index - 1]
        right_raw, right_calibrated = sorted_points[index]
        if left_raw <= probability <= right_raw:
            if right_raw <= left_raw:
                return right_calibrated
            progress = (probability - left_raw) / (right_raw - left_raw)
            return left_calibrated + progress * (right_calibrated - left_calibrated)
    return probability


def calibrate_probability(
    probability: float,
    *,
    market: str,
    lineup_confirmed: bool,
    rule_era: str,
    validation_samples: int | None = None,
    isotonic_points: list[tuple[float, float]] | None = None,
) -> dict:
    raw_probability = clamp(probability, 0.01, 0.99)
    effective_validation_samples = int(validation_samples or 0)
    market_alpha, market_beta = MARKET_SIGMOID_DEFAULTS.get(market, (1.0, 0.0))
    if not lineup_confirmed:
        market_alpha *= 0.96
        market_beta *= 0.55
    if market in {"pitcher_strikeouts", "pitcher_walks"} and rule_era == "post_abs_2026":
        if market == "pitcher_strikeouts":
            market_beta -= 0.03
        else:
            market_beta += 0.03
    if effective_validation_samples >= 1200 and isotonic_points:
        calibrated_probability = _isotonic_calibration(raw_probability, isotonic_points)
        method = "isotonic"
    else:
        calibrated_probability = _sigmoid_calibration(raw_probability, market_alpha, market_beta)
        method = "sigmoid"
    calibrated_probability = clamp(calibrated_probability, 0.01, 0.99)
    return {
        "probability": round(calibrated_probability, 4),
        "method": method,
        "ruleEra": rule_era,
        "lineupBucket": "official" if lineup_confirmed else "projected",
        "validationSamples": effective_validation_samples,
    }
