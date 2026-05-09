"""Gym Progress Tracker - FastAPI backend with Emergent Google Auth."""
import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Cookie, Header
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict

from seeds import EXERCISES, SYSTEM_SPLITS, MUSCLE_GROUPS, DEFAULT_LANDMARKS
from services import (
    generate_program_workouts,
    compute_one_rep_max,
    compute_weekly_volume,
    generate_deterministic_insights,
    generate_llm_weekly_digest,
    compute_recovery_score,
    recommend_next_set,
    starter_weight,
    detect_plateau_e1rm,
    compute_streak_days,
    find_weak_subgroups,
    compute_top_movers,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="GymTrack API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


# ============ Models ============
class UserProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    onboarded: bool = False
    units: str = "kg"
    theme: str = "dark"
    sex: Optional[str] = None
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    experience: Optional[str] = None  # beginner/intermediate/advanced
    goal: Optional[str] = None  # hypertrophy/strength/recomp/cut
    days_per_week: Optional[int] = None
    equipment: List[str] = []
    active_program_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class OnboardingPayload(BaseModel):
    sex: str
    age: int
    height_cm: float
    weight_kg: float
    experience: str
    goal: str
    days_per_week: int
    equipment: List[str]
    units: str = "kg"


class SetLogPayload(BaseModel):
    workout_id: str
    workout_exercise_id: str
    exercise_id: str
    set_index: int
    weight: float = 0.0
    reps: int = 0
    rir: int = 0
    seconds: Optional[int] = None  # for time-based exercises (e.g. plank)
    is_unilateral: bool = False
    set_type: str = "normal"  # normal, warmup, dropset, myo, cluster
    parent_set_id: Optional[str] = None  # for dropsets/myo-reps that follow a primary set
    completed: bool = True


class BodyMeasurementPayload(BaseModel):
    weight_kg: Optional[float] = None
    body_fat_pct: Optional[float] = None
    chest_cm: Optional[float] = None
    waist_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    thigh_cm: Optional[float] = None
    notes: Optional[str] = None


class ProgramCreatePayload(BaseModel):
    split_id: str
    weeks: int = 4


# ============ Auth ============
async def get_current_user(request: Request, authorization: Optional[str] = Header(None), session_token: Optional[str] = Cookie(None)) -> Dict:
    token = session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = sess.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@api.post("/auth/session")
async def create_session(payload: Dict[str, Any], response: Response):
    """Process Emergent session_id, fetch user data, set cookie."""
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    async with httpx.AsyncClient(timeout=15) as cli:
        r = await cli.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data["email"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": data["name"], "picture": data.get("picture")}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data["name"],
            "picture": data.get("picture"),
            "onboarded": False,
            "units": "kg",
            "theme": "dark",
            "equipment": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        # seed default volume landmarks
        await db.volume_landmarks.insert_one({
            "user_id": user_id,
            "landmarks": DEFAULT_LANDMARKS,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })
    response.set_cookie(
        "session_token", session_token,
        httponly=True, secure=True, samesite="none",
        path="/", max_age=7 * 24 * 3600,
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user}


@api.get("/auth/me")
async def me(user: Dict = Depends(get_current_user)):
    return user


@api.post("/auth/logout")
async def logout(response: Response, session_token: Optional[str] = Cookie(None)):
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ============ Profile / Onboarding ============
@api.put("/profile/onboarding")
async def complete_onboarding(payload: OnboardingPayload, user: Dict = Depends(get_current_user)):
    update = payload.model_dump()
    update["onboarded"] = True
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})


@api.put("/profile")
async def update_profile(payload: Dict[str, Any], user: Dict = Depends(get_current_user)):
    allowed = {k: v for k, v in payload.items() if k in {"name", "units", "theme", "weight_kg", "goal", "days_per_week", "equipment"}}
    if allowed:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": allowed})
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})


