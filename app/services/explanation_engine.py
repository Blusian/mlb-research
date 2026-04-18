from __future__ import annotations


def build_hitter_reasons(hitter: dict) -> list[str]:
    metrics = hitter["metrics"]
    scores = hitter["scores"]
    reasons: list[str] = []

    if metrics.get("isRookieSeason", False):
        reasons.append("Rookie-season warning: this is the player's first MLB season, so the long-term track record is still thin.")
    if scores["overallHitScore"] >= 70:
        reasons.append(
            f"Split skill is strong with a {metrics['wobaVsHandedness']:.3f} wOBA and {metrics['isoVsHandedness']:.3f} ISO in this handedness matchup."
        )
    if metrics.get("pitchMixMatchupScore", 50) >= 58 and metrics.get("pitchMixMatchupSample", 0) >= 6:
        reasons.append(
            f"The pitch mix grades well here, led by {metrics.get('primaryPitchTypeDescription', 'the primary pitch')} usage ({metrics.get('primaryPitchUsage', 0):.1f}%)."
        )
    if metrics.get("seasonGrowthPercent", 0) >= 8:
        reasons.append(
            f"Current-season performance is running about {metrics.get('seasonGrowthPercent', 0):.1f}% above the historical baseline."
        )
    if metrics.get("seasonGrowthPercent", 0) <= -8:
        reasons.append(
            f"The current season is tracking about {abs(metrics.get('seasonGrowthPercent', 0)):.1f}% below the historical baseline."
        )
    if metrics.get("batterVsPitcherPlateAppearances", 0) >= 6 and metrics.get("batterVsPitcherScore", 50) >= 60:
        reasons.append(
            f"Past meetings have been favorable with a {metrics.get('batterVsPitcherOps', 0.72):.3f} OPS over {metrics.get('batterVsPitcherPlateAppearances', 0)} plate appearances."
        )
    if scores["homeRunUpsideScore"] >= 70:
        reasons.append(
            f"Power indicators are live with {metrics['hardHitRate']:.1f}% hard-hit, {metrics['barrelRate']:.1f}% barrel, and {metrics['averageExitVelocity']:.1f} mph average exit velocity."
        )
    if metrics.get("homeRunParkFactorVsHandedness", 100) >= 106:
        reasons.append("The handedness-adjusted park setup is favorable for power tonight.")
    if scores["riskScore"] >= 62:
        reasons.append(
            f"There is real strikeout volatility here with {metrics['strikeoutRate']:.1f}% K rate and {metrics.get('whiffRate', 28):.1f}% whiff."
        )
    if not metrics.get("lineupConfirmed", False):
        reasons.append("The lineup is still projected, so playing-time confidence is a bit lower.")
    return reasons[:4]


def build_pitcher_reasons(pitcher: dict) -> list[str]:
    metrics = pitcher["metrics"]
    scores = pitcher["scores"]
    reasons: list[str] = []
    projected_ks = metrics.get("projectedStrikeoutsVsOpponent", 0.0)
    lineup_k_rate = metrics.get(
        "lineupVsPitcherHandKRate",
        metrics.get("opponentStrikeoutRate", 22.0),
    )
    if metrics.get("isRookieSeason", False):
        reasons.append("Rookie-season warning: this is the pitcher's first MLB season, so workload and talent stabilization matter more.")
    if scores["overallPitcherScore"] >= 70:
        reasons.append(
            f"Run-prevention profile is solid with {metrics.get('era', 4.10):.2f} ERA, {metrics.get('fip', 4.00):.2f} FIP, and {metrics.get('whip', 1.28):.2f} WHIP."
        )
    if scores["strikeoutUpsideScore"] >= 70:
        reasons.append(
            f"Strikeout path is strong with {metrics['strikeoutRate']:.1f}% K rate, {metrics['swingingStrikeRate']:.1f}% swinging-strike rate, and a {metrics['opponentStrikeoutRate']:.1f}% opposing K rate."
        )
    if projected_ks >= 5.0:
        reasons.append(
            f"Against {pitcher['opponent']['abbreviation']}, the lineup projects for about {projected_ks:.1f} Ks with a {lineup_k_rate:.1f}% strikeout rate versus {pitcher.get('throwingHand', 'that')} pitching."
        )
    if metrics.get("seasonGrowthPercent", 0) >= 8:
        reasons.append(
            f"The current season profile is about {metrics.get('seasonGrowthPercent', 0):.1f}% better than the historical baseline."
        )
    if metrics.get("seasonGrowthPercent", 0) <= -8:
        reasons.append(
            f"The current season profile is about {abs(metrics.get('seasonGrowthPercent', 0)):.1f}% weaker than the historical baseline."
        )
    if metrics.get("hardHitAllowed", 37) <= 34 and metrics.get("barrelAllowed", 7) <= 6:
        reasons.append("The contact suppression profile is stable, which supports the floor.")
    if metrics.get("opponentStrikeoutRate", 22) <= 20.5 and metrics.get("opponentContactQuality", 50) >= 53:
        reasons.append("The opposing lineup leans contact-first, which trims some strikeout ceiling.")
    if metrics.get("recentInningsStd", 0.0) >= 1.2 or metrics.get("lastPitchCount", 88) >= 102:
        reasons.append("Workload volatility is a little higher here, so pitch depth matters more than usual.")
    if metrics.get("homeRunParkFactor", 100) >= 108:
        reasons.append("The park is a little more dangerous for mistakes, so blow-up risk stays in play.")
    if metrics.get("opponentLineupCount", 0) and not metrics.get("opponentLineupConfirmed", False):
        reasons.append(
            f"The opposing lineup is still partly projected ({int(metrics.get('opponentConfirmedHitterCount', 0))}/{int(metrics.get('opponentLineupCount', 0))} hitters confirmed), so the matchup-specific K estimate is a little less settled."
        )
    return reasons[:4]
