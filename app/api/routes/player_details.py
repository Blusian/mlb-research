from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.services.player_detail_service import PlayerDetailService


router = APIRouter()
player_detail_service = PlayerDetailService()


@router.get("/api/player-details")
def get_player_details(
    playerId: str = Query(...),
    role: str = Query(...),
    date: str = Query(...),
    gameId: str | None = Query(default=None),
    refresh: bool = False,
) -> dict:
    if role not in {"hitter", "pitcher"}:
        raise HTTPException(status_code=400, detail="role must be 'hitter' or 'pitcher'.")

    try:
        return player_detail_service.get_player_detail(
            player_id=playerId,
            role=role,
            analysis_date=date,
            game_id=gameId,
            force_refresh=refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