# ============ Exercises ============
@api.get("/exercises")
async def list_exercises(category: Optional[str] = None, equipment: Optional[str] = None, search: Optional[str] = None, user: Dict = Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if category:
        q["category"] = category
    if equipment:
        q["equipment"] = equipment
    if search:
        q["name"] = {"$regex": search, "$options": "i"}
    items = await db.exercises.find(q, {"_id": 0}).to_list(500)
    return items


@api.get("/exercises/{exercise_id}")
async def get_exercise(exercise_id: str, user: Dict = Depends(get_current_user)):
    ex = await db.exercises.find_one({"id": exercise_id}, {"_id": 0})
    if not ex:
        raise HTTPException(404, "Not found")
    history = await db.sets.find({"user_id": user["user_id"], "exercise_id": exercise_id, "completed": True}, {"_id": 0}).sort("performed_at", -1).limit(50).to_list(50)
    pr = await db.prs.find_one({"user_id": user["user_id"], "exercise_id": exercise_id}, {"_id": 0})
    return {"exercise": ex, "history": history, "pr": pr}


@api.get("/muscle-groups")
async def get_muscle_groups(user: Dict = Depends(get_current_user)):
    return MUSCLE_GROUPS


# ============ Splits & Programs ============
@api.get("/splits")
async def list_splits(user: Dict = Depends(get_current_user)):
    items = await db.splits.find({"$or": [{"user_id": None}, {"user_id": user["user_id"]}]}, {"_id": 0}).to_list(50)
    return items


@api.post("/programs")
async def create_program(payload: ProgramCreatePayload, user: Dict = Depends(get_current_user)):
    split = await db.splits.find_one({"id": payload.split_id}, {"_id": 0})
    if not split:
        raise HTTPException(404, "Split not found")
    exercises = await db.exercises.find({}, {"_id": 0}).to_list(500)

    program_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # find next Monday
    start = now + timedelta(days=(7 - now.weekday()) % 7)
    start = start.replace(hour=6, minute=0, second=0, microsecond=0)

    program = {
        "id": program_id,
        "user_id": user["user_id"],
        "split_id": split["id"],
        "split_name": split["name"],
        "weeks": payload.weeks,
        "current_week": 0,
        "status": "active",
        "start_date": start.isoformat(),
        "created_at": now.isoformat(),
    }
    await db.programs.insert_one(program)

    workouts = generate_program_workouts(user["user_id"], program_id, split, exercises, start, payload.weeks)
    if workouts:
        await db.workouts.insert_many([{**w} for w in workouts])

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"active_program_id": program_id}})
    program.pop("_id", None)
    return {"program": program, "workouts_count": len(workouts)}


@api.get("/programs/active")
async def get_active_program(user: Dict = Depends(get_current_user)):
    pid = user.get("active_program_id")
    if not pid:
        return {"program": None, "workouts": []}
    program = await db.programs.find_one({"id": pid}, {"_id": 0})
    workouts = await db.workouts.find({"program_id": pid}, {"_id": 0}).sort("scheduled_date", 1).to_list(200)
    return {"program": program, "workouts": workouts}


# ============ Workouts ============
@api.get("/workouts/today")
async def todays_workout(user: Dict = Depends(get_current_user)):
    pid = user.get("active_program_id")
    if not pid:
        return {"workout": None}
    today = datetime.now(timezone.utc).date()
    today_start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    today_end = datetime.combine(today, datetime.max.time(), tzinfo=timezone.utc).isoformat()
    # find workout scheduled today, else next upcoming
    w = await db.workouts.find_one({
        "program_id": pid,
        "scheduled_date": {"$gte": today_start, "$lte": today_end},
        "status": {"$in": ["scheduled", "in_progress"]},
    }, {"_id": 0})
    if not w:
        w = await db.workouts.find_one({
            "program_id": pid,
            "status": "scheduled",
            "scheduled_date": {"$gte": today_start},
        }, {"_id": 0}, sort=[("scheduled_date", 1)])
    return {"workout": w}


