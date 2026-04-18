from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import SelectedProp
from database.session import get_session


ALLOWED_PROP_TYPES = {
    "game_total_runs",
    "pitcher_strikeouts",
    "pitcher_walks",
    "pitcher_outs",
    "hitter_home_run",
    "hitter_hits",
    "hitter_runs",
    "hitter_rbis",
    "hitter_total_bases",
    "hitter_walks",
}


def _as_text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _as_float(value: Any) -> float | None:
    if value in {None, ""}:
        return None
    return round(float(value), 4)


def _as_selection_side(value: Any) -> str:
    normalized = str(value or "over").strip().lower()
    return "under" if normalized == "under" else "over"


class SelectedPropsService:
    def list_props(self, date: str | None = None) -> list[dict]:
        with get_session() as session:
            statement = select(SelectedProp).order_by(SelectedProp.created_at.desc())
            if date:
                statement = statement.where(SelectedProp.date == date)
            return [self._serialize(entry) for entry in session.scalars(statement).all()]

    def create_prop(self, payload: dict) -> dict:
        normalized = self._normalize_payload(payload)
        with get_session() as session:
            existing = self._find_existing(session, normalized)
            if existing:
                self._merge_existing(existing, normalized)
                session.commit()
                session.refresh(existing)
                return self._serialize(existing)

            entry = SelectedProp(
                date=normalized["date"],
                game_id=normalized["gameId"],
                player_id=normalized["playerId"],
                player_name=normalized["playerName"],
                team=normalized["team"],
                opponent=normalized["opponent"],
                matchup_label=normalized["matchupLabel"],
                prop_type=normalized["propType"],
                selection_side=normalized["selectionSide"],
                selection_label=normalized["selectionLabel"],
                line_value=normalized["lineValue"],
                projection_value=normalized["projectionValue"],
                confidence=normalized["confidence"],
                explanation_summary=normalized["explanationSummary"],
                status="tracked",
            )
            session.add(entry)
            session.commit()
            session.refresh(entry)
            return self._serialize(entry)

    def delete_prop(self, selected_prop_id: str) -> bool:
        with get_session() as session:
            entry = session.get(SelectedProp, selected_prop_id)
            if not entry:
                return False
            session.delete(entry)
            session.commit()
            return True

    def _normalize_payload(self, payload: dict) -> dict:
        prop_type = _as_text(payload.get("propType"))
        if prop_type not in ALLOWED_PROP_TYPES:
            raise ValueError("Unsupported prop type.")

        normalized = {
            "date": _as_text(payload.get("date")),
            "gameId": _as_text(payload.get("gameId")),
            "playerId": _as_text(payload.get("playerId")),
            "playerName": _as_text(payload.get("playerName")),
            "team": _as_text(payload.get("team")),
            "opponent": _as_text(payload.get("opponent")),
            "propType": prop_type,
            "selectionSide": _as_selection_side(payload.get("selectionSide")),
            "lineValue": _as_float(payload.get("lineValue")),
            "projectionValue": _as_float(payload.get("projectionValue")),
            "confidence": _as_text(payload.get("confidence")),
            "explanationSummary": _as_text(payload.get("explanationSummary")),
            "matchupLabel": _as_text(payload.get("matchupLabel")),
            "selectionLabel": _as_text(payload.get("selectionLabel")) or self._default_selection_label(payload),
        }
        if not all(
            normalized[field]
            for field in ("date", "gameId", "playerId", "playerName", "team", "opponent")
        ):
            raise ValueError("Selected props require date, game, player, and matchup identifiers.")
        return normalized

    def _find_existing(self, session: Session, payload: dict) -> SelectedProp | None:
        statement = select(SelectedProp).where(
            SelectedProp.date == payload["date"],
            SelectedProp.game_id == payload["gameId"],
            SelectedProp.player_id == payload["playerId"],
            SelectedProp.prop_type == payload["propType"],
        )
        if payload["lineValue"] is None:
            statement = statement.where(SelectedProp.line_value.is_(None))
        else:
            statement = statement.where(SelectedProp.line_value == payload["lineValue"])
        for entry in session.scalars(statement):
            if (entry.selection_side or "over") == payload["selectionSide"]:
                return entry
        return None

    @staticmethod
    def _merge_existing(entry: SelectedProp, payload: dict) -> None:
        entry.player_name = payload["playerName"]
        entry.team = payload["team"]
        entry.opponent = payload["opponent"]
        entry.matchup_label = payload["matchupLabel"] or entry.matchup_label
        entry.selection_side = payload["selectionSide"] or entry.selection_side
        entry.selection_label = payload["selectionLabel"] or entry.selection_label
        entry.projection_value = payload["projectionValue"] if payload["projectionValue"] is not None else entry.projection_value
        entry.confidence = payload["confidence"] or entry.confidence
        entry.explanation_summary = payload["explanationSummary"] or entry.explanation_summary

    @staticmethod
    def _default_selection_label(payload: dict) -> str:
        prop_type = str(payload.get("propType") or "")
        player_name = _as_text(payload.get("playerName")) or "Player"
        line_value = _as_float(payload.get("lineValue"))
        selection_side = _as_selection_side(payload.get("selectionSide"))
        matchup_label = _as_text(payload.get("matchupLabel"))
        if prop_type == "game_total_runs":
            game_label = matchup_label or f"{_as_text(payload.get('team')) or 'Away'} vs {_as_text(payload.get('opponent')) or 'Home'}"
            if line_value is not None:
                return f"{game_label} {selection_side} {line_value:g} total runs"
            return f"{game_label} total runs"
        if prop_type == "hitter_home_run":
            if selection_side == "over" and line_value is not None and abs(line_value - 0.5) < 0.0001:
                return f"{player_name} to hit a home run"
            if line_value is not None:
                return f"{player_name} {selection_side} {line_value:g} home runs"
            return f"{player_name} home runs"

        prop_labels = {
            "game_total_runs": "total runs",
            "pitcher_strikeouts": "strikeouts",
            "pitcher_walks": "walks allowed",
            "pitcher_outs": "outs recorded",
            "hitter_hits": "hits",
            "hitter_runs": "runs",
            "hitter_rbis": "runs batted in",
            "hitter_total_bases": "total bases",
            "hitter_walks": "walks",
        }
        label = prop_labels.get(prop_type)
        if label:
            if line_value is not None:
                return f"{player_name} {selection_side} {line_value:g} {label}"
            return f"{player_name} {label}"
        return f"{player_name} prop"

    @staticmethod
    def _serialize(entry: SelectedProp) -> dict:
        return {
            "id": entry.id,
            "date": entry.date,
            "gameId": entry.game_id,
            "playerId": entry.player_id,
            "playerName": entry.player_name,
            "team": entry.team,
            "opponent": entry.opponent,
            "matchupLabel": entry.matchup_label,
            "propType": entry.prop_type,
            "selectionSide": entry.selection_side or "over",
            "selectionLabel": entry.selection_label,
            "lineValue": entry.line_value,
            "projectionValue": entry.projection_value,
            "confidence": entry.confidence,
            "explanationSummary": entry.explanation_summary,
            "status": entry.status,
            "createdAt": entry.created_at.isoformat() + "Z",
        }
