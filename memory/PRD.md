# GymTrack — Product Requirements Document

## Original Problem Statement
User provided three artifacts (architecture.md, gym-tracker-app-plan.md, sprints.md) describing a comprehensive Gym Progress Tracker PWA. Vision: serious, honest progress tracker for hypertrophy/strength lifters with offline-first logging, deterministic insights, and progressive AI prose. 16-sprint roadmap. User chose: adapt to React+FastAPI+Mongo, build sprint-by-sprint, Emergent Google auth, Claude 4.5 LLM digest, full PWA with sync (deferred).

## User Personas
- **Serious lifter** (intermediate→advanced): Tracks RIR, follows mesocycles, cares about volume landmarks (MEV/MAV/MRV).
- **Beginner**: Needs auto-generated programs, exercise demos, simple onboarding.

## Core Requirements (static)
- Logging is sacred: fast, never lose data, mobile-first one-thumb UX.
- Honest projections; no hype.
- Explainable insights (deterministic first, LLM prose later).
- Offline-first PWA (deferred to future sprint).

## Architecture
- React (CRA) + Tailwind + shadcn/ui + Recharts
- FastAPI + MongoDB (motor)
- Emergent Google OAuth (cookie + bearer token)
- Claude Sonnet 4.5 via emergentintegrations + EMERGENT_LLM_KEY for weekly digest

## What's been implemented (2026-02 — Sprint 0–6 MVP)
[unchanged from before]

## What's been implemented (2026-02 — Sprint 7–9: Recommendations + Advanced Logging)
- **Sprint 7 — Recommendation engine**:
  - `recommend_next_set()` in services.py: progression (+2.5% if reps≥top range and RIR≤1), deload-on-failure (-5%), plateau break (-10%)
  - `starter_weight()` heuristic: bodyweight × experience multiplier × movement-pattern multiplier, with equipment-aware rounding (barbell 2.5kg, DB 1.0kg)
  - `detect_plateau_e1rm()`: compares last 3 vs prior 3 session best e1RMs (≤0.5% improvement = plateau)
  - New endpoint `GET /api/workouts/{id}/recommendations` returns `{recommendations, readiness, plateau_exercise_ids}`
  - Frontend ActiveWorkout fetches recommendations on mount, displays `rec 38kg × 8 (starter)` chip per exercise, pre-fills SetRow with suggested values
- **Sprint 8 — Recovery-modulated**:
  - Recommendation engine applies recovery scale (0.85→1.0) when avg recovery of primary subgroups <60%
  - Per-exercise readiness chip on workout card (orange when <60%)
  - Plateau alert badge per exercise card
- **Sprint 9 — Advanced logging**:
  - SetLogPayload extended with `seconds` (time-based), `is_unilateral`, `parent_set_id`
  - Set type dropdown menu per row: Normal / Warmup / Dropset / Myo-rep / Cluster (with visual badges WU/DROP/MYO/CLUSTER, color-coded ring, dimmed for warmup)
  - Warmup sets excluded from rest timer trigger and from completedCount tally
  - Recommendations exclude warmup sets from history (so suggestions reflect working sets only)

## Test status (Sprints 0-14 + PWA)
- Backend: 26/26 pytest passing
- Frontend: skeleton loaders, error boundary, install prompt, offline badge, manifest+sw.js all verified via screenshots; lint clean (no issues)

## What's been implemented (2026-02 — Sprint 14: Polish/perf/a11y)
- **Skeleton loaders** on Today, Mesocycle, Progress (replaced "loading..." text); reusable `<PageSkeleton>` and `<ListSkeleton>` components
- **Error boundary** at App root: catches render errors, shows graceful "Something cracked" screen with stack message + reload button
- **A11y**: `:focus-visible` ring globally, `prefers-reduced-motion` opt-out, skip-to-content link, aria-labels on every icon-only button (NumPad keys, RestTimer controls, AppShell nav), `aria-current="page"` on active nav tab, `aria-live="polite"` on offline badge
- **Animation pass**: existing fade-up + delay classes already in use; respects reduced-motion preference

