from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status

from app.models.schemas import LiveSelectedProp, SelectedProp, SelectedPropCreate
from app.services.live_game_service import LiveGameService
from app.services.live_props_engine import LivePropsEngine
from app.services.selected_props_service import SelectedPropsService


router = APIRouter()
selected_props_service = SelectedPropsService()
live_game_service = LiveGameService()
live_props_engine = LivePropsEngine()


@router.get("/api/selected-props", response_model=list[SelectedProp])
def get_selected_props(date: str | None = None) -> list[dict]:
    return selected_props_service.list_props(date=date)


@router.post("/api/selected-props", response_model=SelectedProp, status_code=status.HTTP_201_CREATED)
def create_selected_prop(payload: SelectedPropCreate) -> dict:
    try:
        return selected_props_service.create_prop(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/api/selected-props/{selected_prop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_selected_prop(selected_prop_id: str) -> Response:
    if not selected_props_service.delete_prop(selected_prop_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected prop not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/selected-props/live", response_model=list[LiveSelectedProp])
def get_live_selected_props(date: str | None = None) -> list[dict]:
    selected_props = selected_props_service.list_props(date=date)
    if not selected_props:
        return []
    live_games = live_game_service.get_live_games([selected_prop["gameId"] for selected_prop in selected_props])
    return live_props_engine.build_live_states(selected_props, live_games)
