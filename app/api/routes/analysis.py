from __future__ import annotations

from fastapi import APIRouter, Query

from app.services.analysis_service import DailyAnalysisService


router = APIRouter()
analysis_service = DailyAnalysisService()


@router.get("/api/daily-analysis")
def get_daily_analysis(
    date: str | None = None,
    team: str | None = None,
    matchup: str | None = None,
    handedness: str | None = None,
    hitterScoreType: str | None = Query(default=None),
    pitcherScoreType: str | None = Query(default=None),
    refresh: bool = False,
) -> dict:
    query = {
        "date": date,
        "team": team,
        "matchup": matchup,
        "handedness": handedness,
        "hitterScoreType": hitterScoreType,
        "pitcherScoreType": pitcherScoreType,
    }
    return analysis_service.get_daily_analysis(query, force_refresh=refresh)


@router.get("/api/games/today")
def get_games_today(date: str | None = None, refresh: bool = False) -> dict:
    response = analysis_service.get_daily_analysis({"date": date}, force_refresh=refresh)
    return {
        "meta": response["meta"],
        "filters": response["filters"],
        "games": response["games"],
    }
