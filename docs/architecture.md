# Architecture

The MVP is split into seven layers:

1. `providers`
   - Orchestrate seeded mock data or the live composite source stack.
   - Keep provider orchestration separate from source-specific HTTP clients.

2. `sources`
   - `MLB Stats API` for schedule, game ids, teams, probable pitchers, lineups, officials, and player/game context.
   - `Baseball Savant` grouped CSV endpoints for hard-hit rate, barrel rate, exit velocity, xwOBA, xBA, xSLG, split context, and bat-tracking metrics.
   - `Open-Meteo` for game-time weather overlays.
   - `FanGraphs` support adapters for probable-pitcher and split-source validation.

3. `normalization`
   - Convert incomplete provider responses into stable internal models.
   - Fill safe defaults for missing metrics, lineups, weather, and officials.

4. `scoring-engine`
   - Apply transparent weighted formulas to hitters and pitchers.
   - Blend split stats with bat speed, squared-up rate, blasts, and handedness-aware park inputs.
   - Keep weights in config so the ranking behavior is easy to tune.

5. `services`
   - Cache daily responses, apply filters, build ranked lists, and shape API payloads.
   - Persist cache to disk so repeated local runs do not always rebuild the same slate.

6. `frontend`
   - Show game context, ranking cards, saved views, and CSV exports in a lightweight dashboard.

7. `modeling`
   - Persist dated pregame snapshots for backtesting.
   - Ingest final MLB game, hitter, and pitcher outcomes.
   - Import sportsbook odds for supported markets, including name-and-team resolution when ids are missing.
   - Derive market probabilities from the current scoring engine, then evaluate calibration, log loss, Brier score, and optional ROI.
   - Train a walk-forward home-run probability model from stored snapshots and settled hitter outcomes.

## Design choices

- Simple npm workspaces instead of a heavier monorepo tool
- Shared types to make the API contract explicit
- Mock-first startup so the repo always has a usable first-run experience
- Live provider as a composition layer over swappable source clients
- File-backed cache for local MVP persistence without introducing infrastructure

## Current data flow

1. The backend receives a date and optional filters.
2. A provider composes the source stack for that date.
3. The normalization layer applies stable defaults.
4. The scoring engine ranks hitters and pitchers and generates short reasons.
5. The service layer caches the response and applies query filters.
6. The frontend renders:
   - game cards
   - hitter rankings
   - pitcher rankings
   - saved local views
   - CSV export actions
7. Offline modeling scripts can then:
   - archive the pregame response
   - ingest final results
   - import odds
   - run backtests against stored history

## Tradeoffs

- The live provider prefers public APIs and structured stat endpoints over brittle scraping.
- Confirmed lineups depend on what MLB Stats API exposes at the moment the request runs.
- The MVP uses browser local storage for saved views, which is enough for single-user local use but not shared accounts.
- The new modeling layer still starts from heuristic score-to-probability mappings, so calibration improves as more dated snapshots and outcomes are collected.
- The home-run market now has a lightweight learned layer, but the model quality still depends on collecting more dated snapshots, outcomes, and odds history over time.
