from __future__ import annotations

import copy
import unittest

from app.models.schemas import HitterStatProp, PitcherLineProp, PitcherStrikeoutProp
from app.services.prop_models.calibration import calibrate_probability
from app.services.prop_models.count_transition import project_pitcher_strikeouts, project_pitcher_walks
from app.services.prop_models.hitter_outcomes import project_hitter_hits, project_hitter_total_bases
from app.services.prop_models.survival import project_pitcher_outs


def _mock_pitcher() -> dict:
    return {
        "metrics": {
            "strikeoutRate": 27.8,
            "walkRate": 7.2,
            "recentWalkRate": 7.8,
            "swingingStrikeRate": 13.4,
            "calledStrikePlusWhiffRate": 29.3,
            "recentForm": 67.0,
            "recentForm7": 70.0,
            "recentForm30": 64.0,
            "inningsProjection": 6.0,
            "averageBattersFaced": 24.6,
            "recentBattersFaced": 25.4,
            "recentInningsStd": 0.7,
            "averagePitchCount": 94.0,
            "lastPitchCount": 96.0,
            "pitchesPerPlateAppearance": 3.85,
            "recentPitchesPerPlateAppearance": 3.92,
            "opponentStrikeoutRate": 24.2,
            "lineupStrikeoutRateVsHand": 24.8,
            "opponentWalkRate": 8.8,
            "opponentChaseRate": 27.8,
            "opponentPatienceScore": 56.0,
            "opponentContactQuality": 47.0,
            "opponentLineupCount": 9,
            "opponentConfirmedHitterCount": 9,
            "opponentLineupConfidenceScore": 100.0,
            "parkFactor": 99.0,
            "walkParkFactor": 100.0,
            "homeRunParkFactor": 96.0,
            "strikeoutParkFactor": 103.0,
            "pitchMixAdvantageScore": 58.0,
            "framingSupportScore": 53.0,
            "umpireZoneScore": 55.0,
            "defenseSupportScore": 51.0,
            "bullpenContextScore": 50.0,
            "hardHitAllowed": 33.0,
            "barrelAllowed": 5.4,
            "averageExitVelocityAllowed": 87.8,
            "groundBallRate": 45.0,
            "timesThroughOrderPenalty": 54.0,
            "dataCoverageScore": 90.0,
            "sampleConfidenceScore": 82.0,
            "battersFaced": 410.0,
            "careerBattersFaced": 1180.0,
            "firstPitchStrikeRate": 61.8,
            "zoneRate": 49.6,
            "chaseInducedRate": 29.8,
            "threeBallCountRate": 16.2,
        }
    }


def _mock_opposing_pitcher() -> dict:
    pitcher = _mock_pitcher()
    pitcher["throwingHand"] = "R"
    return pitcher


def _mock_hitter() -> dict:
    return {
        "metrics": {
            "averageVsHandedness": 0.281,
            "obpVsHandedness": 0.353,
            "sluggingVsHandedness": 0.512,
            "isoVsHandedness": 0.231,
            "wobaVsHandedness": 0.372,
            "xwobaVsHandedness": 0.384,
            "xbaVsHandedness": 0.276,
            "xslgVsHandedness": 0.529,
            "strikeoutRate": 20.8,
            "walkRate": 9.1,
            "hardHitRate": 46.0,
            "barrelRate": 11.6,
            "averageExitVelocity": 91.9,
            "averageBatSpeed": 74.1,
            "squaredUpRate": 34.5,
            "blastRate": 11.2,
            "swingLength": 7.1,
            "lineupSpot": 2,
            "lineupConfirmed": True,
            "playingTimeConfidence": 96.0,
            "parkFactorVsHandedness": 104.0,
            "hitParkFactorVsHandedness": 105.0,
            "walkParkFactorVsHandedness": 101.0,
            "homeRunParkFactorVsHandedness": 109.0,
            "doubleParkFactorVsHandedness": 104.0,
            "tripleParkFactorVsHandedness": 99.0,
            "launchAngle": 15.0,
            "contactRate": 76.0,
            "currentSplitPlateAppearances": 138.0,
            "previousSeasonsPlateAppearances": 442.0,
            "careerPlateAppearances": 820.0,
            "dataCoverageScore": 92.0,
            "sampleConfidenceScore": 81.0,
            "opponentPitcherContactAllowed": 57.0,
            "opponentPitcherPowerAllowed": 6.9,
            "opponentPitcherWalkRateAllowed": 8.2,
        }
    }


