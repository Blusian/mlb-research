from __future__ import annotations


def filter_games(games: list[dict], query: dict) -> list[dict]:
    team = query.get("team")
    matchup = query.get("matchup")
    if team and team != "ALL":
        games = [
            game
            for game in games
            if game["awayTeam"]["abbreviation"] == team or game["homeTeam"]["abbreviation"] == team
        ]
    if matchup and matchup != "ALL":
        games = [game for game in games if game["matchupId"] == matchup]
    return games


def filter_hitters(hitters: list[dict], query: dict) -> list[dict]:
    team = query.get("team")
    matchup = query.get("matchup")
    handedness = query.get("handedness")
    if team and team != "ALL":
        hitters = [hitter for hitter in hitters if hitter["team"]["abbreviation"] == team]
    if matchup and matchup != "ALL":
        hitters = [hitter for hitter in hitters if hitter["matchupId"] == matchup]
    if handedness and handedness != "ALL":
        hitters = [hitter for hitter in hitters if hitter["bats"] == handedness]
    return hitters


def filter_pitchers(pitchers: list[dict], query: dict) -> list[dict]:
    team = query.get("team")
    matchup = query.get("matchup")
    if team and team != "ALL":
        pitchers = [pitcher for pitcher in pitchers if pitcher["team"]["abbreviation"] == team]
    if matchup and matchup != "ALL":
        pitchers = [pitcher for pitcher in pitchers if pitcher["matchupId"] == matchup]
    return pitchers
