from __future__ import annotations

import unittest

from app.data_sources.fangraphs import FangraphsSource


SAMPLE_DEPTH_CHART_HTML = """
<html>
  <body>
    <h2>## Go-To Starting Lineup vs RHP▼</h2>
    <div>1 RF 24 Wyatt Langford R 24.4</div>
    <div>2 SS 5 Corey Seager L 32.0</div>
    <div>3 DH 3 Adolis Garcia R 31.2</div>
    <div>## Bench▼</div>
  </body>
</html>
"""


class _FakeClient:
    def get_text(self, _url: str) -> str:
        return SAMPLE_DEPTH_CHART_HTML


class FangraphsSourceTests(unittest.TestCase):
    def test_projected_lineup_parser_and_feed_matcher(self) -> None:
        source = FangraphsSource(client=_FakeClient())
        source.settings.enable_fangraphs_support = True
        projected = source.get_projected_lineup("TEX", "R")

        self.assertEqual(len(projected), 3)
        self.assertEqual(projected[0]["playerName"], "Wyatt Langford")
        self.assertEqual(projected[1]["battingOrder"], 2)

        feed = {
            "liveData": {
                "boxscore": {
                    "teams": {
                        "away": {
                            "players": {
                                "ID1": {
                                    "person": {"id": 1, "fullName": "Wyatt Langford"},
                                    "batSide": {"code": "R"},
                                    "position": {"abbreviation": "RF"},
                                },
                                "ID2": {
                                    "person": {"id": 2, "fullName": "Corey Seager"},
                                    "batSide": {"code": "L"},
                                    "position": {"abbreviation": "SS"},
                                },
                                "ID3": {
                                    "person": {"id": 3, "fullName": "Adolis Garcia"},
                                    "batSide": {"code": "R"},
                                    "position": {"abbreviation": "DH"},
                                },
                            }
                        }
                    }
                }
            }
        }
        resolved = source.match_projected_lineup_to_feed(projected, feed, "away")

        self.assertEqual(len(resolved), 3)
        self.assertEqual(resolved[0]["playerId"], "1")
        self.assertEqual(resolved[1]["playerName"], "Corey Seager")
        self.assertEqual(resolved[2]["status"], "projected")

    def test_projected_lineup_matches_from_game_data_players_when_boxscore_is_empty(self) -> None:
        projected = [
            {
                "playerName": "Wyatt Langford",
                "battingOrder": 1,
                "bats": "R",
                "position": "RF",
                "status": "projected",
            },
            {
                "playerName": "Corey Seager",
                "battingOrder": 2,
                "bats": "L",
                "position": "SS",
                "status": "projected",
            },
        ]
        feed = {
            "gameData": {
                "teams": {
                    "away": {"id": 140},
                    "home": {"id": 121},
                },
                "players": {
                    "ID1": {
                        "id": 1,
                        "fullName": "Wyatt Langford",
                        "currentTeam": {"id": 140},
                        "batSide": {"code": "R"},
                        "primaryPosition": {"abbreviation": "RF"},
                    },
                    "ID2": {
                        "id": 2,
                        "fullName": "Corey Seager",
                        "currentTeam": {"id": 140},
                        "batSide": {"code": "L"},
                        "primaryPosition": {"abbreviation": "SS"},
                    },
                    "ID3": {
                        "id": 3,
                        "fullName": "Juan Soto",
                        "currentTeam": {"id": 121},
                        "batSide": {"code": "L"},
                        "primaryPosition": {"abbreviation": "RF"},
                    },
                },
            },
            "liveData": {
                "boxscore": {
                    "teams": {
                        "away": {"players": {}},
                    }
                }
            },
        }

        resolved = FangraphsSource.match_projected_lineup_to_feed(projected, feed, "away")

        self.assertEqual(len(resolved), 2)
        self.assertEqual(resolved[0]["playerId"], "1")
        self.assertEqual(resolved[1]["playerId"], "2")


if __name__ == "__main__":
    unittest.main()
