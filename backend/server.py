"""Gym Progress Tracker - FastAPI backend with Supabase + Groq."""
import asyncio
import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, File, UploadFile
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from supabase import create_client, Client
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
    detect_plateau_e1rm,
    compute_streak_days,
    find_weak_subgroups,
    compute_top_movers,
    generate_ai_split_structure,
    build_chat_system_prompt,
    call_groq_chat,
    parse_coach_action,
    preview_reschedule_week,
    preview_remove_exercises,
    preview_add_volume,
    resolve_muscle_groups,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_PROJECT_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

app = FastAPI(title="GymTrack API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


# ── DB helpers ──────────────────────────────────────────────────────────────
def _t(table: str):
    return sb.table(table)


async def _run(fn):
    return await asyncio.to_thread(fn)


# ── Models ──────────────────────────────────────────────────────────────────
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
    seconds: Optional[int] = None
    is_unilateral: bool = False
    set_type: str = "normal"
    parent_set_id: Optional[str] = None
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


class AISplitPayload(BaseModel):
    days_per_week: int
    description: str
    goal: str = "hypertrophy"
    experience: str = "intermediate"


class ChatMessage(BaseModel):
    role: str
    content: str

class ChatPayload(BaseModel):
    messages: List[ChatMessage]

class CoachApplyPayload(BaseModel):
    type: str
    payload: Dict[str, Any]


# ── Auth ────────────────────────────────────────────────────────────────────
async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    try:
        resp = await _run(lambda: sb.auth.get_user(token))
        user_id = resp.user.id
    except Exception as e:
        log.error("Auth failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await _run(lambda: _t("profiles").select("*").eq("id", user_id).limit(1).execute())
    if not result.data:
        raise HTTPException(status_code=401, detail="User profile not found")
    user = result.data[0]
    user["user_id"] = user["id"]
    return user


@api.get("/auth/me")
async def me(user: Dict = Depends(get_current_user)):
    return user


@api.post("/auth/logout")
async def logout():
    return {"ok": True}


# ── Profile / Onboarding ────────────────────────────────────────────────────
@api.put("/profile/onboarding")
async def complete_onboarding(payload: OnboardingPayload, user: Dict = Depends(get_current_user)):
    update = {**payload.model_dump(), "onboarded": True}
    uid = user["id"]
    result = await _run(lambda: _t("profiles").update(update).eq("id", uid).execute())
    updated = result.data[0] if result.data else {**user, **update}
    updated["user_id"] = updated["id"]

    existing = await _run(lambda: _t("volume_landmarks").select("id").eq("user_id", uid).limit(1).execute())
    if not existing.data:
        await _run(lambda: _t("volume_landmarks").insert({"user_id": uid, "landmarks": DEFAULT_LANDMARKS}).execute())
    return updated


@api.put("/profile")
async def update_profile(payload: Dict[str, Any], user: Dict = Depends(get_current_user)):
    uid = user["id"]
    allowed = {k: v for k, v in payload.items() if k in {"name", "units", "theme", "weight_kg", "goal", "days_per_week", "equipment"}}
    if allowed:
        await _run(lambda: _t("profiles").update(allowed).eq("id", uid).execute())
    result = await _run(lambda: _t("profiles").select("*").eq("id", uid).limit(1).execute())
    updated = result.data[0] if result.data else user
    updated["user_id"] = updated["id"]
    return updated


# ── Exercises ────────────────────────────────────────────────────────────────
@api.get("/exercises")
async def list_exercises(
    category: Optional[str] = None,
    equipment: Optional[str] = None,
    search: Optional[str] = None,
    user: Dict = Depends(get_current_user),
):
    def _query():
        q = _t("exercises").select("*")
        if category:
            q = q.eq("category", category)
        if equipment:
            q = q.eq("equipment", equipment)
        if search:
            q = q.ilike("name", f"%{search}%")
        return q.limit(500).execute()

    result = await _run(_query)
    return result.data


@api.get("/exercises/{exercise_id}")
async def get_exercise(exercise_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    ex_result = await _run(lambda: _t("exercises").select("*").eq("id", exercise_id).limit(1).execute())
    if not ex_result.data:
        raise HTTPException(404, "Not found")
    history = await _run(
        lambda: _t("workout_sets").select("*").eq("user_id", uid).eq("exercise_id", exercise_id)
        .eq("completed", True).order("performed_at", desc=True).limit(50).execute()
    )
    pr = await _run(
        lambda: _t("personal_records").select("*").eq("user_id", uid).eq("exercise_id", exercise_id).limit(1).execute()
    )
    return {"exercise": ex_result.data[0], "history": history.data, "pr": pr.data[0] if pr.data else None}


@api.get("/muscle-groups")
async def get_muscle_groups(user: Dict = Depends(get_current_user)):
    return MUSCLE_GROUPS


# ── Splits & Programs ────────────────────────────────────────────────────────
@api.get("/splits")
async def list_splits(user: Dict = Depends(get_current_user)):
    result = await _run(lambda: _t("splits").select("*").limit(50).execute())
    return result.data


@api.post("/splits/generate-ai")
async def generate_ai_split(payload: AISplitPayload, user: Dict = Depends(get_current_user)):
    result = await _run(lambda: generate_ai_split_structure(
        days_per_week=payload.days_per_week,
        description=payload.description,
        goal=payload.goal,
        experience=payload.experience,
    ))
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    split_id = str(uuid.uuid4())
    split = {
        "id": split_id,
        "name": result["name"],
        "description": result["description"],
        "frequency_per_week": result["frequency_per_week"],
        "days": result["days"],
    }
    await _run(lambda: _t("splits").insert(split).execute())
    return split


@api.post("/programs")
async def create_program(payload: ProgramCreatePayload, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    split_result = await _run(lambda: _t("splits").select("*").eq("id", payload.split_id).limit(1).execute())
    if not split_result.data:
        raise HTTPException(404, "Split not found")
    split = split_result.data[0]
    exercises_result = await _run(lambda: _t("exercises").select("*").limit(500).execute())

    program_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    start = now + timedelta(days=(7 - now.weekday()) % 7)
    start = start.replace(hour=6, minute=0, second=0, microsecond=0)

    program = {
        "id": program_id,
        "user_id": uid,
        "split_id": split["id"],
        "split_name": split["name"],
        "weeks": payload.weeks,
        "current_week": 0,
        "status": "active",
        "start_date": start.isoformat(),
        "created_at": now.isoformat(),
    }
    await _run(lambda: _t("programs").insert(program).execute())

    workouts = generate_program_workouts(uid, program_id, split, exercises_result.data, start, payload.weeks)
    if workouts:
        await _run(lambda: _t("workouts").insert(workouts).execute())

    await _run(lambda: _t("profiles").update({"active_program_id": program_id}).eq("id", uid).execute())
    return {"program": program, "workouts_count": len(workouts)}


@api.get("/programs/active")
async def get_active_program(user: Dict = Depends(get_current_user)):
    pid = user.get("active_program_id")
    if not pid:
        return {"program": None, "workouts": []}
    program_result = await _run(lambda: _t("programs").select("*").eq("id", pid).limit(1).execute())
    workouts_result = await _run(lambda: _t("workouts").select("*").eq("program_id", pid).order("scheduled_date").limit(200).execute())
    return {
        "program": program_result.data[0] if program_result.data else None,
        "workouts": workouts_result.data,
    }


# ── Workouts ────────────────────────────────────────────────────────────────
@api.get("/workouts/today")
async def todays_workout(user: Dict = Depends(get_current_user)):
    pid = user.get("active_program_id")
    if not pid:
        return {"workout": None}
    today = datetime.now(timezone.utc).date()
    today_start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    today_end = datetime.combine(today, datetime.max.time(), tzinfo=timezone.utc).isoformat()

    result = await _run(
        lambda: _t("workouts").select("*").eq("program_id", pid)
        .in_("status", ["scheduled", "in_progress"])
        .gte("scheduled_date", today_start).lte("scheduled_date", today_end)
        .limit(1).execute()
    )
    if result.data:
        return {"workout": result.data[0]}

    result = await _run(
        lambda: _t("workouts").select("*").eq("program_id", pid)
        .eq("status", "scheduled").gte("scheduled_date", today_start)
        .order("scheduled_date").limit(1).execute()
    )
    return {"workout": result.data[0] if result.data else None}


@api.get("/workouts/{workout_id}")
async def get_workout(workout_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    w_result = await _run(lambda: _t("workouts").select("*").eq("id", workout_id).eq("user_id", uid).limit(1).execute())
    if not w_result.data:
        raise HTTPException(404, "Not found")
    sets_result = await _run(lambda: _t("workout_sets").select("*").eq("workout_id", workout_id).limit(500).execute())
    return {"workout": w_result.data[0], "sets": sets_result.data}


@api.post("/workouts/{workout_id}/start")
async def start_workout(workout_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    now = datetime.now(timezone.utc).isoformat()
    await _run(lambda: _t("workouts").update({"status": "in_progress", "started_at": now}).eq("id", workout_id).eq("user_id", uid).execute())
    return {"ok": True}


@api.get("/workouts/{workout_id}/recommendations")
async def workout_recommendations(workout_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    w_result = await _run(lambda: _t("workouts").select("*").eq("id", workout_id).eq("user_id", uid).limit(1).execute())
    if not w_result.data:
        raise HTTPException(404, "Not found")
    w = w_result.data[0]

    week_ago = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    stim_result = await _run(lambda: _t("stimulus_events").select("*").eq("user_id", uid).gte("created_at", week_ago).limit(200).execute())
    recovery = compute_recovery_score(stim_result.data)

    recs: Dict[str, Dict] = {}
    readiness: Dict[str, float] = {}
    plateau_exercises = []

    for we in w.get("exercises", []):
        ex_id = we["exercise_id"]
        ex_result = await _run(lambda eid=ex_id: _t("exercises").select("*").eq("id", eid).limit(1).execute())
        if not ex_result.data:
            continue
        ex = ex_result.data[0]
        history = await _run(
            lambda eid=ex_id: _t("workout_sets").select("*").eq("user_id", uid).eq("exercise_id", eid)
            .eq("completed", True).neq("set_type", "warmup").order("performed_at", desc=True).limit(30).execute()
        )
        rec = recommend_next_set(ex, history.data, we.get("rep_range", [8, 12]), user, recovery)
        recs[we["id"]] = rec
        primary = list(ex.get("subgroups", {}).keys())[:2]
        readiness[we["id"]] = sum(recovery.get(sg, 1.0) for sg in primary) / max(1, len(primary)) if primary else 1.0
        if detect_plateau_e1rm(history.data):
            plateau_exercises.append(we["id"])

    return {"recommendations": recs, "readiness": readiness, "plateau_exercise_ids": plateau_exercises}


@api.post("/workouts/{workout_id}/complete")
async def complete_workout(workout_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    now = datetime.now(timezone.utc)
    w_result = await _run(lambda: _t("workouts").select("*").eq("id", workout_id).eq("user_id", uid).limit(1).execute())
    if not w_result.data:
        raise HTTPException(404, "Not found")
    w = w_result.data[0]

    started = w.get("started_at")
    duration = 0
    if started:
        st = datetime.fromisoformat(started.replace("Z", "+00:00"))
        if st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        duration = int((now - st).total_seconds())

    await _run(lambda: _t("workouts").update({
        "status": "completed", "completed_at": now.isoformat(), "duration_seconds": duration
    }).eq("id", workout_id).execute())

    sets_result = await _run(lambda: _t("workout_sets").select("*").eq("workout_id", workout_id).eq("completed", True).limit(500).execute())
    exercises_result = await _run(lambda: _t("exercises").select("*").limit(500).execute())
    exercises_by_id = {e["id"]: e for e in exercises_result.data}

    contribs: Dict[str, float] = {}
    for s in sets_result.data:
        ex = exercises_by_id.get(s.get("exercise_id"))
        if not ex:
            continue
        for sg, w_val in ex.get("subgroups", {}).items():
            contribs[sg] = contribs.get(sg, 0) + w_val

    if contribs:
        event = {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "workout_id": workout_id,
            "contributions": contribs,
            "created_at": now.isoformat(),
        }
        await _run(lambda: _t("stimulus_events").insert(event).execute())

    return {"ok": True, "duration_seconds": duration}


# ── Sets ─────────────────────────────────────────────────────────────────────
@api.post("/sets")
async def log_set(payload: SetLogPayload, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    set_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    e1rm = compute_one_rep_max(payload.weight, payload.reps, payload.rir)
    doc = {"id": set_id, "user_id": uid, **payload.model_dump(), "e1rm": e1rm, "performed_at": now}
    await _run(lambda: _t("workout_sets").insert(doc).execute())

    ex_id = payload.exercise_id
    pr_result = await _run(lambda: _t("personal_records").select("*").eq("user_id", uid).eq("exercise_id", ex_id).limit(1).execute())
    existing_pr = pr_result.data[0] if pr_result.data else None
    if not existing_pr or e1rm > existing_pr.get("e1rm", 0):
        ex_result = await _run(lambda: _t("exercises").select("name").eq("id", ex_id).limit(1).execute())
        ex_name = ex_result.data[0]["name"] if ex_result.data else "Exercise"
        pr = {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "exercise_id": ex_id,
            "exercise_name": ex_name,
            "weight": payload.weight,
            "reps": payload.reps,
            "rir": payload.rir,
            "e1rm": e1rm,
            "set_id": set_id,
            "created_at": now,
        }
        if existing_pr:
            await _run(lambda: _t("personal_records").update(pr).eq("user_id", uid).eq("exercise_id", ex_id).execute())
        else:
            await _run(lambda: _t("personal_records").insert(pr).execute())
    return doc


@api.delete("/sets/{set_id}")
async def delete_set(set_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    sid = set_id
    await _run(lambda: _t("workout_sets").delete().eq("id", sid).eq("user_id", uid).execute())
    return {"ok": True}


@api.put("/sets/{set_id}")
async def update_set(set_id: str, payload: Dict[str, Any], user: Dict = Depends(get_current_user)):
    uid = user["id"]
    sid = set_id
    allowed = {k: v for k, v in payload.items() if k in {"weight", "reps", "rir", "set_type", "completed"}}
    if "weight" in allowed and "reps" in allowed:
        allowed["e1rm"] = compute_one_rep_max(allowed["weight"], allowed["reps"], allowed.get("rir", 0))
    await _run(lambda: _t("workout_sets").update(allowed).eq("id", sid).eq("user_id", uid).execute())
    result = await _run(lambda: _t("workout_sets").select("*").eq("id", sid).limit(1).execute())
    return result.data[0] if result.data else {}


# ── Body Measurements ────────────────────────────────────────────────────────
@api.post("/body")
async def log_measurement(payload: BodyMeasurementPayload, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    doc = {"id": str(uuid.uuid4()), "user_id": uid, **payload.model_dump(exclude_none=True), "recorded_at": datetime.now(timezone.utc).isoformat()}
    await _run(lambda: _t("body_measurements").insert(doc).execute())
    if payload.weight_kg:
        wkg = payload.weight_kg
        await _run(lambda: _t("profiles").update({"weight_kg": wkg}).eq("id", uid).execute())
    return doc


@api.get("/body")
async def list_measurements(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    result = await _run(lambda: _t("body_measurements").select("*").eq("user_id", uid).order("recorded_at", desc=True).limit(500).execute())
    return result.data


# ── Progress Photos ──────────────────────────────────────────────────────────
@api.post("/progress-photos")
async def upload_progress_photo(file: UploadFile = File(...), user: Dict = Depends(get_current_user)):
    uid = user["id"]
    content = await file.read()
    ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    if ext not in {"jpg", "jpeg", "png", "heic", "webp"}:
        ext = "jpg"
    filename = f"{uid}/{uuid.uuid4()}.{ext}"
    try:
        sb.storage.from_("progress-photos").upload(filename, content, {"content-type": file.content_type or "image/jpeg"})
        public_url = sb.storage.from_("progress-photos").get_public_url(filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
    now = datetime.now(timezone.utc).isoformat()
    photo_id = str(uuid.uuid4())
    await _run(lambda: _t("progress_photos").insert({
        "id": photo_id, "user_id": uid, "url": public_url, "filename": filename, "created_at": now,
    }).execute())
    return {"id": photo_id, "url": public_url, "created_at": now}


@api.get("/progress-photos")
async def list_progress_photos(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    result = await _run(lambda: _t("progress_photos").select("*").eq("user_id", uid).order("created_at", desc=True).limit(200).execute())
    return result.data


@api.delete("/progress-photos/{photo_id}")
async def delete_progress_photo(photo_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    result = await _run(lambda: _t("progress_photos").select("*").eq("id", photo_id).eq("user_id", uid).limit(1).execute())
    if not result.data:
        raise HTTPException(status_code=404, detail="Photo not found")
    filename = result.data[0]["filename"]
    try:
        sb.storage.from_("progress-photos").remove([filename])
    except Exception:
        pass
    await _run(lambda: _t("progress_photos").delete().eq("id", photo_id).eq("user_id", uid).execute())
    return {"ok": True}


# ── Progress ─────────────────────────────────────────────────────────────────
@api.get("/progress/overview")
async def progress_overview(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    sets_result = await _run(lambda: _t("workout_sets").select("*").eq("user_id", uid).eq("completed", True).limit(5000).execute())
    exercises_result = await _run(lambda: _t("exercises").select("*").limit(500).execute())
    exs_by_id = {e["id"]: e for e in exercises_result.data}

    today = datetime.now(timezone.utc)
    weeks_data = []
    for i in range(8):
        week_start = (today - timedelta(days=today.weekday() + 7 * i)).replace(hour=0, minute=0, second=0, microsecond=0)
        vol = compute_weekly_volume(sets_result.data, exs_by_id, week_start)
        weeks_data.append({"week_start": week_start.isoformat(), "total_sets": sum(vol.values()), "by_subgroup": vol})
    weeks_data.reverse()

    prs_result = await _run(lambda: _t("personal_records").select("*").eq("user_id", uid).order("created_at", desc=True).limit(20).execute())
    body_result = await _run(lambda: _t("body_measurements").select("*").eq("user_id", uid).order("recorded_at").limit(200).execute())
    completed_result = await _run(lambda: _t("workouts").select("id", count="exact").eq("user_id", uid).eq("status", "completed").execute())

    return {
        "weekly_volume": weeks_data,
        "recent_prs": prs_result.data,
        "body_history": body_result.data,
        "completed_workouts": completed_result.count or 0,
        "total_sets": len(sets_result.data),
    }


@api.get("/progress/exercise/{exercise_id}")
async def exercise_progress(exercise_id: str, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    ex_id = exercise_id
    result = await _run(
        lambda: _t("workout_sets").select("*").eq("user_id", uid).eq("exercise_id", ex_id)
        .eq("completed", True).order("performed_at").limit(500).execute()
    )
    return {"sets": result.data}


# ── Insights ─────────────────────────────────────────────────────────────────
@api.get("/insights")
async def get_insights(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    sets_result = await _run(lambda: _t("workout_sets").select("*").eq("user_id", uid).eq("completed", True).limit(5000).execute())
    exercises_result = await _run(lambda: _t("exercises").select("*").limit(500).execute())
    exs_by_id = {e["id"]: e for e in exercises_result.data}

    today = datetime.now(timezone.utc)
    week_start = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    prev_week_start = week_start - timedelta(days=7)
    vol = compute_weekly_volume(sets_result.data, exs_by_id, week_start)
    prev_vol = compute_weekly_volume(sets_result.data, exs_by_id, prev_week_start)

    lm_result = await _run(lambda: _t("volume_landmarks").select("*").eq("user_id", uid).limit(1).execute())
    landmarks = lm_result.data[0].get("landmarks", DEFAULT_LANDMARKS) if lm_result.data else DEFAULT_LANDMARKS

    workouts_result = await _run(lambda: _t("workouts").select("*").eq("user_id", uid).limit(200).execute())
    prs_result = await _run(lambda: _t("personal_records").select("*").eq("user_id", uid).order("created_at", desc=True).limit(10).execute())

    streak = compute_streak_days(workouts_result.data)
    insights = generate_deterministic_insights(uid, vol, landmarks, workouts_result.data, prs_result.data, streak_days=streak)

    week_ago = (today - timedelta(days=4)).isoformat()
    stim_result = await _run(lambda: _t("stimulus_events").select("*").eq("user_id", uid).gte("created_at", week_ago).limit(200).execute())
    recovery = compute_recovery_score(stim_result.data)

    weak = find_weak_subgroups(vol, landmarks)
    movers = compute_top_movers(vol, prev_vol)
    digest_result = await _run(lambda: _t("weekly_digests").select("*").eq("user_id", uid).order("created_at", desc=True).limit(1).execute())

    return {
        "insights": insights, "weekly_volume": vol, "previous_weekly_volume": prev_vol,
        "landmarks": landmarks, "recovery": recovery,
        "digest": digest_result.data[0] if digest_result.data else None,
        "streak_days": streak, "weak_subgroups": weak, "top_movers": movers,
    }


@api.post("/insights/digest")
async def generate_digest(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    sets_result = await _run(lambda: _t("workout_sets").select("*").eq("user_id", uid).eq("completed", True).limit(5000).execute())
    exercises_result = await _run(lambda: _t("exercises").select("*").limit(500).execute())
    exs_by_id = {e["id"]: e for e in exercises_result.data}

    today = datetime.now(timezone.utc)
    week_start = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    prev_week_start = week_start - timedelta(days=7)
    vol = compute_weekly_volume(sets_result.data, exs_by_id, week_start)
    prev_vol = compute_weekly_volume(sets_result.data, exs_by_id, prev_week_start)

    lm_result = await _run(lambda: _t("volume_landmarks").select("*").eq("user_id", uid).limit(1).execute())
    landmarks = lm_result.data[0].get("landmarks", DEFAULT_LANDMARKS) if lm_result.data else DEFAULT_LANDMARKS

    week_ago = (today - timedelta(days=7)).isoformat()
    week_workouts = await _run(lambda: _t("workouts").select("*").eq("user_id", uid).gte("scheduled_date", week_ago).limit(50).execute())
    completed = sum(1 for w in week_workouts.data if w.get("status") == "completed")
    compliance = completed / max(1, len(week_workouts.data))

    week_prs = await _run(lambda: _t("personal_records").select("*").eq("user_id", uid).gte("created_at", week_ago).limit(20).execute())
    all_workouts = await _run(lambda: _t("workouts").select("*").eq("user_id", uid).limit(200).execute())
    streak = compute_streak_days(all_workouts.data)
    weak = find_weak_subgroups(vol, landmarks)
    movers = compute_top_movers(vol, prev_vol)

    result = await generate_llm_weekly_digest(user.get("name", "Athlete"), vol, prev_vol, week_prs.data, compliance, completed, streak, weak, movers)
    now = datetime.now(timezone.utc).isoformat()
    digest = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "text": result["text"],
        "source": result.get("source", "fallback"),
        "data_snapshot": {
            "weekly_volume": vol, "previous_weekly_volume": prev_vol,
            "completed_workouts": completed, "compliance": compliance,
            "streak_days": streak, "prs": week_prs.data[:5],
            "weak_subgroups": weak[:3], "top_movers": movers[:3],
        },
        "week_start": week_start.isoformat(),
        "completed_workouts": completed,
        "compliance": compliance,
        "created_at": now,
    }
    await _run(lambda: _t("weekly_digests").insert(digest).execute())
    return digest


# ── Program management ────────────────────────────────────────────────────────
@api.post("/programs/redistribute")
async def redistribute_workouts(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    pid = user.get("active_program_id")
    if not pid:
        raise HTTPException(404, "No active program")
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    missed_result = await _run(
        lambda: _t("workouts").select("*").eq("program_id", pid).eq("user_id", uid)
        .eq("status", "scheduled").lt("scheduled_date", today_start)
        .order("scheduled_date").limit(100).execute()
    )
    missed = missed_result.data
    if not missed:
        return {"redistributed": 0}

    latest_result = await _run(
        lambda: _t("workouts").select("*").eq("program_id", pid).eq("user_id", uid)
        .eq("status", "scheduled").order("scheduled_date", desc=True).limit(1).execute()
    )
    base = datetime.now(timezone.utc)
    if latest_result.data:
        latest_date = datetime.fromisoformat(latest_result.data[0]["scheduled_date"].replace("Z", "+00:00"))
        if latest_date.tzinfo is None:
            latest_date = latest_date.replace(tzinfo=timezone.utc)
        if latest_date >= base:
            base = latest_date + timedelta(days=1)

    for i, w in enumerate(missed):
        new_date = (base + timedelta(days=i)).replace(hour=6, minute=0, second=0, microsecond=0).isoformat()
        wid = w["id"]
        await _run(lambda wid=wid, nd=new_date: _t("workouts").update({"scheduled_date": nd, "rescheduled": True}).eq("id", wid).execute())

    return {"redistributed": len(missed)}


@api.get("/programs/mesocycle")
async def mesocycle_view(user: Dict = Depends(get_current_user)):
    uid = user["id"]
    pid = user.get("active_program_id")
    if not pid:
        return {"weeks": []}
    program_result = await _run(lambda: _t("programs").select("*").eq("id", pid).limit(1).execute())
    workouts_result = await _run(lambda: _t("workouts").select("*").eq("program_id", pid).eq("user_id", uid).order("scheduled_date").limit(200).execute())
    workouts = workouts_result.data

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
                wid = w["id"]
                sets_result = await _run(lambda wid=wid: _t("workout_sets").select("id", count="exact").eq("workout_id", wid).eq("completed", True).neq("set_type", "warmup").execute())
                completed_sets += sets_result.count or 0
        is_current = any(
            datetime.fromisoformat(w["scheduled_date"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc).date() <= today.date()
            for w in ws[:1]
        ) if ws else False
        weeks.append({
            "week_index": wi,
            "is_deload": ws[0].get("is_deload", False) if ws else False,
            "is_current": is_current,
            "target_sets": target_sets,
            "completed_sets": completed_sets,
            "workouts": [{"id": w["id"], "name": w.get("name"), "scheduled_date": w["scheduled_date"], "status": w["status"]} for w in ws],
        })
    return {"program": program_result.data[0] if program_result.data else None, "weeks": weeks}


@api.post("/programs/next-mesocycle")
async def start_next_mesocycle(user: Dict = Depends(get_current_user), payload: Optional[Dict[str, Any]] = None):
    uid = user["id"]
    payload = payload or {}
    pid = user.get("active_program_id")
    if not pid:
        raise HTTPException(404, "No active program")
    current_result = await _run(lambda: _t("programs").select("*").eq("id", pid).limit(1).execute())
    if not current_result.data:
        raise HTTPException(404, "Program not found")
    current = current_result.data[0]
    split_result = await _run(lambda: _t("splits").select("*").eq("id", current["split_id"]).limit(1).execute())
    exercises_result = await _run(lambda: _t("exercises").select("*").limit(500).execute())

    weeks = int(payload.get("weeks", 4))
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    start = now + timedelta(days=(7 - now.weekday()) % 7)
    if start.date() <= now.date():
        start += timedelta(days=7)
    start = start.replace(hour=6, minute=0, second=0, microsecond=0)

    split = split_result.data[0] if split_result.data else current
    program = {
        "id": new_id, "user_id": uid,
        "split_id": split["id"], "split_name": split.get("name", current.get("split_name")),
        "weeks": weeks, "current_week": 0, "status": "active",
        "start_date": start.isoformat(), "created_at": now.isoformat(),
    }
    await _run(lambda: _t("programs").insert(program).execute())
    workouts = generate_program_workouts(uid, new_id, split, exercises_result.data, start, weeks)
    if workouts:
        await _run(lambda: _t("workouts").insert(workouts).execute())
    await _run(lambda: _t("programs").update({"status": "completed"}).eq("id", pid).execute())
    await _run(lambda: _t("profiles").update({"active_program_id": new_id}).eq("id", uid).execute())
    return {"program": program, "workouts_count": len(workouts)}


# ── Health / CORS ────────────────────────────────────────────────────────────
@api.get("/")
async def health():
    return {"status": "ok", "service": "gymtrack"}


_origins_env = os.environ.get("CORS_ORIGINS", "*")
if _origins_env.strip() == "*":
    app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origin_regex=".*", allow_methods=["*"], allow_headers=["*"])
else:
    app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=_origins_env.split(","), allow_methods=["*"], allow_headers=["*"])

app.include_router(api)


# ── AI Chat ──────────────────────────────────────────────────────────────────
@api.post("/chat")
async def chat(payload: ChatPayload, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    pid = user.get("active_program_id")

    now = datetime.now(timezone.utc)
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)

    recent_r, prs_r = await asyncio.gather(
        _run(lambda: _t("workouts").select("name,completed_at").eq("user_id", uid).eq("status", "completed").order("completed_at", desc=True).limit(8).execute()),
        _run(lambda: _t("personal_records").select("*").eq("user_id", uid).order("e1rm", desc=True).limit(10).execute()),
    )

    week_completed: List[Dict] = []
    week_planned: List[Dict] = []
    program = None

    if pid:
        p_r, week_r = await asyncio.gather(
            _run(lambda: _t("programs").select("split_name,current_week,weeks").eq("id", pid).limit(1).execute()),
            _run(lambda: _t("workouts").select("id,name,status,scheduled_date,exercises").eq("user_id", uid).eq("program_id", pid).gte("scheduled_date", week_start.isoformat()).lte("scheduled_date", week_end.isoformat()).order("scheduled_date").execute()),
        )
        program = p_r.data[0] if p_r.data else None
        for w in week_r.data or []:
            if w["status"] == "completed":
                week_completed.append(w)
            elif w["status"] in ("scheduled", "in_progress"):
                week_planned.append(w)

    system_prompt = build_chat_system_prompt(
        user, program, recent_r.data or [], prs_r.data or [],
        week_completed=week_completed, week_planned=week_planned,
    )
    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": m.role, "content": m.content} for m in payload.messages]

    raw_reply = await _run(lambda: call_groq_chat(messages))
    clean_reply, action_intent = parse_coach_action(raw_reply)

    action_preview: Optional[Dict] = None
    if action_intent:
        atype = action_intent.get("type")
        try:
            if atype == "reschedule_week":
                days = int(action_intent.get("days", 3))
                action_preview = {"type": atype, **preview_reschedule_week(week_planned, days)}
            elif atype == "remove_exercises":
                mg = action_intent.get("muscle_groups", [])
                exs_r = await _run(lambda: _t("exercises").select("*").limit(500).execute())
                upcoming = week_planned  # could extend to next week's workouts too
                action_preview = {"type": atype, **preview_remove_exercises(upcoming, mg, exs_r.data or [])}
            elif atype == "add_volume":
                mg = action_intent.get("muscle_groups", [])
                extra = int(action_intent.get("extra_sets", 2))
                exs_r = await _run(lambda: _t("exercises").select("*").limit(500).execute())
                action_preview = {"type": atype, **preview_add_volume(week_planned, mg, extra, exs_r.data or [])}
        except Exception as e:
            log.warning(f"Coach action preview failed: {e}")

    return {"message": clean_reply, "action": action_preview}


@api.post("/coach/apply")
async def apply_coach_action(payload: CoachApplyPayload, user: Dict = Depends(get_current_user)):
    uid = user["id"]
    atype = payload.type
    data = payload.payload

    if atype == "reschedule_week":
        original_ids = data.get("original_ids", [])
        new_workouts = data.get("new_workouts", [])
        if not new_workouts:
            raise HTTPException(400, "No new workouts provided")

        # Delete original planned workouts
        if original_ids:
            await _run(lambda: _t("workouts").delete().in_("id", original_ids).eq("user_id", uid).execute())

        # Insert merged workouts (assign new IDs)
        to_insert = []
        for w in new_workouts:
            new_w = {k: v for k, v in w.items() if not k.startswith("_")}
            new_w["id"] = str(uuid.uuid4())
            new_w["user_id"] = uid
            new_w["status"] = "scheduled"
            to_insert.append(new_w)
        await _run(lambda: _t("workouts").insert(to_insert).execute())
        return {"ok": True, "message": f"Rescheduled {len(to_insert)} session(s) for this week."}

    elif atype == "remove_exercises":
        removals = data.get("removals", [])
        if not removals:
            return {"ok": True, "message": "Nothing to remove."}

        # Group by workout_id
        by_workout: Dict[str, List[str]] = {}
        for r in removals:
            by_workout.setdefault(r["workout_id"], []).append(r["exercise_id"])

        for wid, ex_ids_to_remove in by_workout.items():
            w_r = await _run(lambda wid=wid: _t("workouts").select("exercises").eq("id", wid).eq("user_id", uid).limit(1).execute())
            if not w_r.data:
                continue
            current_exercises = w_r.data[0].get("exercises") or []
            filtered = [e for e in current_exercises if e.get("exercise_id") not in ex_ids_to_remove]
            await _run(lambda wid=wid, fe=filtered: _t("workouts").update({"exercises": fe}).eq("id", wid).eq("user_id", uid).execute())

        return {"ok": True, "message": f"Removed {len(removals)} exercise(s) from upcoming workouts."}

    elif atype == "add_volume":
        additions = data.get("additions", [])
        extra_sets = int(data.get("extra_sets", 2))
        if not additions:
            return {"ok": True, "message": "Nothing to update."}

        # Group by workout_id
        by_workout: Dict[str, int] = {a["workout_id"]: extra_sets for a in additions}
        ex_names_by_wid: Dict[str, set] = {}
        for a in additions:
            ex_names_by_wid.setdefault(a["workout_id"], set()).add(a["exercise_name"])

        for wid, names in ex_names_by_wid.items():
            w_r = await _run(lambda wid=wid: _t("workouts").select("exercises").eq("id", wid).eq("user_id", uid).limit(1).execute())
            if not w_r.data:
                continue
            exercises = w_r.data[0].get("exercises") or []
            updated = []
            for ex in exercises:
                if ex.get("exercise_name") in names:
                    ex = dict(ex)
                    ex["target_sets"] = ex.get("target_sets", 3) + extra_sets
                updated.append(ex)
            await _run(lambda wid=wid, ue=updated: _t("workouts").update({"exercises": ue}).eq("id", wid).eq("user_id", uid).execute())

        return {"ok": True, "message": f"Added {extra_sets} set(s) to targeted exercises in upcoming workouts."}

    raise HTTPException(400, f"Unknown action type: {atype}")


# ── Startup seed ─────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    try:
        ex_result = await _run(lambda: _t("exercises").select("id").limit(1).execute())
        if not ex_result.data:
            docs = [
                {
                    "id": str(uuid.uuid4()),
                    "name": e["name"],
                    "category": e["category"],
                    "equipment": e["equipment"],
                    "movement": e["movement"],
                    "primary_muscles": e.get("primary", []),
                    "subgroups": e.get("subgroups", {}),
                    "youtube_id": e.get("youtube_id"),
                }
                for e in EXERCISES
            ]
            await _run(lambda: _t("exercises").insert(docs).execute())
            log.info(f"Seeded {len(docs)} exercises")
    except Exception as e:
        log.warning(f"Exercise seeding skipped: {e}")

    try:
        sp_result = await _run(lambda: _t("splits").select("name").limit(200).execute())
        existing_names = {s["name"] for s in (sp_result.data or [])}
        missing = [s for s in SYSTEM_SPLITS if s["name"] not in existing_names]
        if missing:
            sdocs = [
                {
                    "id": str(uuid.uuid4()),
                    "name": s["name"],
                    "days_per_week": s.get("days_per_week", len(s.get("days", []))),
                    "days": s.get("days", []),
                }
                for s in missing
            ]
            await _run(lambda: _t("splits").insert(sdocs).execute())
            log.info(f"Seeded {len(sdocs)} new splits")
    except Exception as e:
        log.warning(f"Split seeding skipped: {e}")
