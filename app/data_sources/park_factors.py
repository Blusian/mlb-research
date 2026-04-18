from __future__ import annotations

from app.utils.math_utils import clamp


HOME_TEAM_COORDINATES: dict[str, dict[str, float]] = {
    "ARI": {"latitude": 33.4455, "longitude": -112.0667},
    "ATL": {"latitude": 33.8907, "longitude": -84.4677},
    "ATH": {"latitude": 38.5802, "longitude": -121.5090},
    "BAL": {"latitude": 39.2839, "longitude": -76.6217},
    "BOS": {"latitude": 42.3467, "longitude": -71.0972},
    "CHC": {"latitude": 41.9484, "longitude": -87.6553},
    "CIN": {"latitude": 39.0979, "longitude": -84.5081},
    "CLE": {"latitude": 41.4962, "longitude": -81.6852},
    "COL": {"latitude": 39.7559, "longitude": -104.9942},
    "CWS": {"latitude": 41.8300, "longitude": -87.6338},
    "DET": {"latitude": 42.3390, "longitude": -83.0485},
    "HOU": {"latitude": 29.7573, "longitude": -95.3555},
    "KC": {"latitude": 39.0517, "longitude": -94.4803},
    "LAA": {"latitude": 33.8003, "longitude": -117.8827},
    "LAD": {"latitude": 34.0739, "longitude": -118.2400},
    "MIA": {"latitude": 25.7781, "longitude": -80.2197},
    "MIL": {"latitude": 43.0280, "longitude": -87.9712},
    "MIN": {"latitude": 44.9817, "longitude": -93.2778},
    "NYM": {"latitude": 40.7571, "longitude": -73.8458},
    "NYY": {"latitude": 40.8296, "longitude": -73.9262},
    "OAK": {"latitude": 38.5802, "longitude": -121.5090},
    "PHI": {"latitude": 39.9061, "longitude": -75.1665},
    "PIT": {"latitude": 40.4469, "longitude": -80.0057},
    "SD": {"latitude": 32.7073, "longitude": -117.1573},
    "SEA": {"latitude": 47.5914, "longitude": -122.3325},
    "SF": {"latitude": 37.7786, "longitude": -122.3893},
    "STL": {"latitude": 38.6226, "longitude": -90.1928},
    "TB": {"latitude": 27.7682, "longitude": -82.6534},
    "TEX": {"latitude": 32.7473, "longitude": -97.0842},
    "TOR": {"latitude": 43.6414, "longitude": -79.3894},
    "WAS": {"latitude": 38.8730, "longitude": -77.0074},
}

