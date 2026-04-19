from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FlexibleModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class TeamInfo(FlexibleModel):
    id: str
    city: str
    name: str
    abbreviation: str


class VenueInfo(FlexibleModel):
    name: str
    city: str
    parkFactor: float
    homeRunFactor: float
    roof: str | None = None


class ProbablePitcherInfo(FlexibleModel):
    playerId: str
    name: str
    throwingHand: str


class WeatherInfo(FlexibleModel):
    condition: str
    temperatureF: float | None = None
    temperatureC: float | None = None
    wind: str | None = None
    windSpeedMph: float | None = None
    windGustsMph: float | None = None
    windDirection: str | None = None
    windDirectionDegrees: float | None = None
    precipitationProbability: float | None = None
    cloudCover: float | None = None
    pressureHpa: float | None = None


class OfficialInfo(FlexibleModel):
    type: str
    name: str
    id: str | None = None


class LineupEntry(FlexibleModel):
    playerId: str
    playerName: str
    battingOrder: int
    bats: str
    position: str | None = None
    status: Literal["confirmed", "projected"]


class TeamRunProjection(FlexibleModel):
    teamAbbreviation: str
    projectedRuns: float
    offensiveQuality: float
    matchupQuality: float
    opposingPitcherResistance: float
    environmentScore: float
    lineupConfidence: float
    reasons: list[str]


class GameRunProjection(FlexibleModel):
    away: TeamRunProjection
    home: TeamRunProjection
    totalRuns: float
    baselineTotal: float
    edgeVsBaseline: float
    runEnvironmentScore: float
    overUnderLean: Literal["over", "under", "neutral"]
    confidenceRating: Literal["elite", "strong", "watch", "thin"]
    summary: str
    reasons: list[str]


class GameInfo(FlexibleModel):
    gameId: str
    matchupId: str
    gameDate: str
    startTime: str
    matchupLabel: str
    status: Literal["scheduled", "in_progress", "final"]
    awayTeam: TeamInfo
    homeTeam: TeamInfo
    venue: VenueInfo
    probablePitchers: dict[str, ProbablePitcherInfo | None]
    lineupStatus: Literal["confirmed", "projected", "partial"]
    lineups: dict[str, list[LineupEntry]]
    weather: WeatherInfo | None = None
    officials: list[OfficialInfo] = Field(default_factory=list)
    runProjection: GameRunProjection | None = None
    source: Literal["mock", "live", "hybrid"] = "live"


class HitterScores(FlexibleModel):
    overallHitScore: float
    homeRunUpsideScore: float
    floorScore: float
    riskScore: float
    totalHitPotentialScore: float | None = None
    confidenceRating: str | None = None
    marketConfidence: dict | None = None


class PitcherScores(FlexibleModel):
    overallPitcherScore: float
    strikeoutUpsideScore: float
    safetyScore: float
    blowupRiskScore: float
    confidenceRating: str | None = None


class HitterCandidate(FlexibleModel):
    playerId: str
    playerName: str
    team: TeamInfo
    opponent: TeamInfo
    bats: str
    opposingPitcherHand: str
    gameId: str
    matchupId: str
    matchupLabel: str
    metrics: dict
    notes: list[str]
    source: Literal["mock", "live", "hybrid"] = "live"
    scores: HitterScores | None = None
    reasons: list[str] = Field(default_factory=list)


class PitcherCandidate(FlexibleModel):
    playerId: str
    playerName: str
    team: TeamInfo
    opponent: TeamInfo
    throwingHand: str
    gameId: str
    matchupId: str
    matchupLabel: str
    metrics: dict
    notes: list[str]
    source: Literal["mock", "live", "hybrid"] = "live"
    scores: PitcherScores | None = None
    reasons: list[str] = Field(default_factory=list)


class HitterHomeRunProp(FlexibleModel):
    market: Literal["hitter_home_run"] = "hitter_home_run"
    entityId: str
    gameId: str
    label: str
    playerName: str
    teamAbbreviation: str
    opponentAbbreviation: str
    matchupLabel: str
    lineupSpot: int
    lineupConfirmed: bool
    lineupSource: Literal["official", "projected"]
    homeRunScore: float
    blendedProbability: float
    heuristicProbability: float
    learnedProbability: float | None = None
    modelType: Literal["heuristic", "learned_logistic_blend"] = "heuristic"
    trainingSamples: int = 0
    confidence: Literal["core", "strong", "watch"] = "watch"
    reasons: list[str]
    metrics: dict