@api.get("/workouts/{workout_id}")
async def get_workout(workout_id: str, user: Dict = Depends(get_current_user)):
    w = await db.workouts.find_one({"id": workout_id, "user_id": user["user_id"]}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Not found")
    sets = await db.sets.find({"workout_id": workout_id}, {"_id": 0}).to_list(500)
    return {"workout": w, "sets": sets}


@api.post("/workouts/{workout_id}/start")
async def start_workout(workout_id: str, user: Dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.workouts.update_one({"id": workout_id, "user_id": user["user_id"]}, {"$set": {"status": "in_progress", "started_at": now}})
    return {"ok": True}


@api.get("/workouts/{workout_id}/recommendations")
async def workout_recommendations(workout_id: str, user: Dict = Depends(get_current_user)):
    """Per-exercise weight/reps/rir recommendations for a workout, plus per-exercise readiness."""
    w = await db.workouts.find_one({"id": workout_id, "user_id": user["user_id"]}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Not found")

    # recovery scores
    today = datetime.now(timezone.utc)
    week_ago = today - timedelta(days=4)
    stim = await db.stimulus_events.find({"user_id": user["user_id"], "created_at": {"$gte": week_ago.isoformat()}}, {"_id": 0}).to_list(200)
    recovery = compute_recovery_score(stim)

    recs: Dict[str, Dict] = {}
    readiness: Dict[str, float] = {}
    for we in w.get("exercises", []):
        ex = await db.exercises.find_one({"id": we["exercise_id"]}, {"_id": 0})
        if not ex:
            continue
        history = await db.sets.find(
            {"user_id": user["user_id"], "exercise_id": we["exercise_id"], "completed": True, "set_type": {"$ne": "warmup"}},
            {"_id": 0},
        ).sort("performed_at", -1).limit(30).to_list(30)
        rec = recommend_next_set(ex, history, we.get("rep_range", [8, 12]), user, recovery)
        recs[we["id"]] = rec
        # readiness for this exercise = avg recovery of top-2 subgroups
        primary = list(ex.get("subgroups", {}).keys())[:2]
        readiness[we["id"]] = sum(recovery.get(sg, 1.0) for sg in primary) / max(1, len(primary)) if primary else 1.0

    plateau_exercises = []
    for we in w.get("exercises", []):
        history = await db.sets.find(
            {"user_id": user["user_id"], "exercise_id": we["exercise_id"], "completed": True, "set_type": {"$ne": "warmup"}},
            {"_id": 0},
        ).sort("performed_at", -1).limit(30).to_list(30)
        if detect_plateau_e1rm(history):
            plateau_exercises.append(we["id"])

    return {"recommendations": recs, "readiness": readiness, "plateau_exercise_ids": plateau_exercises}


@api.post("/workouts/{workout_id}/complete")
async def complete_workout(workout_id: str, user: Dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    w = await db.workouts.find_one({"id": workout_id, "user_id": user["user_id"]}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Not found")
    started = w.get("started_at")
    duration = 0
    if started:
        st = datetime.fromisoformat(started.replace("Z", "+00:00"))
        if st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        duration = int((now - st).total_seconds())
    await db.workouts.update_one({"id": workout_id}, {"$set": {"status": "completed", "completed_at": now.isoformat(), "duration_seconds": duration}})

    # Track stimulus events for recovery model
    sets = await db.sets.find({"workout_id": workout_id, "completed": True}, {"_id": 0}).to_list(500)
    exercises_by_id = {e["id"]: e for e in await db.exercises.find({}, {"_id": 0}).to_list(500)}
    contribs: Dict[str, float] = {}
    for s in sets:
        ex = exercises_by_id.get(s["exercise_id"])
        if not ex:
            continue
        for sg, w_val in ex.get("subgroups", {}).items():
            contribs[sg] = contribs.get(sg, 0) + w_val
    if contribs:
        await db.stimulus_events.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "workout_id": workout_id,
            "contributions": contribs,
            "created_at": now.isoformat(),
        })
    return {"ok": True, "duration_seconds": duration}


@api.post("/sets")
async def log_set(payload: SetLogPayload, user: Dict = Depends(get_current_user)):
    set_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    e1rm = compute_one_rep_max(payload.weight, payload.reps, payload.rir)
    doc = {
        "id": set_id,
        "user_id": user["user_id"],
        **payload.model_dump(),
        "e1rm": e1rm,
        "performed_at": now,
    }
    await db.sets.insert_one(doc)

    # Update PR if applicable
    existing_pr = await db.prs.find_one({"user_id": user["user_id"], "exercise_id": payload.exercise_id}, {"_id": 0})
    if not existing_pr or e1rm > existing_pr.get("e1rm", 0):
        ex = await db.exercises.find_one({"id": payload.exercise_id}, {"_id": 0})
        pr = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "exercise_id": payload.exercise_id,
            "exercise_name": ex["name"] if ex else "Exercise",
            "weight": payload.weight,
            "reps": payload.reps,
            "rir": payload.rir,
            "e1rm": e1rm,
            "set_id": set_id,
            "created_at": now,
        }
        if existing_pr:
            await db.prs.update_one({"user_id": user["user_id"], "exercise_id": payload.exercise_id}, {"$set": pr})
        else:
            await db.prs.insert_one(pr)
    doc.pop("_id", None)
    return doc


@api.delete("/sets/{set_id}")
async def delete_set(set_id: str, user: Dict = Depends(get_current_user)):
    await db.sets.delete_one({"id": set_id, "user_id": user["user_id"]})
    return {"ok": True}


@api.put("/sets/{set_id}")
async def update_set(set_id: str, payload: Dict[str, Any], user: Dict = Depends(get_current_user)):
    allowed = {k: v for k, v in payload.items() if k in {"weight", "reps", "rir", "set_type", "completed"}}
    if "weight" in allowed and "reps" in allowed:
        allowed["e1rm"] = compute_one_rep_max(allowed["weight"], allowed["reps"], allowed.get("rir", 0))
    await db.sets.update_one({"id": set_id, "user_id": user["user_id"]}, {"$set": allowed})
    return await db.sets.find_one({"id": set_id}, {"_id": 0})


# ============ Body Measurements ============
@api.post("/body")
async def log_measurement(payload: BodyMeasurementPayload, user: Dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        **payload.model_dump(exclude_none=True),
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.body_measurements.insert_one(doc)
    if payload.weight_kg:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"weight_kg": payload.weight_kg}})
    doc.pop("_id", None)
    return doc