_BLUEPRINTS = {
    "ARI": {"park_factor": 102, "home_run_factor": 101, "left_hr_delta": 1, "right_hr_delta": 0},
    "ATL": {"park_factor": 103, "home_run_factor": 108, "left_hr_delta": 3, "right_hr_delta": 1},
    "BAL": {"park_factor": 100, "home_run_factor": 103, "left_hr_delta": -2, "right_hr_delta": 2},
    "BOS": {"park_factor": 106, "home_run_factor": 99, "left_hr_delta": 4, "right_hr_delta": -6},
    "CHC": {"park_factor": 101, "home_run_factor": 97, "left_hr_delta": -1, "right_hr_delta": -1},
    "CIN": {"park_factor": 106, "home_run_factor": 111, "left_hr_delta": 4, "right_hr_delta": 2},
    "CLE": {"park_factor": 98, "home_run_factor": 96, "left_hr_delta": -1, "right_hr_delta": -2},
    "COL": {"park_factor": 115, "home_run_factor": 118, "left_hr_delta": 1, "right_hr_delta": 1},
    "CWS": {"park_factor": 98, "home_run_factor": 101, "left_hr_delta": 1, "right_hr_delta": 1},
    "DET": {"park_factor": 97, "home_run_factor": 94, "left_hr_delta": 1, "right_hr_delta": -2},
    "HOU": {"park_factor": 100, "home_run_factor": 100, "left_hr_delta": 5, "right_hr_delta": -3},
    "KC": {"park_factor": 98, "home_run_factor": 94, "left_hr_delta": -1, "right_hr_delta": -2},
    "LAA": {"park_factor": 99, "home_run_factor": 104, "left_hr_delta": 1, "right_hr_delta": 2},
    "LAD": {"park_factor": 100, "home_run_factor": 102, "left_hr_delta": 2, "right_hr_delta": 0},
    "MIA": {"park_factor": 95, "home_run_factor": 92, "left_hr_delta": 0, "right_hr_delta": -1},
    "MIL": {"park_factor": 100, "home_run_factor": 103, "left_hr_delta": 1, "right_hr_delta": 1},
    "MIN": {"park_factor": 100, "home_run_factor": 101, "left_hr_delta": 2, "right_hr_delta": 0},
    "NYM": {"park_factor": 98, "home_run_factor": 97, "left_hr_delta": 1, "right_hr_delta": -1},
    "NYY": {"park_factor": 104, "home_run_factor": 108, "left_hr_delta": 9, "right_hr_delta": -5},
    "ATH": {"park_factor": 95, "home_run_factor": 93, "left_hr_delta": 0, "right_hr_delta": -1},
    "OAK": {"park_factor": 95, "home_run_factor": 93, "left_hr_delta": 0, "right_hr_delta": -1},
    "PHI": {"park_factor": 104, "home_run_factor": 112, "left_hr_delta": 4, "right_hr_delta": 2},
    "PIT": {"park_factor": 98, "home_run_factor": 95, "left_hr_delta": 2, "right_hr_delta": -2},
    "SD": {"park_factor": 96, "home_run_factor": 94, "left_hr_delta": 1, "right_hr_delta": -1},
    "SEA": {"park_factor": 95, "home_run_factor": 92, "left_hr_delta": 2, "right_hr_delta": -3},
    "SF": {"park_factor": 95, "home_run_factor": 88, "left_hr_delta": 4, "right_hr_delta": -7},
    "STL": {"park_factor": 99, "home_run_factor": 95, "left_hr_delta": 0, "right_hr_delta": -1},
    "TB": {"park_factor": 97, "home_run_factor": 95, "left_hr_delta": 0, "right_hr_delta": -1},
    "TEX": {"park_factor": 99, "home_run_factor": 97, "left_hr_delta": 1, "right_hr_delta": 0},
    "TOR": {"park_factor": 101, "home_run_factor": 104, "left_hr_delta": 2, "right_hr_delta": 1},
    "WAS": {"park_factor": 100, "home_run_factor": 102, "left_hr_delta": 3, "right_hr_delta": 0},
}


def resolve_park_factors(home_team: str, batter_hand: str) -> dict[str, float]:
    blueprint = _BLUEPRINTS.get(
        home_team,
        {"park_factor": 100, "home_run_factor": 100, "left_hr_delta": 0, "right_hr_delta": 0},
    )
    park_factor = blueprint["park_factor"]
    if batter_hand == "L":
        hr_factor = clamp(blueprint["home_run_factor"] + blueprint["left_hr_delta"], 75, 135)
    elif batter_hand == "R":
        hr_factor = clamp(blueprint["home_run_factor"] + blueprint["right_hr_delta"], 75, 135)
    else:
        hr_factor = blueprint["home_run_factor"]
    hit_factor = round(park_factor * 0.72 + hr_factor * 0.28)
    return {
        "park_factor": park_factor,
        "hit_factor": hit_factor,
        "single_factor": round(park_factor * 0.82 + 18),
        "double_factor": round(park_factor * 0.58 + hr_factor * 0.22 + 20),
        "triple_factor": round(park_factor * 0.64 + (200 - hr_factor) * 0.24 + 12),
        "home_run_factor": hr_factor,
        "walk_factor": round(park_factor * 0.22 + 78),
        "strikeout_factor": round((200 - park_factor) * 0.16 + 84),
    }
