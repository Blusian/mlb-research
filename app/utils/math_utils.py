from __future__ import annotations

import math
from typing import Iterable


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def average(values: Iterable[float], fallback: float = 0.0) -> float:
    values = list(values)
    if not values:
        return fallback
    return sum(values) / len(values)


def parse_float(value: object, fallback: float = 0.0) -> float:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
            return parsed if math.isfinite(parsed) else fallback
        except ValueError:
            return fallback
    return fallback


def parse_decimal(value: object, fallback: float = 0.0) -> float:
    parsed = parse_float(value, fallback)
    return parsed / 100 if abs(parsed) > 1 else parsed


def parse_innings_pitched(value: object) -> float:
    innings = str(value or "0")
    whole, _, partial = innings.partition(".")
    outs = {"1": 1, "2": 2}.get(partial, 0)
    return parse_float(whole, 0) + outs / 3


def scale_to_score(value: float, minimum: float, maximum: float) -> float:
    if maximum <= minimum:
        return 50.0
    return clamp(((value - minimum) / (maximum - minimum)) * 100, 0, 100)


def inverse_scale_to_score(value: float, minimum: float, maximum: float) -> float:
    return 100 - scale_to_score(value, minimum, maximum)


def weighted_average(entries: list[tuple[float, float]], fallback: float = 50.0) -> float:
    total_weight = sum(weight for _, weight in entries)
    if total_weight <= 0:
        return fallback
    return clamp(sum(value * weight for value, weight in entries) / total_weight, 0, 100)


def logistic(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def lineup_spot_score(spot: int) -> float:
    mapping = {
        1: 100,
        2: 96,
        3: 93,
        4: 91,
        5: 84,
        6: 76,
        7: 67,
        8: 59,
        9: 54,
    }
    return mapping.get(spot, 55)


def quality_bucket(score: float) -> str:
    if score >= 80:
        return "elite"
    if score >= 68:
        return "strong"
    if score >= 55:
        return "watch"
    return "thin"
