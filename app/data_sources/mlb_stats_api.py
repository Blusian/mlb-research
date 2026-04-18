from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.data_sources.http_client import RateLimitedHttpClient


def chunk(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


class MlbStatsApiSource:
    def __init__(self, client: RateLimitedHttpClient | None = None) -> None:
        self.settings = get_settings()
        self.client = client or RateLimitedHttpClient()

    def get_schedule(self, date: str) -> list[dict[str, Any]]:
        url = (
            f"{self.settings.mlb_stats_api_base_url}/schedule"
            f"?sportId=1&date={date}&hydrate=probablePitcher,team,venue"
        )
        payload = self.client.get_json(url)
        return ((payload.get("dates") or [{}])[0].get("games") or [])

    def get_game_feed(self, game_pk: int, timeout_seconds: float | None = None) -> dict[str, Any] | None:
        try:
            return self.client.get_json(
                f"https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live",
                timeout_seconds=timeout_seconds,
            )
        except Exception:
            return None

    def get_people_stats(self, person_ids: list[str], group: str, season: str) -> dict[str, dict[str, Any]]:
        if not person_ids:
            return {}
        people = self._get_people(
            person_ids,
            f"stats(group=[{group}],type=[season,career,statSplits,gameLog],sitCodes=[vr,vl],season={season})",
        )
        return {str(person["id"]): person for person in people if person.get("id") is not None}

    def get_people_details(self, person_ids: list[str]) -> dict[str, dict[str, Any]]:
        people = self._get_people(person_ids)
        return {str(person["id"]): person for person in people if person.get("id") is not None}

    def get_pitch_arsenal_stats(self, person_ids: list[str], season: str) -> dict[str, list[dict[str, Any]]]:
        people = self._get_people(
            person_ids,
            f"stats(group=[pitching],type=[pitchArsenal],season={season})",
        )
        return {
            str(person["id"]): self._get_stat_splits(person, "pitchArsenal")
            for person in people
            if person.get("id") is not None
        }

    def get_play_log_stats(
        self,
        person_ids: list[str],
        group: str,
        season: str,
        limit: int,
    ) -> dict[str, list[dict[str, Any]]]:
        people = self._get_people(
            person_ids,
            f"stats(group=[{group}],type=[playLog],season={season},limit={limit})",
        )
        return {
            str(person["id"]): self._get_stat_splits(person, "playLog")
            for person in people
            if person.get("id") is not None
        }

    def get_career_split_stats(self, person_ids: list[str], group: str) -> dict[str, dict[str, Any]]:
        if not person_ids:
            return {}
        people = self._get_people(
            person_ids,
            f"stats(group=[{group}],type=[statSplits],sitCodes=[vr,vl])",
        )
        return {str(person["id"]): person for person in people if person.get("id") is not None}

    def get_vs_player_total_stats(
        self,
        matchup_groups: list[dict[str, list[str] | str]],
    ) -> dict[str, dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        for group in matchup_groups:
            opposing_player_id = str(group["opposingPlayerId"])
            person_ids = [str(value) for value in group["personIds"]]
            for person_chunk in chunk(person_ids, 25):
                people = self._get_people(
                    person_chunk,
                    f"stats(group=[hitting],type=[vsPlayerTotal],opposingPlayerId={opposing_player_id})",
                )
                for person in people:
                    if person.get("id") is None:
                        continue
                    splits = self._get_stat_splits(person, "vsPlayerTotal")
                    if splits:
                        results[f"{person['id']}:{opposing_player_id}"] = splits[0]
        return results

    def _get_people(self, person_ids: list[str], hydrate_expression: str | None = None) -> list[dict[str, Any]]:
        if not person_ids:
            return []
        people: list[dict[str, Any]] = []
        for person_chunk in chunk(person_ids, 25):
            url = f"{self.settings.mlb_stats_api_base_url}/people?personIds={','.join(person_chunk)}"
            if hydrate_expression:
                url = f"{url}&hydrate={hydrate_expression}"
            payload = self.client.get_json(url)
            people.extend(payload.get("people") or [])
        return people

    @staticmethod
    def _get_stat_splits(person: dict[str, Any], display_name: str) -> list[dict[str, Any]]:
        for stat_block in person.get("stats") or []:
            if (stat_block.get("type") or {}).get("displayName") == display_name:
                return stat_block.get("splits") or []
        return []
