HITTER_WEIGHTS = {
    "overall": {
        "split_skill": 0.17,
        "power": 0.13,
        "discipline": 0.11,
        "contact_quality": 0.14,
        "recent_form": 0.12,
        "matchup_fit": 0.12,
        "environment": 0.11,
        "context": 0.10,
    },
    "home_run": {
        "raw_power": 0.22,
        "barrels": 0.16,
        "airball_shape": 0.12,
        "pitcher_damage": 0.16,
        "park_weather": 0.14,
        "matchup_fit": 0.12,
        "recent_form": 0.08,
    },
    "hits": {
        "bat_to_ball": 0.24,
        "on_base": 0.16,
        "split_skill": 0.16,
        "matchup_fit": 0.12,
        "environment": 0.10,
        "recent_form": 0.12,
        "context": 0.10,
    },
    "risk": {
        "strikeouts": 0.34,
        "whiff": 0.18,
        "pitcher_stuff": 0.18,
        "zone_fit": 0.10,
        "context": 0.10,
        "recent_slump": 0.10,
    },
}

PITCHER_WEIGHTS = {
    "overall": {
        "run_prevention": 0.22,
        "strikeouts": 0.16,
        "control": 0.14,
        "contact_suppression": 0.16,
        "recent_form": 0.12,
        "matchup": 0.12,
        "environment": 0.08,
    },
    "strikeout": {
        "strikeouts": 0.34,
        "swing_miss": 0.22,
        "command": 0.10,
        "opponent_k": 0.20,
        "workload": 0.14,
    },
}