@api.get("/body")
async def list_measurements(user: Dict = Depends(get_current_user)):
    items = await db.body_measurements.find({"user_id": user["user_id"]}, {"_id": 0}).sort("recorded_at", -1).to_list(500)
    return items


# ============ Progress ============
@api.get("/progress/overview")
async def progress_overview(user: Dict = Depends(get_current_user)):
    sets = await db.sets.find({"user_id": user["user_id"], "completed": True}, {"_id": 0}).to_list(5000)
    exercises = await db.exercises.find({}, {"_id": 0}).to_list(500)
    exs_by_id = {e["id"]: e for e in exercises}

    # Weekly volume aggregates (last 8 weeks)
    weeks_data = []
    today = datetime.now(timezone.utc)
    for i in range(8):
        week_start = (today - timedelta(days=today.weekday() + 7 * i)).replace(hour=0, minute=0, second=0, microsecond=0)
        vol = compute_weekly_volume(sets, exs_by_id, week_start)
        weeks_data.append({
            "week_start": week_start.isoformat(),
            "total_sets": sum(vol.values()),
            "by_subgroup": vol,
        })
    weeks_data.reverse()

    prs = await db.prs.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    body = await db.body_measurements.find({"user_id": user["user_id"]}, {"_id": 0}).sort("recorded_at", 1).to_list(200)
    completed_workouts = await db.workouts.count_documents({"user_id": user["user_id"], "status": "completed"})
    return {
        "weekly_volume": weeks_data,
        "recent_prs": prs,
        "body_history": body,
        "completed_workouts": completed_workouts,
        "total_sets": len(sets),
    }


