from __future__ import annotations

import math
from typing import Any


def _normalize_selection_side(value: str | None) -> str:
    return "under" if str(value or "").strip().lower() == "under" else "over"


def _round_or_none(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _required_to_clear(line_value: float | None, selection_side: str) -> float | None:
    if line_value is None:
        return None
    if selection_side == "under":
        return float(line_value)
    return math.floor(float(line_value)) + 1


def _compare_to_line(current_value: float, line_value: float | None) -> int | None:
    if line_value is None:
        return None
    delta = current_value - float(line_value)
    if abs(delta) < 1e-9:
        return 0
    return 1 if delta > 0 else -1


def _is_cleared(current_value: float, line_value: float | None, selection_side: str, game_status: str) -> bool:
    comparison = _compare_to_line(current_value, line_value)
    if comparison is None:
        return False
    if selection_side == "under":
        return game_status == "Final" and comparison < 0
    return comparison > 0


def _is_lost(current_value: float, line_value: float | None, selection_side: str, game_status: str) -> bool:
    comparison = _compare_to_line(current_value, line_value)
    if comparison is None:
        return False
    if selection_side == "under":
        return comparison > 0
    if game_status == "Final":
        return comparison < 0
    return False


def _remaining_to_clear(current_value: float, line_value: float | None, selection_side: str) -> float | None:
    required = _required_to_clear(line_value, selection_side)
    if required is None:
        return None
    if selection_side == "under":
        return max(required - current_value, 0.0)
    return max(float(required) - current_value, 0.0)


def _delta_vs_line(current_value: float, line_value: float | None, selection_side: str) -> float | None:
    if line_value is None:
        return None
    raw_delta = current_value - float(line_value)
    if selection_side == "under":
        raw_delta *= -1
    return _round_or_none(raw_delta)


def _outs_recorded(innings_pitched: Any) -> int:
    value = str(innings_pitched or "0.0")
    try:
        whole, _, remainder = value.partition(".")
        return int(whole) * 3 + int(remainder or "0")
    except ValueError:
        return 0


def _progress_ratio_for_pitcher(stat_breakdown: dict[str, Any]) -> float:
    batters_faced = float(stat_breakdown.get("battersFaced") or 0)
    if batters_faced > 0:
        return min(max(batters_faced / 24.0, 0.0), 1.2)
    outs_recorded = _outs_recorded(stat_breakdown.get("inningsPitched"))
    return min(max((outs_recorded / 3) / 6.0, 0.0), 1.2)


def _progress_ratio_for_hitter(stat_breakdown: dict[str, Any]) -> float:
    plate_appearances = float(stat_breakdown.get("plateAppearances") or 0)
    return min(max(plate_appearances / 4.4, 0.0), 1.2)


def _completed_outs_by_game_state(
    inning_state: Any,
    inning_number: Any,
    outs: Any,
) -> int:
    try:
        inning = int(inning_number or 0)
    except (TypeError, ValueError):
        inning = 0

    try:
        outs_value = max(min(int(outs or 0), 3), 0)
    except (TypeError, ValueError):
        outs_value = 0

    if inning <= 0:
        return 0

    completed_outs = max(inning - 1, 0) * 6
    normalized_state = str(inning_state or "").strip().lower()

    if normalized_state.startswith("bot"):
        return completed_outs + 3 + outs_value
    if normalized_state.startswith("top"):
        return completed_outs + outs_value
    return completed_outs


def _progress_ratio_for_game(stat_breakdown: dict[str, Any]) -> float:
    completed_outs = float(stat_breakdown.get("completedOuts") or 0)
    return min(max(completed_outs / 54.0, 0.0), 1.2)


def _pace_values(
    current_value: float,
    line_value: float | None,
    projection_value: float | None,
    progress_ratio: float,
    selection_side: str,
) -> tuple[float | None, float | None]:
    if progress_ratio <= 0:
        return None, None

    pace_vs_line = None
    required = _required_to_clear(line_value, selection_side)
    if required is not None:
        expected_line_progress = float(required) * progress_ratio
        pace_vs_line = (
            expected_line_progress - current_value
            if selection_side == "under"
            else current_value - expected_line_progress
        )

    pace_vs_projection = None
    if projection_value is not None:
        expected_projection_progress = projection_value * progress_ratio
        pace_vs_projection = (
            expected_projection_progress - current_value
            if selection_side == "under"
            else current_value - expected_projection_progress
        )

    return _round_or_none(pace_vs_line), _round_or_none(pace_vs_projection)


def _result_status(
    game_status: str,
    current_value: float,
    line_value: float | None,
    selection_side: str,
) -> tuple[str, bool]:
    if game_status == "Postponed":
        return "postponed", False
    if game_status == "Suspended":
        return "suspended", False
    if game_status == "Delayed":
        return "delayed", False

    comparison = _compare_to_line(current_value, line_value)

    if game_status == "Final":
        if line_value is None or comparison is None:
            return "final", False
        if comparison == 0:
            return "push", False
        if selection_side == "under":
            return ("won", False) if comparison < 0 else ("lost", True)
        return ("won", False) if comparison > 0 else ("lost", True)

    if selection_side == "under" and comparison == 1:
        return "lost", True
    if selection_side == "over" and comparison == 1:
        return "cleared", False
    if game_status == "Live":
        return "live", False
    return "pregame", False


def _pace_status(
    prop_type: str,
    game_status: str,
    current_value: float,
    projection_value: float | None,
    line_value: float | None,
    stat_breakdown: dict[str, Any],
    is_cleared: bool,
    selection_side: str,
) -> str:
    if game_status in {"Postponed", "Suspended", "Delayed"}:
        return game_status.lower()
    if game_status == "Pregame":
        return "pregame"
    if game_status == "Final":
        if line_value is not None and _compare_to_line(current_value, line_value) == 0:
            return "push"
        return "cleared" if is_cleared else "final"
    if is_cleared:
        return "cleared"
    if selection_side == "under" and _compare_to_line(current_value, line_value) == 1:
        return "lost"

    if prop_type in {"pitcher_strikeouts", "pitcher_walks", "pitcher_outs"}:
        progress_ratio = _progress_ratio_for_pitcher(stat_breakdown)
    elif prop_type == "game_total_runs":
        progress_ratio = _progress_ratio_for_game(stat_breakdown)
    else:
        progress_ratio = _progress_ratio_for_hitter(stat_breakdown)

    if progress_ratio <= 0:
        return "watching"

    if prop_type == "hitter_home_run":
        plate_appearances = float(stat_breakdown.get("plateAppearances") or 0)
        if selection_side == "under":
            return "on_pace" if current_value <= (line_value or 0.0) and plate_appearances <= 4 else "behind_pace"
        return "on_pace" if plate_appearances <= 3 else "behind_pace"

    pace_vs_line, pace_vs_projection = _pace_values(
        current_value,
        line_value,
        projection_value,
        progress_ratio,
        selection_side,
    )
    if prop_type == "pitcher_strikeouts":
        threshold = -0.2
    elif prop_type == "game_total_runs":
        threshold = -0.35
    else:
        threshold = -0.15
    comparison = pace_vs_projection if pace_vs_projection is not None else pace_vs_line
    if comparison is None:
        return "watching"
    return "on_pace" if comparison >= threshold else "behind_pace"


class LivePropsEngine:
    def build_live_states(
        self,
        selected_props: list[dict],
        live_games: dict[str, dict[str, Any]],
    ) -> list[dict]:
        live_states: list[dict] = []
        for selected_prop in selected_props:
            live_states.append(self._build_state(selected_prop, live_games.get(selected_prop["gameId"]) or {}))
        return live_states

    def _build_state(self, selected_prop: dict, game_snapshot: dict[str, Any]) -> dict:
        player_snapshot = (game_snapshot.get("players") or {}).get(selected_prop["playerId"]) or {}
        batting = player_snapshot.get("batting") or {}
        pitching = player_snapshot.get("pitching") or {}
        prop_type = selected_prop["propType"]
        selection_side = _normalize_selection_side(selected_prop.get("selectionSide"))
        game_status = game_snapshot.get("gameStatus") or "Pregame"
        current_value = 0.0
        stat_breakdown: dict[str, Any] = {}

        if prop_type == "pitcher_strikeouts":
            current_value = float(pitching.get("strikeouts") or 0)
            stat_breakdown = {
                "battersFaced": int(pitching.get("battersFaced") or 0),
                "pitchCount": int(pitching.get("pitchCount") or 0),
                "inningsPitched": pitching.get("inningsPitched") or "0.0",
            }
            progress_ratio = _progress_ratio_for_pitcher(stat_breakdown)
        elif prop_type == "pitcher_walks":
            current_value = float(pitching.get("walks") or 0)
            stat_breakdown = {
                "walks": int(pitching.get("walks") or 0),
                "battersFaced": int(pitching.get("battersFaced") or 0),
                "pitchCount": int(pitching.get("pitchCount") or 0),
                "inningsPitched": pitching.get("inningsPitched") or "0.0",
            }
            progress_ratio = _progress_ratio_for_pitcher(stat_breakdown)
        elif prop_type == "pitcher_outs":
            current_value = float(_outs_recorded(pitching.get("inningsPitched")))
            stat_breakdown = {
                "outsRecorded": int(current_value),
                "battersFaced": int(pitching.get("battersFaced") or 0),
                "pitchCount": int(pitching.get("pitchCount") or 0),
                "inningsPitched": pitching.get("inningsPitched") or "0.0",
            }
            progress_ratio = _progress_ratio_for_pitcher(stat_breakdown)
        elif prop_type == "game_total_runs":
            current_value = float(
                game_snapshot.get("totalRuns")
                or (
                    float(game_snapshot.get("awayRuns") or 0)
                    + float(game_snapshot.get("homeRuns") or 0)
                )
            )
            stat_breakdown = {
                "awayRuns": int(game_snapshot.get("awayRuns") or 0),
                "homeRuns": int(game_snapshot.get("homeRuns") or 0),
                "totalRuns": int(current_value),
                "inningState": game_snapshot.get("inningState"),
                "inningNumber": game_snapshot.get("inningNumber"),
                "outs": game_snapshot.get("outs"),
                "completedOuts": _completed_outs_by_game_state(
                    game_snapshot.get("inningState"),
                    game_snapshot.get("inningNumber"),
                    game_snapshot.get("outs"),
                ),
            }
            progress_ratio = _progress_ratio_for_game(stat_breakdown)
        elif prop_type == "hitter_hits":
            current_value = float(batting.get("hits") or 0)
            stat_breakdown = {
                "atBats": int(batting.get("atBats") or 0),
                "plateAppearances": int(batting.get("plateAppearances") or 0),
                "walks": int(batting.get("walks") or 0),
            }
            progress_ratio = _progress_ratio_for_hitter(stat_breakdown)
        elif prop_type == "hitter_runs":
            current_value = float(batting.get("runs") or 0)
            stat_breakdown = {
                "runs": int(batting.get("runs") or 0),
                "hits": int(batting.get("hits") or 0),
                "walks": int(batting.get("walks") or 0),
                "plateAppearances": int(batting.get("plateAppearances") or 0),
            }
            progress_ratio = _progress_ratio_for_hitter(stat_breakdown)
        elif prop_type == "hitter_rbis":
            current_value = float(batting.get("rbi") or 0)
            stat_breakdown = {
                "rbi": int(batting.get("rbi") or 0),
                "hits": int(batting.get("hits") or 0),
                "homeRuns": int(batting.get("homeRuns") or 0),
                "plateAppearances": int(batting.get("plateAppearances") or 0),
                "atBats": int(batting.get("atBats") or 0),
            }
            progress_ratio = _progress_ratio_for_hitter(stat_breakdown)
        elif prop_type == "hitter_total_bases":
            current_value = float(batting.get("totalBases") or 0)
            stat_breakdown = {
                "atBats": int(batting.get("atBats") or 0),
                "plateAppearances": int(batting.get("plateAppearances") or 0),
                "hits": int(batting.get("hits") or 0),
                "singles": int(batting.get("singles") or 0),
                "doubles": int(batting.get("doubles") or 0),
                "triples": int(batting.get("triples") or 0),
                "homeRuns": int(batting.get("homeRuns") or 0),
            }
            progress_ratio = _progress_ratio_for_hitter(stat_breakdown)
        elif prop_type == "hitter_walks":
            current_value = float(batting.get("walks") or 0)
            stat_breakdown = {
                "walks": int(batting.get("walks") or 0),
                "plateAppearances": int(batting.get("plateAppearances") or 0),
                "atBats": int(batting.get("atBats") or 0),
                "hits": int(batting.get("hits") or 0),
            }
            progress_ratio = _progress_ratio_for_hitter(stat_breakdown)
        else:
            current_value = float(batting.get("homeRuns") or 0)
            stat_breakdown = {
                "plateAppearances": int(batting.get("plateAppearances") or 0),
                "atBats": int(batting.get("atBats") or 0),
                "hits": int(batting.get("hits") or 0),
                "homeRuns": int(batting.get("homeRuns") or 0),
                "hasHomer": bool((batting.get("homeRuns") or 0) >= 1),
            }
            progress_ratio = _progress_ratio_for_hitter(stat_breakdown)

        line_value = selected_prop.get("lineValue")
        projection_value = selected_prop.get("projectionValue")
        is_cleared = _is_cleared(current_value, line_value, selection_side, game_status)
        result_status, is_lost = _result_status(game_status, current_value, line_value, selection_side)
        pace_status = _pace_status(
            prop_type=prop_type,
            game_status=game_status,
            current_value=current_value,
            projection_value=projection_value,
            line_value=line_value,
            stat_breakdown=stat_breakdown,
            is_cleared=is_cleared,
            selection_side=selection_side,
        )
        pace_vs_line, pace_vs_projection = _pace_values(
            current_value,
            line_value,
            projection_value,
            progress_ratio,
            selection_side,
        )
        delta_vs_line = _delta_vs_line(current_value, line_value, selection_side)
        remaining_to_clear = _remaining_to_clear(current_value, line_value, selection_side)

        return {
            "selectedPropId": selected_prop["id"],
            "date": selected_prop["date"],
            "gameId": selected_prop["gameId"],
            "playerId": selected_prop["playerId"],
            "playerName": selected_prop["playerName"],
            "team": selected_prop["team"],
            "opponent": selected_prop["opponent"],
            "matchupLabel": selected_prop.get("matchupLabel") or game_snapshot.get("matchupLabel"),
            "propType": prop_type,
            "selectionSide": selection_side,
            "selectionLabel": selected_prop.get("selectionLabel"),
            "confidence": selected_prop.get("confidence"),
            "explanationSummary": selected_prop.get("explanationSummary"),
            "gameStatus": game_status,
            "gameStartTime": game_snapshot.get("gameStartTime"),
            "isLive": bool(game_snapshot.get("isLive")),
            "inningState": game_snapshot.get("inningState"),
            "inningNumber": game_snapshot.get("inningNumber"),
            "outs": game_snapshot.get("outs"),
            "scoreLabel": game_snapshot.get("scoreLabel"),
            "currentValue": round(current_value, 2),
            "targetLine": line_value,
            "projectionValue": projection_value,
            "deltaVsLine": delta_vs_line,
            "paceVsLine": pace_vs_line,
            "paceVsProjection": pace_vs_projection,
            "remainingToClear": _round_or_none(remaining_to_clear),
            "isCleared": is_cleared,
            "isLost": is_lost,
            "resultStatus": result_status,
            "paceStatus": pace_status,
            "statBreakdown": stat_breakdown,
            "lastUpdatedAt": game_snapshot.get("lastUpdatedAt"),
        }
