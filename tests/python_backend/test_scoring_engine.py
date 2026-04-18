from __future__ import annotations

import unittest

from app.scoring.engine import (
    derive_home_run_probability,
    derive_pitcher_outs_prop,
    derive_pitcher_walk_prop,
    derive_strikeout_prop,
    estimate_pitcher_outs,
    estimate_pitcher_strikeouts,
    estimate_pitcher_walks,
    score_hitter,
    score_pitcher,
)


class ScoringEngineTests(unittest.TestCase):
    def test_hitter_scoring_returns_expected_keys(self) -> None:
        hitter = {
            "metrics": {
                "averageVsHandedness": 0.286,
                "obpVsHandedness": 0.362,
                "sluggingVsHandedness": 0.541,
                "opsVsHandedness": 0.903,
                "isoVsHandedness": 0.255,
                "wobaVsHandedness": 0.382,
                "xwobaVsHandedness": 0.391,
                "xbaVsHandedness": 0.278,
                "xslgVsHandedness": 0.552,
                "strikeoutRate": 21.0,
                "walkRate": 9.2,
                "chaseRate": 28.0,
                "whiffRate": 24.0,
                "hardHitRate": 47.0,
                "barrelRate": 12.0,
                "averageExitVelocity": 92.0,
                "launchAngle": 16.0,
                "pullRate": 44.0,
                "flyBallRate": 40.0,
                "lineDriveRate": 23.0,
                "averageBatSpeed": 74.0,
                "squaredUpRate": 34.0,
                "contactRate": 76.0,
                "zoneContactRate": 85.0,
                "pitchMixMatchupScore": 61.0,
                "batterVsPitcherScore": 56.0,
                "velocityBandScore": 58.0,
                "zoneMatchupScore": 50.0,
                "movementMatchupScore": 50.0,
                "pitcherWeaknessExploitScore": 63.0,
                "starterExposureScore": 68.0,
                "weatherBoostScore": 58.0,
                "altitudeBoostScore": 50.0,
                "homeAwayAdjustment": 54.0,
                "lineupSpot": 3,
                "lineupConfirmed": True,
                "playingTimeConfidence": 96.0,
                "bullpenQualityEdge": 50.0,
                "bullpenHandednessEdge": 50.0,
                "restScore": 50.0,
                "injuryAdjustment": 50.0,
                "umpireZoneBoost": 50.0,
                "catcherFramingEdge": 50.0,
                "recentForm7": 70.0,
                "recentForm14": 68.0,
                "recentForm30": 63.0,
                "pitcherDamageScore": 63.0,
                "pitcherStrikeoutThreatScore": 57.0,
                "homeRunParkFactorVsHandedness": 112.0,
                "parkFactorVsHandedness": 104.0,
                "hitParkFactorVsHandedness": 105.0,
                "dataCoverageScore": 92.0,
                "sampleConfidenceScore": 84.0,
                "weatherDataQualityScore": 85.0,
                "groundBallRate": 37.0,
                "batterVsPitcherPlateAppearances": 8,
            }
        }
        scores = score_hitter(hitter)
        self.assertIn("overallHitScore", scores)
        self.assertIn("homeRunUpsideScore", scores)
        self.assertIn("marketConfidence", scores)
        self.assertIn("hits", scores["marketConfidence"])
        self.assertIn("runs", scores["marketConfidence"])
        self.assertIn("rbi", scores["marketConfidence"])
        self.assertIn("totalBases", scores["marketConfidence"])
        self.assertIn("walks", scores["marketConfidence"])
        self.assertGreater(scores["overallHitScore"], 0)
        self.assertGreater(scores["marketConfidence"]["hits"]["score"], 0)
        self.assertGreater(derive_home_run_probability({"metrics": hitter["metrics"], "scores": scores})["blendedProbability"], 0)

    def test_pitcher_scoring_returns_expected_keys(self) -> None:
        pitcher = {
            "metrics": {
                "era": 3.48,
                "fip": 3.62,
                "xFip": 3.71,
                "whip": 1.14,
                "strikeoutRate": 28.0,
                "walkRate": 7.0,
                "swingingStrikeRate": 13.0,
                "calledStrikePlusWhiffRate": 29.0,
                "pitchShapeScore": 61.0,
                "velocityScore": 66.0,
                "hardHitAllowed": 33.0,
                "barrelAllowed": 5.5,
                "averageExitVelocityAllowed": 87.7,
                "homeRunRateAllowed": 2.1,
                "groundBallRate": 45.0,
                "flyBallRate": 31.0,
                "recentForm7": 72.0,
                "recentForm14": 69.0,
                "recentForm30": 64.0,
                "opponentStrikeoutRate": 24.0,
                "opponentPowerRating": 49.0,
                "opponentContactQuality": 47.0,
                "bullpenSupportScore": 50.0,
                "framingSupportScore": 50.0,
                "umpireZoneScore": 50.0,
                "pitchMixAdvantageScore": 57.0,
                "parkFactor": 98.0,
                "homeRunParkFactor": 95.0,
                "strikeoutParkFactor": 103.0,
                "weatherRunPreventionScore": 57.0,
                "inningsProjection": 6.1,
                "timesThroughOrderPenalty": 54.0,
                "restScore": 50.0,
                "injuryAdjustment": 50.0,
                "dataCoverageScore": 90.0,
                "sampleConfidenceScore": 82.0,
                "weatherDataQualityScore": 85.0,
            }
        }
        scores = score_pitcher(pitcher)
        self.assertIn("overallPitcherScore", scores)
        self.assertIn("strikeoutUpsideScore", scores)
        self.assertGreater(scores["strikeoutUpsideScore"], 0)
        prop = derive_strikeout_prop({"metrics": pitcher["metrics"], "scores": scores})
        self.assertIn("meanKs", prop)
        self.assertIn("medianKs", prop)
        self.assertIn("over3_5Probability", prop)
        self.assertIn("over4_5Probability", prop)
        self.assertIn("projectionLayer", prop)
        self.assertIn("riskLayer", prop)
        self.assertGreater(prop["meanKs"], 0)
        self.assertGreaterEqual(prop["over3_5Probability"], prop["over4_5Probability"])
        self.assertEqual(prop["meanKs"], estimate_pitcher_strikeouts({"metrics": pitcher["metrics"], "scores": scores}))

    def test_pitcher_walk_and_outs_props_return_expected_keys(self) -> None:
        pitcher = {
            "metrics": {
                "era": 3.48,
                "fip": 3.62,
                "xFip": 3.71,
                "whip": 1.14,
                "strikeoutRate": 28.0,
                "walkRate": 7.0,
                "recentWalkRate": 8.2,
                "swingingStrikeRate": 13.0,
                "calledStrikePlusWhiffRate": 29.0,
                "pitchShapeScore": 61.0,
                "velocityScore": 66.0,
                "hardHitAllowed": 33.0,
                "barrelAllowed": 5.5,
                "averageExitVelocityAllowed": 87.7,
                "homeRunRateAllowed": 2.1,
                "groundBallRate": 45.0,
                "flyBallRate": 31.0,
                "recentForm7": 72.0,
                "recentForm14": 69.0,
                "recentForm30": 64.0,
                "recentForm": 69.0,
                "inningsProjection": 6.1,
                "averageInningsPerStart": 6.0,
                "averageBattersFaced": 24.8,
                "recentBattersFaced": 25.6,
                "recentInningsStd": 0.7,
                "averagePitchCount": 94.0,
                "lastPitchCount": 97.0,
                "pitchesPerPlateAppearance": 3.82,
                "recentPitchesPerPlateAppearance": 3.91,
                "recentCommandTrend": 46.0,
                "recentLeashTrend": 56.0,
                "quickHookRisk": 41.0,
                "opponentStrikeoutRate": 24.0,
                "opponentWalkRate": 9.1,
                "opponentChaseRate": 27.5,
                "opponentPatienceScore": 57.0,
                "opponentPowerRating": 49.0,
                "opponentContactQuality": 47.0,
                "bullpenSupportScore": 50.0,
                "opponentLineupConfirmed": True,
                "opponentLineupCount": 9,
                "opponentConfirmedHitterCount": 9,
                "opponentLineupConfidenceScore": 100.0,
                "projectedBattersFaced": 25.1,
                "parkFactor": 98.0,
                "homeRunParkFactor": 95.0,
                "walkParkFactor": 99.0,
                "strikeoutParkFactor": 103.0,
                "weatherRunPreventionScore": 57.0,
                "pitchMixAdvantageScore": 57.0,
                "framingSupportScore": 53.0,
                "umpireZoneScore": 55.0,
                "defenseSupportScore": 51.0,
                "bullpenContextScore": 50.0,
                "timesThroughOrderPenalty": 54.0,
                "restScore": 50.0,
                "injuryAdjustment": 50.0,
                "dataCoverageScore": 90.0,
                "sampleConfidenceScore": 82.0,
                "historicalConfidenceScore": 80.0,
                "weatherDataQualityScore": 85.0,
            }
        }
        scores = score_pitcher(pitcher)
        walk_prop = derive_pitcher_walk_prop({"metrics": pitcher["metrics"], "scores": scores}, 2.5)
        outs_prop = derive_pitcher_outs_prop({"metrics": pitcher["metrics"], "scores": scores}, 15.5)

        self.assertIn("meanWalks", walk_prop)
        self.assertIn("overLineProbability", walk_prop)
        self.assertIn("projectionLayer", walk_prop)
        self.assertIn("riskLayer", walk_prop)
        self.assertIn("meanOuts", outs_prop)
        self.assertIn("overLineProbability", outs_prop)
        self.assertIn("projectionLayer", outs_prop)
        self.assertIn("riskLayer", outs_prop)
        self.assertGreater(walk_prop["meanWalks"], 0)
        self.assertGreater(outs_prop["meanOuts"], 0)
        self.assertEqual(
            walk_prop["meanWalks"],
            estimate_pitcher_walks({"metrics": pitcher["metrics"], "scores": scores}),
        )
        self.assertEqual(
            outs_prop["meanOuts"],
            estimate_pitcher_outs({"metrics": pitcher["metrics"], "scores": scores}),
        )
        self.assertGreaterEqual(walk_prop["overLineProbability"], 0.01)
        self.assertGreaterEqual(outs_prop["overLineProbability"], 0.01)


if __name__ == "__main__":
    unittest.main()
