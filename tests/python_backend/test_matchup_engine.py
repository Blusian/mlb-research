from __future__ import annotations

import unittest

from app.services.matchup_engine import MatchupEngine


class StubPlayerStatsService:
    def get_hitter_stats(self, hitter_ids: list[str], season: str) -> dict:
        return {
            "101": {
                "id": "101",
                "batSide": {"code": "R"},
                "stats": [
                    {
                        "type": {"displayName": "season"},
                        "splits": [
                            {
                                "stat": {
                                    "avg": "0.250",
                                    "obp": "0.330",
                                    "slg": "0.430",
                                    "plateAppearances": "30",
                                    "strikeOuts": "6",
                                    "baseOnBalls": "4",
                                }
                            }
                        ],
                    },
                    {
                        "type": {"displayName": "statSplits"},
                        "splits": [
                            {
                                "split": {"code": "vr"},
                                "stat": {
                                    "avg": "0.255",
                                    "obp": "0.335",
                                    "slg": "0.440",
                                    "plateAppearances": "20",
                                    "strikeOuts": "4",
                                    "baseOnBalls": "3",
                                },
                            }
                        ],
                    },
                    {"type": {"displayName": "gameLog"}, "splits": []},
                ],
            }
        }

    def get_pitcher_stats(self, pitcher_ids: list[str], season: str) -> dict:
        return {
            "201": {
                "id": "201",
                "pitchHand": {"code": "R"},
                "stats": [
                    {
                        "type": {"displayName": "season"},
                        "splits": [
                            {
                                "stat": {
                                    "inningsPitched": "12.0",
                                    "strikeOuts": "14",
                                    "baseOnBalls": "4",
                                    "homeRuns": "2",
                                    "battersFaced": "50",
                                    "groundOuts": "12",
                                    "airOuts": "10",
                                    "gamesStarted": "2",
                                    "era": "3.50",
                                    "whip": "1.20",
                                }
                            }
                        ],
                    },
                    {"type": {"displayName": "gameLog"}, "splits": []},
                ],
            }
        }

    def get_pitch_arsenal(self, pitcher_ids: list[str], season: str) -> dict:
        return {
            "201": [
                {
                    "stat": {
                        "type": {"code": "FF", "description": "Four-seam FB"},
                        "percentage": "60",
                        "averageSpeed": "95",
                        "count": "100",
                    }
                }
            ]
        }

    def get_hitter_play_logs(self, hitter_ids: list[str], season: str, limit: int = 160) -> dict:
        return {"101": []}

    def get_batter_vs_pitcher_history(self, matchup_groups: list[dict]) -> dict:
        return {}


class StubStatcastService:
    def get_hitter_profiles(self, date: str) -> dict:
        profile = {
            "average": 0.255,
            "obp": 0.335,
            "slugging": 0.44,
            "ops": 0.775,
            "iso": 0.185,
            "woba": 0.34,
            "xwoba": 0.345,
            "xba": 0.252,
            "xslg": 0.442,
            "barrelRate": 8.5,
            "hardHitRate": 42.0,
            "averageExitVelocity": 90.0,
            "launchAngle": 13.0,
            "strikeoutRate": 21.0,
            "walkRate": 8.0,
            "whiffRate": 27.0,
            "contactRate": 73.0,
            "zoneContactRate": 83.0,
        }
        return {"101": {"overall": profile, "vsRight": profile, "vsLeft": profile}}

    def get_pitcher_profiles(self, date: str) -> dict:
        profile = {
            "hardHitRate": 36.0,
            "barrelRate": 7.0,
            "xslg": 0.41,
            "xwoba": 0.32,
            "xba": 0.245,
            "strikeoutRate": 24.0,
            "whiffRate": 28.0,
            "averageExitVelocity": 88.0,
        }
        return {"201": {"overall": profile, "vsRight": profile, "vsLeft": profile}}

    def get_bat_tracking_profiles(self, season: str) -> dict:
        return {
            "101": {
                "averageBatSpeed": 74.0,
                "contactRate": 77.0,
                "zoneContactRate": 85.0,
                "blastRate": None,
                "squaredUpRate": None,
            }
        }


class StubParkFactorService:
    def get_factors(self, team_abbreviation: str, handedness: str) -> dict:
        return {
            "park_factor": 100.0,
            "hit_factor": 100.0,
            "single_factor": 100.0,
            "double_factor": 100.0,
            "triple_factor": 100.0,
            "home_run_factor": 100.0,
            "walk_factor": 100.0,
            "strikeout_factor": 100.0,
        }


class MatchupEngineTests(unittest.TestCase):
    def test_bat_tracking_nulls_fall_back_to_safe_defaults(self) -> None:
        engine = MatchupEngine(
            player_stats_service=StubPlayerStatsService(),
            statcast_service=StubStatcastService(),
            park_factor_service=StubParkFactorService(),
        )
        games = [
            {
                "gameId": "game-1",
                "matchupId": "SEA@SD",
                "matchupLabel": "SEA at SD",
                "lineupStatus": "confirmed",
                "weather": None,
                "homeTeam": {"abbreviation": "SD", "id": "135", "city": "San Diego", "name": "Padres"},
                "awayTeam": {"abbreviation": "SEA", "id": "136", "city": "Seattle", "name": "Mariners"},
                "venue": {"parkFactor": 100.0, "homeRunFactor": 100.0},
                "probablePitchers": {
                    "away": None,
                    "home": {"playerId": "201", "name": "Starter", "throwingHand": "R"},
                },
                "lineups": {
                    "away": [
                        {
                            "playerId": "101",
                            "playerName": "Example Hitter",
                            "battingOrder": 3,
                            "bats": "R",
                            "status": "confirmed",
                        }
                    ],
                    "home": [],
                },
            }
        ]

        hitters, pitchers, notes = engine.build_candidates(games, "2026-04-14")

        self.assertEqual(len(hitters), 1)
        self.assertEqual(hitters[0]["metrics"]["blastRate"], 8.0)
        self.assertEqual(hitters[0]["metrics"]["squaredUpRate"], 28.0)
        self.assertEqual(hitters[0]["metrics"]["averageBatSpeed"], 74.0)
        self.assertIsInstance(pitchers, list)
        self.assertTrue(notes)


if __name__ == "__main__":
    unittest.main()
