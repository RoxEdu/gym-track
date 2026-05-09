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

## What's been implemented (2026-02 — Sprint 0–6 MVP equivalent)
- **Auth**: Emergent Google OAuth flow, session cookie, /api/auth/me, logout
- **Onboarding**: 6-step Typeform-style flow (welcome, stats, experience, goal, schedule, split selection); generates 4-week mesocycle on completion
- **Exercise library**: 59 exercises across chest/back/shoulders/arms/legs/core with subgroup contributions, equipment, movement patterns, YouTube IDs, search/filter
- **Splits**: 4 system templates (PPL, Upper/Lower, Full Body 3x, Bro Split)
- **Program generator**: Picks best-fit exercises per slot, progressive volume across weeks, generates concrete workouts
- **Workout logger**: Active workout screen, custom NumPad for weight/reps/RIR, set rows, rest timer with vibration, YouTube embed modal, supports adding extra sets, edit/delete logged sets
- **PR detection**: Automatic e1RM (Epley) and PR tracking on each set log
- **Body measurements**: Log weight + body fat
- **Progress dashboard**: Weekly volume bars (8 weeks), body weight trend, PR feed, total stats
- **Insights**: Deterministic insights (low/high volume vs MEV/MAV/MRV, PR celebrations, adherence warnings); LLM-powered weekly digest via Claude Sonnet 4.5; volume vs landmarks visualisation
- **Recovery score**: Stimulus-fatigue model with 48h half-life decay
- **Settings**: Profile view, body log, switch split / regenerate program, sign out

## Backlog (P0 → P2)
- **P0 next sprint**: Recommendation engine (Sprint 7) — pre-fill weight/reps suggestions based on last set + plateau detection
- **P1**: Stimulus-fatigue recommendations (Sprint 8); Advanced logging (supersets, dropsets, myo-reps, time-based) (Sprint 9); LLM Tier-2 prompt-engineering polish (Sprint 11); Adaptive splits / mesocycle automation (Sprint 12)
- **P2**: Advanced analytics (subgroup distribution charts, SFE triangle, adaptive moving avg) (Sprint 13); Polish/perf/a11y (Sprint 14); Stripe monetisation (Sprint 15); Public launch (Sprint 16); Photos/circumferences/account export
- **Deferred**: Full offline-first Dexie sync engine + PWA service worker (Sprint 4-5 spec); native Capacitor wrap

## Next Tasks
1. Run testing agent end-to-end (backend + frontend)
2. Address any critical bugs
3. Continue with Sprint 7 (recommendation engine) on next user message
