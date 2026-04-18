from __future__ import annotations

import html
import re
import unicodedata

from app.core.config import get_settings
from app.data_sources.http_client import RateLimitedHttpClient


TEAM_DEPTH_CHART_SLUGS = {
    "ARI": "d-backs",
    "ATL": "braves",
    "BAL": "orioles",
    "BOS": "red-sox",
    "CHC": "cubs",
    "CWS": "white-sox",
    "CIN": "reds",
    "CLE": "guardians",
    "COL": "rockies",
    "DET": "tigers",
    "HOU": "astros",
    "KC": "royals",
    "KCR": "royals",
    "LAA": "angels",
    "LAD": "dodgers",
    "MIA": "marlins",
    "MIL": "brewers",
    "MIN": "twins",
    "NYM": "mets",
    "NYY": "yankees",
    "ATH": "athletics",
    "OAK": "athletics",
    "PHI": "phillies",
    "PIT": "pirates",
    "SD": "padres",
    "SDP": "padres",
    "SF": "giants",
    "SFG": "giants",
    "SEA": "mariners",
    "STL": "cardinals",
    "TB": "rays",
    "TBR": "rays",
    "TEX": "rangers",
    "TOR": "blue-jays",
    "WAS": "nationals",
    "WSN": "nationals",
}


def _normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", ascii_text.lower())


def _html_to_text(payload: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", payload, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(
        r"</(div|p|tr|li|section|article|h1|h2|h3|h4|h5|h6)>",
        "\n",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text


def _lineup_section_title(pitcher_hand: str) -> str:
    return "Go-To Starting Lineup vs LHP" if str(pitcher_hand or "").upper() == "L" else "Go-To Starting Lineup vs RHP"


def _parse_projected_lineup(text: str, pitcher_hand: str) -> list[dict]:
    section_title = _lineup_section_title(pitcher_hand)
    start_index = text.find(section_title)
    if start_index < 0:
        return []
    next_section_index = text.find("##", start_index + len(section_title))
    section = text[start_index : next_section_index if next_section_index > start_index else None]
    row_pattern = re.compile(
        r"\b([1-9])\s+([A-Z/]{1,4})\s+\d+\s+([A-Za-zÀ-ÿ'.,\- ]+?)\s+([LRS])\s+\d"
    )
    projected_lineup: dict[int, dict] = {}
    for order_text, position, player_name, bats in row_pattern.findall(section):
        order = int(order_text)
        if order in projected_lineup:
            continue
        projected_lineup[order] = {
            "playerName": " ".join(player_name.replace("â€™", "'").split()),
            "battingOrder": order,
            "bats": bats,
            "position": position,
            "status": "projected",
        }
    return [projected_lineup[order] for order in sorted(projected_lineup)[:9]]


class FangraphsSource:
    def __init__(self, client: RateLimitedHttpClient | None = None) -> None:
        self.settings = get_settings()
        self.client = client or RateLimitedHttpClient()

    def get_support_notes(self, probable_pitcher_names: list[str]) -> list[str]:
        if not self.settings.enable_fangraphs_support:
            return ["FanGraphs support lookups are disabled."]
        notes: list[str] = []
        try:
            html_payload = self.client.get_text(
                f"{self.settings.fangraphs_base_url}/roster-resource/probables-grid"
            ).lower()
            matched = sum(1 for name in probable_pitcher_names if name and name.lower() in html_payload)
            if probable_pitcher_names:
                notes.append(
                    f"FanGraphs support matched {matched} of {len(probable_pitcher_names)} probable pitchers."
                )
        except Exception:
            notes.append("FanGraphs support was unavailable during this refresh.")
        return notes

    def get_projected_lineup(self, team_abbreviation: str, pitcher_hand: str) -> list[dict]:
        if not self.settings.enable_fangraphs_support:
            return []
        slug = TEAM_DEPTH_CHART_SLUGS.get(str(team_abbreviation or "").upper())
        if not slug:
            return []
        try:
            payload = self.client.get_text(
                f"{self.settings.fangraphs_base_url}/roster-resource/depth-charts/{slug}"
            )
        except Exception:
            return []
        return _parse_projected_lineup(_html_to_text(payload), pitcher_hand)

    @staticmethod
    def match_projected_lineup_to_feed(
        projected_lineup: list[dict],
        feed: dict | None,
        side: str,
    ) -> list[dict]:
        if not projected_lineup:
            return []
        payload = feed or {}
        game_data = payload.get("gameData") or {}
        side_team = ((game_data.get("teams") or {}).get(side) or {})
        side_team_id = str(side_team.get("id") or "")
        team_boxscore = (((payload.get("liveData") or {}).get("boxscore") or {}).get("teams", {}).get(side, {}))
        boxscore_players = team_boxscore.get("players") or {}
        game_data_players = game_data.get("players") or {}
        players_by_name: dict[str, dict] = {}

        def add_player(player: dict) -> None:
            person = player.get("person") or {}
            full_name = person.get("fullName") or player.get("fullName") or player.get("name")
            normalized_name = _normalize_name(full_name)
            if not normalized_name:
                return
            players_by_name.setdefault(normalized_name, player)

        for player in boxscore_players.values():
            add_player(player)

        for player in game_data_players.values():
            if not isinstance(player, dict):
                continue
            current_team_id = str(
                ((player.get("currentTeam") or {}).get("id"))
                or ((player.get("team") or {}).get("id"))
                or ((player.get("parentTeamId")) or "")
            )
            if side_team_id and current_team_id and current_team_id != side_team_id:
                continue
            add_player(player)

        resolved_lineup: list[dict] = []
        for entry in projected_lineup:
            player = players_by_name.get(_normalize_name(entry["playerName"])) or {}
            person = player.get("person") or {}
            player_id = person.get("id") or player.get("id")
            if not player_id:
                continue
            resolved_lineup.append(
                {
                    "playerId": str(player_id),
                    "playerName": person.get("fullName") or player.get("fullName") or entry["playerName"],
                    "battingOrder": entry["battingOrder"],
                    "bats": (player.get("batSide") or {}).get("code") or entry["bats"],
                    "position": (player.get("position") or {}).get("abbreviation")
                    or (player.get("primaryPosition") or {}).get("abbreviation")
                    or entry["position"],
                    "status": "projected",
                }
            )
        return resolved_lineup
