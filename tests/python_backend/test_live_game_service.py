from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.services.live_game_service import LiveGameService


class _FakeMlbStatsApiSource:
    def __init__(self, feeds: dict[int, dict | None]) -> None:
        self.feeds = feeds
        self.calls: list[tuple[int, float | None]] = []

    def get_game_feed(self, game_pk: int, timeout_seconds: float | None = None) -> dict | None:
        self.calls.append((game_pk, timeout_seconds))
        return self.feeds.get(game_pk)


class LiveGameServiceTests(unittest.TestCase):
    def test_dedupes_duplicate_game_ids_to_single_feed_refresh(self) -> None:
        source = _FakeMlbStatsApiSource(
            {
                123: {
                    "gameData": {
                        "teams": {
                            "away": {"abbreviation": "SEA"},
                            "home": {"abbreviation": "HOU"},
                        },
                        "status": {"abstractGameState": "Live", "detailedState": "In Progress"},
                    },
                    "liveData": {
                        "linescore": {
                            "currentInningHalf": "Top",
                            "currentInning": 3,
                            "outs": 1,
                            "teams": {
                                "away": {"runs": 2},
                                "home": {"runs": 1},
                            },
                        },
                        "boxscore": {"teams": {"away": {"players": {}}, "home": {"players": {}}}},
                    },
                }
            }
        )
        service = LiveGameService(source=source)

        snapshots = service.get_live_games(["123", "123", "123"])

        self.assertEqual(len(source.calls), 1)
        self.assertEqual(snapshots["123"]["totalRuns"], 3)

    def test_uses_stale_cached_feed_when_refresh_fails(self) -> None:
        stale_feed = {
            "gameData": {
                "teams": {
                    "away": {"abbreviation": "ATL"},
                    "home": {"abbreviation": "NYM"},
                },
                "status": {"abstractGameState": "Live", "detailedState": "In Progress"},
            },
            "liveData": {
                "linescore": {
                    "currentInningHalf": "Bottom",
                    "currentInning": 6,
                    "outs": 2,
                    "teams": {
                        "away": {"runs": 3},
                        "home": {"runs": 4},
                    },
                },
                "boxscore": {"teams": {"away": {"players": {}}, "home": {"players": {}}}},
            },
        }
        source = _FakeMlbStatsApiSource({456: None})
        service = LiveGameService(source=source)
        stale_at = datetime.now(timezone.utc) - timedelta(seconds=120)
        service._feed_cache["456"] = (stale_at, stale_feed)

        snapshot = service.get_live_games(["456"])["456"]

        self.assertEqual(snapshot["scoreLabel"], "ATL 3 - 4 NYM")
        self.assertEqual(snapshot["totalRuns"], 7)
        self.assertEqual(len(source.calls), 1)

    def test_keeps_score_totals_separate_from_player_home_runs(self) -> None:
        source = _FakeMlbStatsApiSource(
            {
                789: {
                    "gameData": {
                        "teams": {
                            "away": {"abbreviation": "KC"},
                            "home": {"abbreviation": "NYY"},
                        },
                        "status": {"abstractGameState": "Live", "detailedState": "In Progress"},
                    },
                    "liveData": {
                        "linescore": {
                            "currentInningHalf": "Top",
                            "currentInning": 7,
                            "outs": 1,
                            "teams": {
                                "away": {"runs": 0},
                                "home": {"runs": 10},
                            },
                        },
                        "boxscore": {
                            "teams": {
                                "away": {"players": {}},
                                "home": {
                                    "players": {
                                        "ID1": {
                                            "person": {"id": 1, "fullName": "Slugger"},
                                            "stats": {
                                                "batting": {
                                                    "hits": 2,
                                                    "doubles": 0,
                                                    "triples": 0,
                                                    "homeRuns": 2,
                                                    "atBats": 4,
                                                    "runs": 2,
                                                    "rbi": 4,
                                                }
                                            },
                                        }
                                    }
                                },
                            }
                        },
                    },
                }
            }
        )
        service = LiveGameService(source=source)

        snapshot = service.get_live_games(["789"])["789"]

        self.assertEqual(snapshot["homeRuns"], 10)
        self.assertEqual(snapshot["totalRuns"], 10)
        self.assertEqual(snapshot["players"]["1"]["batting"]["homeRuns"], 2)


if __name__ == "__main__":
    unittest.main()