class PitcherStrikeoutProp(FlexibleModel):
    market: Literal["pitcher_strikeouts"] = "pitcher_strikeouts"
    entityId: str
    gameId: str
    label: str
    playerName: str
    teamAbbreviation: str
    opponentAbbreviation: str
    matchupLabel: str
    lineupConfirmed: bool
    lineupSource: Literal["official", "projected", "mixed"]
    strikeoutScore: float
    lineValue: float | None = None
    projectionValue: float | None = None
    meanValue: float | None = None
    medianValue: float | None = None
    deltaVsLine: float | None = None
    overLineProbability: float | None = None
    underLineProbability: float | None = None
    confidenceScore: float | None = None
    uncertaintyScore: float | None = None
    modelType: str | None = None
    projectionLayer: dict | None = None
    riskLayer: dict | None = None
    featureSnapshotTimestamp: str | None = None
    dataQualityFlags: list[str] = Field(default_factory=list)
    distribution: dict | None = None
    projectedStrikeouts: float
    meanKs: float
    medianKs: float
    over3_5Probability: float
    over4_5Probability: float
    inningsProjection: float
    confidence: Literal["core", "strong", "watch"] = "watch"
    reasons: list[str]
    metrics: dict


class PitcherLineProp(FlexibleModel):
    market: Literal["pitcher_walks", "pitcher_outs"]
    entityId: str
    gameId: str
    label: str
    playerName: str
    teamAbbreviation: str
    opponentAbbreviation: str
    matchupLabel: str
    lineupConfirmed: bool
    lineupSource: Literal["official", "projected", "mixed"]
    marketScore: float
    lineValue: float
    projectionValue: float
    meanValue: float | None = None
    medianValue: float | None = None
    deltaVsLine: float
    overLineProbability: float | None = None
    underLineProbability: float | None = None
    confidenceScore: float | None = None
    uncertaintyScore: float | None = None
    modelType: str | None = None
    projectionLayer: dict | None = None
    riskLayer: dict | None = None
    featureSnapshotTimestamp: str | None = None
    dataQualityFlags: list[str] = Field(default_factory=list)
    distribution: dict | None = None
    confidence: Literal["elite", "strong", "watch", "thin"] = "watch"
    reasons: list[str]
    metrics: dict


class HitterStatProp(FlexibleModel):
    market: Literal[
        "hitter_hits",
        "hitter_runs",
        "hitter_rbis",
        "hitter_total_bases",
        "hitter_walks",
    ]
    entityId: str
    gameId: str
    label: str
    playerName: str
    teamAbbreviation: str
    opponentAbbreviation: str
    matchupLabel: str
    lineupSpot: int
    lineupConfirmed: bool
    lineupSource: Literal["official", "projected"]
    marketScore: float
    lineValue: float
    projectionValue: float
    meanValue: float | None = None
    medianValue: float | None = None
    deltaVsLine: float
    overLineProbability: float | None = None
    underLineProbability: float | None = None
    confidenceScore: float | None = None
    uncertaintyScore: float | None = None
    modelType: str | None = None
    projectionLayer: dict | None = None
    riskLayer: dict | None = None
    featureSnapshotTimestamp: str | None = None
    dataQualityFlags: list[str] = Field(default_factory=list)
    distribution: dict | None = None
    confidence: Literal["elite", "strong", "watch", "thin"] = "watch"
    reasons: list[str]
    metrics: dict


SelectedPropType = Literal[
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
]


class SelectedPropCreate(FlexibleModel):
    date: str
    gameId: str
    playerId: str
    playerName: str
    team: str
    opponent: str
    propType: SelectedPropType
    selectionSide: Literal["over", "under"] = "over"
    lineValue: float | None = None
    projectionValue: float | None = None
    confidence: str | None = None
    explanationSummary: str | None = None
    matchupLabel: str | None = None
    selectionLabel: str | None = None