@api.get("/progress/exercise/{exercise_id}")
async def exercise_progress(exercise_id: str, user: Dict = Depends(get_current_user)):
    sets = await db.sets.find({"user_id": user["user_id"], "exercise_id": exercise_id, "completed": True}, {"_id": 0}).sort("performed_at", 1).to_list(500)
    return {"sets": sets}


# ============ Insights ============
@api.get("/insights")
async def get_insights(user: Dict = Depends(get_current_user)):
    sets = await db.sets.find({"user_id": user["user_id"], "completed": True}, {"_id": 0}).to_list(5000)
    exercises = await db.exercises.find({}, {"_id": 0}).to_list(500)
    exs_by_id = {e["id"]: e for e in exercises}
    today = datetime.now(timezone.utc)
    week_start = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    prev_week_start = week_start - timedelta(days=7)
    vol = compute_weekly_volume(sets, exs_by_id, week_start)
    prev_vol = compute_weekly_volume(sets, exs_by_id, prev_week_start)

    landmarks_doc = await db.volume_landmarks.find_one({"user_id": user["user_id"]}, {"_id": 0})
    landmarks = (landmarks_doc or {}).get("landmarks", DEFAULT_LANDMARKS)

    workouts = await db.workouts.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(200)
    prs = await db.prs.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)

    streak = compute_streak_days(workouts)
    insights = generate_deterministic_insights(user["user_id"], vol, landmarks, workouts, prs, streak_days=streak)

    week_ago = today - timedelta(days=4)
    stim = await db.stimulus_events.find({"user_id": user["user_id"], "created_at": {"$gte": week_ago.isoformat()}}, {"_id": 0}).to_list(200)
    recovery = compute_recovery_score(stim)

    weak = find_weak_subgroups(vol, landmarks)
    movers = compute_top_movers(vol, prev_vol)

    digest = await db.weekly_digests.find_one({"user_id": user["user_id"]}, {"_id": 0}, sort=[("created_at", -1)])

    return {
        "insights": insights, "weekly_volume": vol, "previous_weekly_volume": prev_vol,
        "landmarks": landmarks, "recovery": recovery, "digest": digest,
        "streak_days": streak, "weak_subgroups": weak, "top_movers": movers,
    }


@api.post("/insights/digest")
async def generate_digest(user: Dict = Depends(get_current_user)):
    sets = await db.sets.find({"user_id": user["user_id"], "completed": True}, {"_id": 0}).to_list(5000)
    exercises = await db.exercises.find({}, {"_id": 0}).to_list(500)
    exs_by_id = {e["id"]: e for e in exercises}
    today = datetime.now(timezone.utc)
    week_start = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    prev_week_start = week_start - timedelta(days=7)
    vol = compute_weekly_volume(sets, exs_by_id, week_start)
    prev_vol = compute_weekly_volume(sets, exs_by_id, prev_week_start)

    landmarks_doc = await db.volume_landmarks.find_one({"user_id": user["user_id"]}, {"_id": 0})
    landmarks = (landmarks_doc or {}).get("landmarks", DEFAULT_LANDMARKS)

    week_ago = today - timedelta(days=7)
    week_workouts = await db.workouts.find({
        "user_id": user["user_id"],
        "scheduled_date": {"$gte": week_ago.isoformat()},
    }, {"_id": 0}).to_list(50)
    completed = sum(1 for w in week_workouts if w.get("status") == "completed")
    compliance = completed / max(1, len(week_workouts))

    week_prs_q = await db.prs.find({"user_id": user["user_id"], "created_at": {"$gte": week_ago.isoformat()}}, {"_id": 0}).to_list(20)
    all_workouts = await db.workouts.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(200)
    streak = compute_streak_days(all_workouts)
    weak = find_weak_subgroups(vol, landmarks)
    movers = compute_top_movers(vol, prev_vol)

    result = await generate_llm_weekly_digest(user["name"], vol, prev_vol, week_prs_q, compliance, completed, streak, weak, movers)
    digest = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "text": result["text"],
        "source": result.get("source", "fallback"),
        "data_snapshot": {
            "weekly_volume": vol, "previous_weekly_volume": prev_vol,
            "completed_workouts": completed, "compliance": compliance,
            "streak_days": streak, "prs": week_prs_q[:5],
            "weak_subgroups": weak[:3], "top_movers": movers[:3],
        },
        "week_start": week_start.isoformat(),
        "completed_workouts": completed,
        "compliance": compliance,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.weekly_digests.insert_one(digest)
    digest.pop("_id", None)
    return digest


