# Selected Props Tracker

The Selected Props Tracker lets the dashboard save props from the hitter boards and props workspace, then poll live MLB game feeds to show current progress during the game.

## What It Tracks

- `pitcher_strikeouts`
- `hitter_home_run`
- `hitter_hits`
- `hitter_total_bases`

Each selected prop stores the selected date, game and player IDs, prop type, optional line, optional projection, confidence, explanation summary, and creation timestamp in the local SQLite database.

## Backend Flow

1. `POST /api/selected-props` creates or reuses a selected prop record.
2. `GET /api/selected-props` loads saved props for a given date.
3. `GET /api/selected-props/live` batches tracked props by `gameId`, fetches the official MLB live feed once per game, and returns normalized live tracking payloads.
4. `DELETE /api/selected-props/{id}` removes a tracked prop.

Core backend modules:

- `app/services/selected_props_service.py`
- `app/services/live_game_service.py`
- `app/services/live_props_engine.py`

## Frontend Flow

1. Hitter cards expose quick-add actions for HR, Hits, and Total Bases.
2. Strikeout props expose quick-add actions for `O3.5` and `O4.5`.
3. `SelectedPropsProvider` keeps the current date's selections in sync with the backend and saves a browser snapshot to local storage for refresh safety.
4. `SelectedPropsPage` polls live tracking more aggressively during live games and slows down for pregame or delayed states.

Core frontend modules:

- `frontend/src/store/SelectedPropsContext.tsx`
- `frontend/src/components/SelectedPropsPage.tsx`
- `frontend/src/components/SelectedPropCard.tsx`
- `frontend/src/utils/selectedProps.ts`

## Notes

- Hits and total bases selections currently use tracker-friendly default lines from the hitter boards.
- Home run selections track against a `0.5` line, which resolves as cleared after the first HR.
- Live stat progress is driven by the official MLB live game feed, not scraped HTML.