class PropModelTests(unittest.TestCase):
    def test_higher_projected_batters_faced_does_not_reduce_mean_strikeouts(self) -> None:
        baseline_pitcher = _mock_pitcher()
        extended_workload_pitcher = copy.deepcopy(baseline_pitcher)
        extended_workload_pitcher["metrics"]["averageBattersFaced"] = 27.0
        extended_workload_pitcher["metrics"]["recentBattersFaced"] = 27.6
        extended_workload_pitcher["metrics"]["averagePitchCount"] = 99.0
        extended_workload_pitcher["metrics"]["lastPitchCount"] = 101.0

        baseline_projection = project_pitcher_strikeouts(baseline_pitcher)
        extended_projection = project_pitcher_strikeouts(extended_workload_pitcher)

        self.assertGreaterEqual(extended_projection["meanKs"], baseline_projection["meanKs"])

    def test_calibration_module_bounds_probabilities(self) -> None:
        for probability in (0.01, 0.12, 0.50, 0.84, 0.99):
            calibration = calibrate_probability(
                probability,
                market="pitcher_walks",
                lineup_confirmed=False,
                rule_era="post_abs_2026",
                validation_samples=75,
            )
            self.assertGreaterEqual(calibration["probability"], 0.01)
            self.assertLessEqual(calibration["probability"], 0.99)

    def test_survival_model_stays_within_distribution_bounds(self) -> None:
        pitcher = _mock_pitcher()
        walk_projection = project_pitcher_walks(pitcher)
        outs_projection = project_pitcher_outs(pitcher, walk_projection=walk_projection)

        self.assertGreaterEqual(outs_projection["meanOuts"], 0.0)
        self.assertLessEqual(outs_projection["meanOuts"], 27.0)
        self.assertAlmostEqual(
            outs_projection["overLineProbability"] + outs_projection["underLineProbability"],
            1.0,
            places=2,
        )
        self.assertAlmostEqual(sum(outs_projection["distribution"].values()), 1.0, places=2)

    def test_hitter_total_bases_convolution_exceeds_hits_expectation(self) -> None:
        hitter = _mock_hitter()
        opposing_pitcher = _mock_opposing_pitcher()

        hits_projection = project_hitter_hits(hitter, opposing_pitcher)
        total_bases_projection = project_hitter_total_bases(hitter, opposing_pitcher)

        self.assertGreaterEqual(total_bases_projection["meanValue"], hits_projection["meanValue"])
        self.assertGreaterEqual(total_bases_projection["overLineProbability"], 0.01)
        self.assertLessEqual(total_bases_projection["overLineProbability"], 0.99)
        self.assertIn("0", total_bases_projection["distribution"])

    def test_schema_compatibility_supports_legacy_and_extended_payloads(self) -> None:
        legacy_strikeout_prop = PitcherStrikeoutProp.model_validate(
            {
                "market": "pitcher_strikeouts",
                "entityId": "1",
                "gameId": "10",
                "label": "Pitcher A over 4.5 strikeouts",
                "playerName": "Pitcher A",
                "teamAbbreviation": "SEA",
                "opponentAbbreviation": "TEX",
                "matchupLabel": "SEA at TEX",
                "lineupConfirmed": True,
                "lineupSource": "official",
                "strikeoutScore": 74.0,
                "projectedStrikeouts": 6.2,
                "meanKs": 6.2,
                "medianKs": 6.0,
                "over3_5Probability": 0.76,
                "over4_5Probability": 0.64,
                "inningsProjection": 6.0,
                "confidence": "core",
                "reasons": [],
                "metrics": {
                    "strikeoutRate": 27.8,
                    "swingingStrikeRate": 13.4,
                    "opponentStrikeoutRate": 24.2,
                    "lineupVsPitcherHandKRate": 24.8,
                    "pitchMixAdvantageScore": 58.0,
                    "opponentLineupCount": 9,
                    "opponentConfirmedHitterCount": 9,
                    "opponentLineupConfidenceScore": 100.0,
                    "strikeoutParkFactor": 103.0,
                    "walkRate": 7.2,
                    "projectionLayer": {},
                    "riskLayer": {},
                },
            }
        )
        extended_hitter_prop = HitterStatProp.model_validate(
            {
                "market": "hitter_total_bases",
                "entityId": "2",
                "gameId": "20",
                "label": "Hitter B over 1.5 total bases",
                "playerName": "Hitter B",
                "teamAbbreviation": "LAD",
                "opponentAbbreviation": "SF",
                "matchupLabel": "SF at LAD",
                "lineupSpot": 2,
                "lineupConfirmed": True,
                "lineupSource": "official",
                "marketScore": 77.0,
                "lineValue": 1.5,
                "projectionValue": 2.2,
                "meanValue": 2.2,
                "medianValue": 2.0,
                "deltaVsLine": 0.7,
                "overLineProbability": 0.63,
                "underLineProbability": 0.37,
                "confidenceScore": 75.0,
                "uncertaintyScore": 42.0,
                "modelType": "pa_outcome_convolution",
                "projectionLayer": {"projectedPlateAppearances": 4.68},
                "riskLayer": {"playingTimeConfidence": 96.0},
                "featureSnapshotTimestamp": "2026-04-18T12:00:00Z",
                "dataQualityFlags": [],
                "distribution": {"0": 0.12, "1": 0.26, "2": 0.29, "3": 0.19, "4": 0.14},
                "confidence": "strong",
                "reasons": [],
                "metrics": {
                    "averageVsHandedness": 0.281,
                    "obpVsHandedness": 0.353,
                    "sluggingVsHandedness": 0.512,
                    "isoVsHandedness": 0.231,
                    "walkRate": 9.1,
                    "strikeoutRate": 20.8,
                    "recentForm": 65.0,
                    "batterVsPitcherScore": 58.0,
                    "pitchMixMatchupScore": 61.0,
                    "opponentPitcherContactAllowed": 57.0,
                    "opponentPitcherWalkRateAllowed": 8.2,
                    "parkFactorVsHandedness": 104.0,
                    "hitParkFactorVsHandedness": 105.0,
                    "walkParkFactorVsHandedness": 101.0,
                    "projectedPlateAppearances": 4.68,
                },
            }
        )

        self.assertEqual(legacy_strikeout_prop.market, "pitcher_strikeouts")
        self.assertEqual(extended_hitter_prop.modelType, "pa_outcome_convolution")
        self.assertEqual(extended_hitter_prop.projectionLayer["projectedPlateAppearances"], 4.68)


if __name__ == "__main__":
    unittest.main()