# ============ Bootstrap / seed ============
@app.on_event("startup")
async def startup():
    # Seed exercises if empty
    if await db.exercises.count_documents({}) == 0:
        docs = []
        for e in EXERCISES:
            docs.append({
                "id": str(uuid.uuid4()),
                **e,
            })
        await db.exercises.insert_many(docs)
        log.info(f"Seeded {len(docs)} exercises")

    if await db.splits.count_documents({}) == 0:
        sdocs = []
        for s in SYSTEM_SPLITS:
            sdocs.append({"id": str(uuid.uuid4()), "user_id": None, **s})
        await db.splits.insert_many(sdocs)
        log.info(f"Seeded {len(sdocs)} splits")


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api.get("/")
async def health():
    return {"status": "ok", "service": "gymtrack"}


# CORS - allow credentials for cookie-based auth.
# When CORS_ORIGINS="*", we use allow_origin_regex to support credentials (browsers reject "*" + credentials).
_origins_env = os.environ.get("CORS_ORIGINS", "*")
if _origins_env.strip() == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origin_regex=".*",
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=_origins_env.split(","),
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api)


@api.post("/programs/redistribute")
async def redistribute_workouts(user: Dict = Depends(get_current_user)):
    """Push past-date scheduled workouts forward to the next available days, preserving order."""
    pid = user.get("active_program_id")
    if not pid:
        raise HTTPException(404, "No active program")
    today = datetime.now(timezone.utc)
    today_start = today.replace(hour=0, minute=0, second=0, microsecond=0)
    # find missed (scheduled, past)
    missed = await db.workouts.find({
        "program_id": pid,
        "user_id": user["user_id"],
        "status": "scheduled",
        "scheduled_date": {"$lt": today_start.isoformat()},
    }, {"_id": 0}).sort("scheduled_date", 1).to_list(100)
    if not missed:
        return {"redistributed": 0}

    # Find the latest scheduled date in this program to push from
    latest = await db.workouts.find_one({
        "program_id": pid, "user_id": user["user_id"], "status": "scheduled",
    }, {"_id": 0}, sort=[("scheduled_date", -1)])
    base = today_start
    if latest:
        latest_date = datetime.fromisoformat(latest["scheduled_date"].replace("Z", "+00:00"))
        if latest_date.tzinfo is None:
            latest_date = latest_date.replace(tzinfo=timezone.utc)
        if latest_date >= today_start:
            base = latest_date + timedelta(days=1)

    for i, w in enumerate(missed):
        new_date = (base + timedelta(days=i)).replace(hour=6, minute=0, second=0, microsecond=0)
        await db.workouts.update_one(
            {"id": w["id"]},
            {"$set": {"scheduled_date": new_date.isoformat(), "rescheduled": True}},
        )
    return {"redistributed": len(missed)}