class SelectedProp(FlexibleModel):
    id: str
    date: str
    gameId: str
    playerId: str
    playerName: str
    team: str
    opponent: str
    propType: SelectedPropType
    selectionSide: Literal["over", "under"] = "over"
    lineValue: float | None = None
    projectionValue: float | None = None
    confidence: str | None = None
    explanationSummary: str | None = None
    matchupLabel: str | None = None
    selectionLabel: str | None = None
    status: str
    createdAt: str


class LiveSelectedProp(FlexibleModel):
    selectedPropId: str
    date: str
    gameId: str
    playerId: str
    playerName: str
    team: str
    opponent: str
    matchupLabel: str | None = None
    propType: SelectedPropType
    selectionSide: Literal["over", "under"] = "over"
    selectionLabel: str | None = None
    confidence: str | None = None
    explanationSummary: str | None = None
    gameStatus: str
    gameStartTime: str | None = None
    isLive: bool
    inningState: str | None = None
    inningNumber: int | None = None
    outs: int | None = None
    scoreLabel: str | None = None
    currentValue: float
    targetLine: float | None = None
    projectionValue: float | None = None
    deltaVsLine: float | None = None
    paceVsLine: float | None = None
    paceVsProjection: float | None = None
    remainingToClear: float | None = None
    isCleared: bool
    isLost: bool
    resultStatus: str
    paceStatus: str
    statBreakdown: dict
    lastUpdatedAt: str


class DailyAnalysisMeta(FlexibleModel):
    analysisDate: str
    generatedAt: str
    source: Literal["mock", "live", "hybrid"] = "live"
    providerName: str
    cacheStatus: Literal["hit", "miss"]
    notes: list[str]


class PlayerDetailStat(FlexibleModel):
    key: str
    label: str
    value: str | float | int | bool | None


class PlayerRecentGame(FlexibleModel):
    gameDate: str
    opponentLabel: str
    summary: str
    statItems: list[PlayerDetailStat]


class PlayerLineupMatchup(FlexibleModel):
    playerId: str
    playerName: str
    teamAbbreviation: str
    battingOrder: int
    bats: str
    position: str | None = None
    status: Literal["confirmed", "projected"]
    hitterScore: float
    homeRunUpsideScore: float
    recentForm: float
    pitchMixMatchupScore: float
    batterVsPitcher: dict


class PitchArsenalPitch(FlexibleModel):
    code: str
    description: str
    usage: float
    averageSpeed: float
    count: float


class PlayerDetailMeta(FlexibleModel):
    analysisDate: str
    generatedAt: str
    source: Literal["mock", "live", "hybrid"] = "live"
    cacheStatus: Literal["hit", "miss"]
    role: Literal["hitter", "pitcher"]
    notes: list[str]


class DailyAnalysisFilters(FlexibleModel):
    teams: list[str]
    matchups: list[dict]
    handedness: list[str]
    hitterScoreTypes: list[str]
    pitcherScoreTypes: list[str]


class DailyPropBoards(FlexibleModel):
    hitterHomeRuns: list[HitterHomeRunProp]
    hitterHits: list[HitterStatProp]
    hitterRuns: list[HitterStatProp]
    hitterRbis: list[HitterStatProp]
    hitterTotalBases: list[HitterStatProp]
    hitterWalks: list[HitterStatProp]
    pitcherStrikeouts: list[PitcherStrikeoutProp]
    pitcherWalks: list[PitcherLineProp]
    pitcherOuts: list[PitcherLineProp]


class Rankings(FlexibleModel):
    hitters: list[HitterCandidate]
    homeRunCandidates: list[HitterCandidate]
    hittersToAvoid: list[HitterCandidate]
    pitchers: list[PitcherCandidate]
    pitchersToAttack: list[PitcherCandidate]


class DailyAnalysisResponse(FlexibleModel):
    meta: DailyAnalysisMeta
    filters: DailyAnalysisFilters
    games: list[GameInfo]
    props: DailyPropBoards
    rankings: Rankings


class PlayerDetailResponse(FlexibleModel):
    meta: PlayerDetailMeta
    player: HitterCandidate | PitcherCandidate
    game: GameInfo | None = None
    overviewStats: list[PlayerDetailStat]
    matchupStats: list[PlayerDetailStat]
    recentGames: list[PlayerRecentGame]
    lineupMatchups: list[PlayerLineupMatchup]
    pitchArsenal: list[PitchArsenalPitch]
