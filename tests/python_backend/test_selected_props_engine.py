from __future__ import annotations

import unittest

from app.services.live_props_engine import LivePropsEngine


class LivePropsEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = LivePropsEngine()

    def test_pitcher_strikeout_prop_marks_won_when_final_and_cleared(self) -> None:
        selected_props = [
            {
                "id": "prop-1",
                "date": "2026-04-15",
                "gameId": "100",
                "playerId": "42",
                "playerName": "Emerson Hancock",
                "team": "SEA",
                "opponent": "SD",
                "propType": "pitcher_strikeouts",
                "selectionLabel": "Emerson Hancock over 3.5 Ks",
                "lineValue": 3.5,
                "projectionValue": 6.7,
                "confidence": "core",
                "sportsbook": None,
                "explanationSummary": "Strong K matchup.",
            }
        ]
        live_games = {
            "100": {
                "gameId": "100",
                "gameStatus": "Final",
                "isLive": False,
                "inningState": "Bottom",
                "inningNumber": 9,
                "outs": 3,
                "scoreLabel": "SEA 5 - 3 SD",
                "gameStartTime": "2026-04-15T19:40:00Z",
                "lastUpdatedAt": "2026-04-15T23:12:00Z",
                "players": {
                    "42": {
                        "pitching": {
                            "strikeouts": 6,
                            "battersFaced": 23,
                            "pitchCount": 96,
                            "inningsPitched": "6.1",
                        }
                    }
                },
            }
        }

        state = self.engine.build_live_states(selected_props, live_games)[0]
        self.assertTrue(state["isCleared"])
        self.assertFalse(state["isLost"])
        self.assertEqual(state["resultStatus"], "won")
        self.assertEqual(state["remainingToClear"], 0.0)

    def test_hitter_total_bases_prop_tracks_live_breakdown(self) -> None:
        selected_props = [
            {
                "id": "prop-2",
                "date": "2026-04-15",
                "gameId": "101",
                "playerId": "88",
                "playerName": "Player Y",
                "team": "ATL",
                "opponent": "NYM",
                "propType": "hitter_total_bases",
                "selectionLabel": "Player Y over 1.5 total bases",
                "lineValue": 1.5,
                "projectionValue": 2.1,
                "confidence": "strong",
                "sportsbook": None,
                "explanationSummary": "Good park and contact fit.",
            }
        ]
        live_games = {
            "101": {
                "gameId": "101",
                "gameStatus": "Live",
                "isLive": True,
                "inningState": "Top",
                "inningNumber": 5,
                "outs": 1,
                "scoreLabel": "NYM 2 - 4 ATL",
                "gameStartTime": "2026-04-15T23:20:00Z",
                "lastUpdatedAt": "2026-04-16T01:10:00Z",
                "players": {
                    "88": {
                        "batting": {
                            "hits": 2,
                            "atBats": 3,
                            "plateAppearances": 3,
                            "walks": 0,
                            "homeRuns": 0,
                            "singles": 1,
                            "doubles": 1,
                            "triples": 0,
                            "totalBases": 3,
                        }
                    }
                },
            }
        }

        state = self.engine.build_live_states(selected_props, live_games)[0]
        self.assertEqual(state["currentValue"], 3.0)
        self.assertTrue(state["isCleared"])
        self.assertEqual(state["resultStatus"], "cleared")
        self.assertEqual(state["statBreakdown"]["doubles"], 1)

    def test_hitter_home_run_prop_marks_lost_when_final_without_homer(self) -> None:
        selected_props = [
            {
                "id": "prop-3",
                "date": "2026-04-15",
                "gameId": "102",
                "playerId": "99",
                "playerName": "Player Z",
                "team": "LAD",
                "opponent": "SF",
                "propType": "hitter_home_run",
                "selectionLabel": "Player Z to hit a home run",
                "lineValue": 0.5,
                "projectionValue": 0.22,
                "confidence": "watch",
                "sportsbook": None,
                "explanationSummary": "Power-only follow.",
            }
        ]
        live_games = {
            "102": {
                "gameId": "102",
                "gameStatus": "Final",
                "isLive": False,
                "inningState": "Bottom",
                "inningNumber": 9,
                "outs": 3,
                "scoreLabel": "SF 1 - 6 LAD",
                "gameStartTime": "2026-04-15T20:10:00Z",
                "lastUpdatedAt": "2026-04-15T23:40:00Z",
                "players": {
                    "99": {
                        "batting": {
                            "hits": 1,
                            "atBats": 4,
                            "plateAppearances": 4,
                            "walks": 0,
                            "homeRuns": 0,
                            "singles": 1,
                            "doubles": 0,
                            "triples": 0,
                            "totalBases": 1,
                        }
                    }
                },
            }
        }

        state = self.engine.build_live_states(selected_props, live_games)[0]
        self.assertFalse(state["isCleared"])
        self.assertTrue(state["isLost"])
        self.assertEqual(state["resultStatus"], "lost")

    def test_hitter_runs_prop_marks_cleared_once_run_scores(self) -> None:
        selected_props = [
            {
                "id": "prop-4",
                "date": "2026-04-15",
                "gameId": "103",
                "playerId": "120",
                "playerName": "Player Runs",
                "team": "CHC",
                "opponent": "MIL",
                "propType": "hitter_runs",
                "selectionLabel": "Player Runs over 0.5 runs",
                "lineValue": 0.5,
                "projectionValue": 0.86,
                "confidence": "strong",
                "sportsbook": None,
                "explanationSummary": "Top-of-order on-base profile.",
            }
        ]
        live_games = {
            "103": {
                "gameId": "103",
                "gameStatus": "Live",
                "isLive": True,
                "inningState": "Bottom",
                "inningNumber": 6,
                "outs": 2,
                "scoreLabel": "MIL 3 - 5 CHC",
                "gameStartTime": "2026-04-15T19:10:00Z",
                "lastUpdatedAt": "2026-04-15T22:10:00Z",
                "players": {
                    "120": {
                        "batting": {
                            "runs": 1,
                            "hits": 2,
                            "walks": 1,
                            "atBats": 3,
                            "plateAppearances": 4,
                            "homeRuns": 0,
                        }
                    }
                },
            }
        }

        state = self.engine.build_live_states(selected_props, live_games)[0]
        self.assertEqual(state["currentValue"], 1.0)
        self.assertTrue(state["isCleared"])
        self.assertEqual(state["resultStatus"], "cleared")
        self.assertEqual(state["statBreakdown"]["runs"], 1)

    def test_hitter_walks_prop_marks_lost_when_final_without_walk(self) -> None:
        selected_props = [
            {
                "id": "prop-5",
                "date": "2026-04-15",
                "gameId": "104",
                "playerId": "121",
                "playerName": "Player Walks",
                "team": "BOS",
                "opponent": "TOR",
                "propType": "hitter_walks",
                "selectionLabel": "Player Walks over 0.5 walks",
                "lineValue": 0.5,
                "projectionValue": 0.71,
                "confidence": "watch",
                "sportsbook": None,
                "explanationSummary": "Disciplined bat, but no walk yet.",
            }
        ]
        live_games = {
            "104": {
                "gameId": "104",
                "gameStatus": "Final",
                "isLive": False,
                "inningState": "Bottom",
                "inningNumber": 9,
                "outs": 3,
                "scoreLabel": "TOR 4 - 2 BOS",
                "gameStartTime": "2026-04-15T20:10:00Z",
                "lastUpdatedAt": "2026-04-16T00:40:00Z",
                "players": {
                    "121": {
                        "batting": {
                            "walks": 0,
                            "hits": 1,
                            "atBats": 4,
                            "plateAppearances": 4,
                            "homeRuns": 0,
                        }
                    }
                },
            }
        }

        state = self.engine.build_live_states(selected_props, live_games)[0]
        self.assertEqual(state["currentValue"], 0.0)
        self.assertFalse(state["isCleared"])
        self.assertTrue(state["isLost"])
        self.assertEqual(state["resultStatus"], "lost")

    def test_game_total_runs_prop_tracks_live_total_and_settles_under(self) -> None:
        selected_props = [
            {
                "id": "prop-6",
                "date": "2026-04-15",
                "gameId": "105",
                "playerId": "game-total:105",
                "playerName": "SEA at SD",
                "team": "SEA",
                "opponent": "SD",
                "matchupLabel": "SEA at SD",
                "propType": "game_total_runs",
                "selectionSide": "under",
                "selectionLabel": "Under 8.5 total runs",
                "lineValue": 8.5,
                "projectionValue": 7.9,
                "confidence": "strong",
                "sportsbook": None,
                "explanationSummary": "Pitching and park both lean under.",
            }
        ]
        live_games = {
            "105": {
                "gameId": "105",
                "gameStatus": "Final",
                "isLive": False,
                "inningState": "Bottom",
                "inningNumber": 9,
                "outs": 3,
                "awayRuns": 3,
                "homeRuns": 4,
                "totalRuns": 7,
                "scoreLabel": "SEA 3 - 4 SD",
                "gameStartTime": "2026-04-15T20:10:00Z",
                "lastUpdatedAt": "2026-04-16T00:40:00Z",
                "players": {},
            }
        }

        state = self.engine.build_live_states(selected_props, live_games)[0]
        self.assertEqual(state["currentValue"], 7.0)
        self.assertEqual(state["statBreakdown"]["awayRuns"], 3)
        self.assertEqual(state["statBreakdown"]["homeRuns"], 4)
        self.assertTrue(state["isCleared"])
        self.assertFalse(state["isLost"])
        self.assertEqual(state["resultStatus"], "won")


if __name__ == "__main__":
    unittest.main()