## What's been implemented (2026-02 — PWA + offline-lite sync)
- **manifest.webmanifest**: name, theme color (#0F0F11), maskable SVG icons (192×192 + 512×512), start_url=/today, display=standalone
- **Service worker** (`/sw.js`): network-first SWR for `/api/` GETs (cache fallback for offline reads); cache-first for static shell; auto-cleanup of old caches on activate; only registered in production builds
- **`apple-mobile-web-app-*` meta** tags + standalone-friendly viewport
- **Install prompt** component listening to `beforeinstallprompt`; dismiss memory in localStorage
- **Offline outbound queue** (`lib/offlineQueue.js`): IndexedDB-backed queue for failed POST `/sets`; auto-flushes on `online` event
- **`logSetWithQueue` wrapper** in `lib/api.js`: optimistic local response with `_offline` flag when network fails; original POST signature unchanged for callers
- **OfflineBadge** component: shows "OFFLINE" or "N syncing" pill in top-right when offline or queue non-empty (auto-refreshes every 4s)

## What's been implemented (2026-02 — Sprint 10–11: Insights polish + LLM Tier-2)
- **Richer LLM context**: digest now receives prev-week volume, top movers (week-over-week delta), weak subgroups (below MEV with ratio), streak days, plus PRs
- **Hallucination guard**: post-LLM, we extract every number from output and verify it appears in our input data; ≥2 unverified numbers → reject + auto-fall back to deterministic prose; response includes `source: 'llm' | 'fallback' | 'guard_failed'`
- **"See the data" toggle** on every insight + on weekly digest — shows raw data_snapshot (workouts, compliance, streak, movers, weak subgroups, PRs)
- New deterministic insight types: `streak` (3+ consecutive training days)
- New `streak_days`, `weak_subgroups`, `top_movers`, `previous_weekly_volume` fields on `/api/insights`

## What's been implemented (2026-02 — Sprint 12: Adaptive splits + mesocycle automation)
- **Auto deload**: program generator now marks last week (when weeks≥3) as deload — target sets at 60%, workout name suffixed "(Deload)", `is_deload` flag on workout
- **`POST /api/programs/redistribute`**: pushes past-date scheduled workouts forward to next available days, preserving order, marks `rescheduled: true`
- **`GET /api/programs/mesocycle`**: per-week summary (target_sets, completed_sets, %, is_deload, is_current, workout list)
- **`POST /api/programs/next-mesocycle`**: ends current program, auto-generates a fresh one (same split) starting next Monday
- **Frontend Mesocycle page** (`/mesocycle`): week cards with progress bars + deload badge + workout list with status dots; "Redistribute missed" CTA; "Start next mesocycle" CTA when all workouts complete
- **Today screen Mesocycle CTA**: card linking to /mesocycle

## Backlog (P0 → P2)
- **P0 next sprint**: Recommendation engine (Sprint 7) — pre-fill weight/reps suggestions based on last set + plateau detection
- **P1**: Stimulus-fatigue recommendations (Sprint 8); Advanced logging (supersets, dropsets, myo-reps, time-based) (Sprint 9); LLM Tier-2 prompt-engineering polish (Sprint 11); Adaptive splits / mesocycle automation (Sprint 12)
- **P2**: Advanced analytics (subgroup distribution charts, SFE triangle, adaptive moving avg) (Sprint 13); Polish/perf/a11y (Sprint 14); Stripe monetisation (Sprint 15); Public launch (Sprint 16); Photos/circumferences/account export
- **Deferred**: Full offline-first Dexie sync engine + PWA service worker (Sprint 4-5 spec); native Capacitor wrap

## Next Tasks
1. ~~Run testing agent end-to-end~~ ✅ 20/20 backend pytest pass; frontend smoke test pass (login, protected redirect, Today, Exercises, Settings, Insights)
2. Continue with **Sprint 7 (recommendation engine)** — pre-fill weight/reps in logger based on last set + plateau detection
3. Sprint 8 stimulus-fatigue advanced model; Sprint 9 advanced logging (supersets, dropsets, myo-reps)

## Test status (Sprint 0-6 MVP)
- Backend: 20/20 pytest passing — health, auth gating, exercises, splits, programs, workout flow (start→log set→update→delete→complete), body measurements, progress overview, insights, **LLM digest via Claude Sonnet 4.5** working with EMERGENT_LLM_KEY
- Frontend: login renders, protected routes redirect, authenticated Today/Library/Profile/Insights tabs all functional
- Note: testing agent corrupted /app/frontend/.env REACT_APP_BACKEND_URL during pytest setup — restored to correct preview URL
