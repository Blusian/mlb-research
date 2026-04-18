from __future__ import annotations

from typing import Any

from app.data_sources.fangraphs import FangraphsSource
from app.data_sources.mlb_stats_api import MlbStatsApiSource
from app.services.weather_service import WeatherService


def _safe_handedness(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("code") or value.get("description") or value.get("name")
    normalized = str(value or "").strip().upper()
    if normalized in {"L", "LEFT"}:
        return "L"
    if normalized in {"R", "RIGHT"}:
        return "R"
    if normalized in {"S", "SWITCH"}:
        return "S"
    return "U"


def _team_info(team: dict | None) -> dict:
    team = team or {}
    name = team.get("name") or "Unknown Team"
    return {
        "id": str(team.get("id") or "unknown"),
        "city": team.get("locationName") or "Unknown",
        "name": team.get("teamName") or name,
        "abbreviation": team.get("abbreviation") or "TBD",
    }


def _game_status(state: str | None) -> str:
    lowered = (state or "").lower()
    if lowered == "final":
        return "final"
    if lowered == "live":
        return "in_progress"
    return "scheduled"


def _build_lineup(feed: dict | None, side: str) -> list[dict]:
    team_boxscore = (((feed or {}).get("liveData") or {}).get("boxscore") or {}).get("teams", {}).get(side, {})
    batting_order = team_boxscore.get("battingOrder") or []
    players = team_boxscore.get("players") or {}
    status = "confirmed" if len(batting_order) >= 9 else "projected"
    lineup: list[dict] = []
    for index, player_id in enumerate(batting_order):
        player = players.get(f"ID{player_id}") or {}
        person = player.get("person") or {}
        if not person.get("fullName"):
            continue
        lineup.append(
            {
                "playerId": str(person.get("id") or player_id),
                "playerName": person.get("fullName"),
                "battingOrder": index + 1,
                "bats": _safe_handedness((player.get("batSide") or {}).get("code")),
                "position": (player.get("position") or {}).get("abbreviation"),
                "status": status,
            }
        )
    return lineup


def _lineup_status(away_lineup: list[dict], home_lineup: list[dict]) -> str:
    away_confirmed = len(away_lineup) >= 9 and all(entry.get("status") == "confirmed" for entry in away_lineup[:9])
    home_confirmed = len(home_lineup) >= 9 and all(entry.get("status") == "confirmed" for entry in home_lineup[:9])
    away_projected = len(away_lineup) >= 9 and all(entry.get("status") == "projected" for entry in away_lineup[:9])
    home_projected = len(home_lineup) >= 9 and all(entry.get("status") == "projected" for entry in home_lineup[:9])
    if away_confirmed and home_confirmed:
        return "confirmed"
    if away_projected and home_projected:
        return "projected"
    if away_lineup or home_lineup:
        return "partial"
    return "projected"


def _fill_projected_lineup(
    current_lineup: list[dict],
    projected_lineup: list[dict],
) -> list[dict]:
    if len(current_lineup) >= 9:
        return current_lineup
    if len(projected_lineup) > len(current_lineup):
        return projected_lineup
    return current_lineup


def _weather_from_feed(feed: dict | None) -> dict | None:
    weather = ((feed or {}).get("gameData") or {}).get("weather") or {}
    if not weather:
        return None
    return {
        "condition": weather.get("condition") or "Conditions unavailable",
        "temperatureF": float(weather["temp"]) if weather.get("temp") else None,
        "wind": weather.get("wind"),
    }


def _merge_weather(primary: dict | None, fallback: dict | None) -> dict | None:
    if not primary:
        return fallback
    return {
        "condition": primary.get("condition") or (fallback or {}).get("condition") or "Conditions unavailable",
        "temperatureF": primary.get("temperatureF") if primary.get("temperatureF") is not None else (fallback or {}).get("temperatureF"),
        "wind": primary.get("wind") or (fallback or {}).get("wind"),
        "precipitationProbability": primary.get("precipitationProbability")
        if primary.get("precipitationProbability") is not None
        else (fallback or {}).get("precipitationProbability"),
        "humidity": primary.get("humidity") if primary.get("humidity") is not None else (fallback or {}).get("humidity"),
        "windSpeedMph": primary.get("windSpeedMph") if primary.get("windSpeedMph") is not None else (fallback or {}).get("windSpeedMph"),
        "windDirection": primary.get("windDirection") or (fallback or {}).get("windDirection"),
    }


def _build_officials(feed: dict | None) -> list[dict]:
    officials = (((feed or {}).get("liveData") or {}).get("boxscore") or {}).get("officials") or []
    return [
        {
            "type": official.get("officialType") or "Unknown",
            "name": (official.get("official") or {}).get("fullName") or "Unknown",
            "id": str((official.get("official") or {}).get("id")) if (official.get("official") or {}).get("id") else None,
        }
        for official in officials
        if (official.get("official") or {}).get("fullName")
    ]


def _apply_people_handedness(
    lineup: list[dict],
    probable_pitchers: dict[str, dict | None],
    people_details: dict[str, dict],
) -> None:
    for entry in lineup:
        if entry.get("bats") == "U":
            entry["bats"] = _safe_handedness((people_details.get(entry["playerId"]) or {}).get("batSide"))
    for side in ("away", "home"):
        pitcher = probable_pitchers.get(side)
        if not pitcher:
            continue
        if pitcher.get("throwingHand") == "U":
            pitcher["throwingHand"] = _safe_handedness(
                (people_details.get(pitcher["playerId"]) or {}).get("pitchHand")
            )


class ScheduleService:
    def __init__(
        self,
        source: MlbStatsApiSource | None = None,
        weather_service: WeatherService | None = None,
        fangraphs_source: FangraphsSource | None = None,
    ) -> None:
        self.source = source or MlbStatsApiSource()
        self.weather_service = weather_service or WeatherService()
        self.fangraphs_source = fangraphs_source or FangraphsSource()

    def get_games(self, analysis_date: str) -> list[dict]:
        games: list[dict] = []
        for game in self.source.get_schedule(analysis_date):
            game_pk = game.get("gamePk")
            if not game_pk:
                continue
            feed = self.source.get_game_feed(int(game_pk))
            away_lineup = _build_lineup(feed, "away")
            home_lineup = _build_lineup(feed, "home")
            away_team = _team_info(((game.get("teams") or {}).get("away") or {}).get("team"))
            home_team = _team_info(((game.get("teams") or {}).get("home") or {}).get("team"))
            venue = game.get("venue") or {}
            start_time = game.get("gameDate") or f"{analysis_date}T23:00:00Z"
            weather = _merge_weather(
                self.weather_service.get_weather(home_team["abbreviation"], start_time),
                _weather_from_feed(feed),
            )
            away_probable = (((game.get("teams") or {}).get("away") or {}).get("probablePitcher")) or None
            home_probable = (((game.get("teams") or {}).get("home") or {}).get("probablePitcher")) or None
            probable_pitchers = {
                "away": {
                    "playerId": str((away_probable or {}).get("id") or ""),
                    "name": (away_probable or {}).get("fullName") or "TBD",
                    "throwingHand": _safe_handedness((((away_probable or {}).get("pitchHand")) or {}).get("code")),
                }
                if away_probable
                else None,
                "home": {
                    "playerId": str((home_probable or {}).get("id") or ""),
                    "name": (home_probable or {}).get("fullName") or "TBD",
                    "throwingHand": _safe_handedness((((home_probable or {}).get("pitchHand")) or {}).get("code")),
                }
                if home_probable
                else None,
            }
            away_projected_lineup = self.fangraphs_source.match_projected_lineup_to_feed(
                self.fangraphs_source.get_projected_lineup(
                    away_team["abbreviation"],
                    (probable_pitchers.get("home") or {}).get("throwingHand") or "R",
                ),
                feed,
                "away",
            )
            home_projected_lineup = self.fangraphs_source.match_projected_lineup_to_feed(
                self.fangraphs_source.get_projected_lineup(
                    home_team["abbreviation"],
                    (probable_pitchers.get("away") or {}).get("throwingHand") or "R",
                ),
                feed,
                "home",
            )
            away_lineup = _fill_projected_lineup(away_lineup, away_projected_lineup)
            home_lineup = _fill_projected_lineup(home_lineup, home_projected_lineup)
            people_details = self.source.get_people_details(
                [
                    player_id
                    for player_id in [
                        *(entry["playerId"] for entry in away_lineup),
                        *(entry["playerId"] for entry in home_lineup),
                        *(
                            pitcher["playerId"]
                            for pitcher in probable_pitchers.values()
                            if pitcher and pitcher.get("playerId")
                        ),
                    ]
                    if player_id
                ]
            )
            _apply_people_handedness(away_lineup, probable_pitchers, people_details)
            _apply_people_handedness(home_lineup, probable_pitchers, people_details)
            games.append(
                {
                    "gameId": str(game_pk),
                    "matchupId": f"{away_team['abbreviation']}@{home_team['abbreviation']}",
                    "gameDate": analysis_date,
                    "startTime": start_time,
                    "matchupLabel": f"{away_team['abbreviation']} at {home_team['abbreviation']}",
                    "status": _game_status(((game.get("status") or {}).get("abstractGameState"))),
                    "awayTeam": away_team,
                    "homeTeam": home_team,
                    "venue": {
                        "name": venue.get("name") or "Unknown Park",
                        "city": (venue.get("location") or {}).get("city") or home_team["city"],
                        "parkFactor": 100,
                        "homeRunFactor": 100,
                    },
                    "probablePitchers": probable_pitchers,
                    "lineupStatus": _lineup_status(away_lineup, home_lineup),
                    "lineups": {"away": away_lineup, "home": home_lineup},
                    "weather": weather,
                    "officials": _build_officials(feed),
                    "source": "live",
                }
            )
        return games