@api.get("/programs/mesocycle")
async def mesocycle_view(user: Dict = Depends(get_current_user)):
    """Per-week summary of the active program: target sets, completion %, deload flag."""
    pid = user.get("active_program_id")
    if not pid:
        return {"weeks": []}
    program = await db.programs.find_one({"id": pid}, {"_id": 0})
    workouts = await db.workouts.find({"program_id": pid, "user_id": user["user_id"]}, {"_id": 0}).sort("scheduled_date", 1).to_list(200)

    by_week: Dict[int, List[Dict]] = {}
    for w in workouts:
        by_week.setdefault(w.get("week_index", 0), []).append(w)

    weeks = []
    today = datetime.now(timezone.utc)
    for wi in sorted(by_week):
        ws = by_week[wi]
        target_sets = sum(sum(e.get("target_sets", 0) for e in w.get("exercises", [])) for w in ws)
        completed_sets = 0
        for w in ws:
            if w.get("status") == "completed":
                sets_q = await db.sets.count_documents({"workout_id": w["id"], "completed": True, "set_type": {"$ne": "warmup"}})
                completed_sets += sets_q
        is_current = any(
            datetime.fromisoformat(w["scheduled_date"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc).date() <= today.date() <= datetime.fromisoformat(ws[-1]["scheduled_date"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc).date()
            for w in ws[:1]
        )
        weeks.append({
            "week_index": wi,
            "is_deload": ws[0].get("is_deload", False) if ws else False,
            "is_current": is_current,
            "target_sets": target_sets,
            "completed_sets": completed_sets,
            "workouts": [{"id": w["id"], "name": w["name"], "scheduled_date": w["scheduled_date"], "status": w["status"]} for w in ws],
        })
    return {"program": program, "weeks": weeks}


@api.post("/programs/next-mesocycle")
async def start_next_mesocycle(user: Dict = Depends(get_current_user), payload: Optional[Dict[str, Any]] = None):
    """Generate a fresh mesocycle using same split, starting next Monday."""
    payload = payload or {}
    pid = user.get("active_program_id")
    if not pid:
        raise HTTPException(404, "No active program")
    current = await db.programs.find_one({"id": pid}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Program not found")
    split = await db.splits.find_one({"id": current["split_id"]}, {"_id": 0})
    exercises = await db.exercises.find({}, {"_id": 0}).to_list(500)

    weeks = int(payload.get("weeks", 4))
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    start = now + timedelta(days=(7 - now.weekday()) % 7)
    if start.date() <= now.date():
        start += timedelta(days=7)
    start = start.replace(hour=6, minute=0, second=0, microsecond=0)

    program = {
        "id": new_id,
        "user_id": user["user_id"],
        "split_id": split["id"],
        "split_name": split["name"],
        "weeks": weeks,
        "current_week": 0,
        "status": "active",
        "start_date": start.isoformat(),
        "created_at": now.isoformat(),
    }
    await db.programs.insert_one(program)
    workouts = generate_program_workouts(user["user_id"], new_id, split, exercises, start, weeks)
    if workouts:
        await db.workouts.insert_many([{**w} for w in workouts])
    # Mark old program as completed
    await db.programs.update_one({"id": pid}, {"$set": {"status": "completed"}})
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"active_program_id": new_id}})
    program.pop("_id", None)
    return {"program": program, "workouts_count": len(workouts)}


# ============ Bootstrap / seed ============
@app.on_event("startup")
async def startup():
    # Seed exercises if empty
    if await db.exercises.count_documents({}) == 0:
        docs = []
        for e in EXERCISES:
            docs.append({
                "id": str(uuid.uuid4()),
                **e,
            })
        await db.exercises.insert_many(docs)
        log.info(f"Seeded {len(docs)} exercises")

    if await db.splits.count_documents({}) == 0:
        sdocs = []
        for s in SYSTEM_SPLITS:
            sdocs.append({"id": str(uuid.uuid4()), "user_id": None, **s})
        await db.splits.insert_many(sdocs)
        log.info(f"Seeded {len(sdocs)} splits")


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api.get("/")
async def health():
    return {"status": "ok", "service": "gymtrack"}


# CORS - allow credentials for cookie-based auth.
# When CORS_ORIGINS="*", we use allow_origin_regex to support credentials (browsers reject "*" + credentials).
_origins_env = os.environ.get("CORS_ORIGINS", "*")
if _origins_env.strip() == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origin_regex=".*",
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=_origins_env.split(","),
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api)
