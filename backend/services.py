"""Business logic: program generation, deterministic insights, LLM digest."""
import os
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
import uuid
from collections import defaultdict

from seeds import DEFAULT_LANDMARKS, SYSTEM_SPLITS


def _pick_exercise(exercises: List[Dict], category: str, movement: str, subgroup: str = None, used_ids: set = None) -> Dict:
    """Pick best matching exercise. Prefer not-yet-used exercises."""
    used_ids = used_ids or set()
    candidates = [e for e in exercises if e["category"] == category and e["movement"] == movement]
    if subgroup:
        scored = sorted(candidates, key=lambda e: (-(e.get("subgroups", {}).get(subgroup, 0)), e["id"] in used_ids))
    else:
        scored = sorted(candidates, key=lambda e: (e["id"] in used_ids,))
    return scored[0] if scored else (candidates[0] if candidates else None)


def generate_program_workouts(user_id: str, program_id: str, split: Dict, exercises: List[Dict], start_date: datetime, weeks: int = 4) -> List[Dict]:
    """Generate concrete workouts for a mesocycle (default 4 weeks). Returns list of workout dicts ready to insert."""
    workouts = []
    days = split["days"]
    used_global = set()
    for week in range(weeks):
        for day in days:
            workout_date = start_date + timedelta(days=(week * 7) + day["day_index"])
            workout_id = str(uuid.uuid4())
            workout_exercises = []
            for idx, slot in enumerate(day["slots"]):
                ex = _pick_exercise(exercises, slot["category"], slot["movement"], slot.get("subgroup"), used_global)
                if not ex:
                    continue
                used_global.add(ex["id"])
                target_sets = slot["sets"] + (1 if week >= 2 else 0)  # progressive volume
                workout_exercises.append({
                    "id": str(uuid.uuid4()),
                    "exercise_id": ex["id"],
                    "exercise_name": ex["name"],
                    "order_index": idx,
                    "target_sets": target_sets,
                    "rep_range": slot["rep_range"],
                    "rest_seconds": 180 if slot["movement"] in ("squat", "hinge", "push", "pull") else 90,
                    "notes": "",
                })
            workouts.append({
                "id": workout_id,
                "user_id": user_id,
                "program_id": program_id,
                "name": day["name"],
                "scheduled_date": workout_date.isoformat(),
                "week_index": week,
                "day_index": day["day_index"],
                "status": "scheduled",
                "exercises": workout_exercises,
                "started_at": None,
                "completed_at": None,
                "duration_seconds": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    return workouts


def compute_one_rep_max(weight: float, reps: int, rir: int = 0) -> float:
    """Epley formula adjusted for RIR."""
    effective_reps = reps + max(0, rir)
    if effective_reps <= 1:
        return weight
    return round(weight * (1 + effective_reps / 30.0), 2)


# ==================== Sprint 7-8: Recommendation Engine ====================

# Movement-pattern-based bodyweight multipliers for starter weights
_STARTER_MULTIPLIERS = {
    "Barbell Bench Press": 0.7, "Incline Barbell Press": 0.55, "Overhead Press": 0.5,
    "Back Squat": 1.0, "Front Squat": 0.75, "Deadlift": 1.2, "Romanian Deadlift": 0.9,
    "Hip Thrust": 1.0, "Barbell Row": 0.7, "Pendlay Row": 0.7, "T-Bar Row": 0.6,
    "Close Grip Bench Press": 0.55, "Stiff-Leg Deadlift": 0.85,
}


def _round_to_increment(weight: float, equipment: str) -> float:
    """Round to plate-friendly increment."""
    inc = 2.5 if equipment == "barbell" else (1.0 if equipment in ("dumbbell", "cable") else 0.5)
    return round(weight / inc) * inc


def starter_weight(exercise: Dict, user: Dict) -> Dict:
    """Heuristic starter weight when no history exists."""
    bw = float(user.get("weight_kg") or 75)
    exp = user.get("experience") or "intermediate"
    exp_mult = {"beginner": 0.55, "intermediate": 0.85, "advanced": 1.1}.get(exp, 0.85)
    if user.get("sex") == "female":
        exp_mult *= 0.7
    equipment = exercise.get("equipment", "barbell")
    if equipment == "bodyweight":
        return {"weight": 0.0, "reps": 8, "rir": 2, "source": "starter"}
    name = exercise.get("name", "")
    base = _STARTER_MULTIPLIERS.get(name)
    if base is None:
        # default: 35-50% BW for isolation, 60% for compound
        base = 0.35 if exercise.get("movement") == "isolation" else 0.55
    if equipment == "dumbbell":
        base *= 0.4  # per-hand DB weight
    elif equipment == "machine":
        base *= 0.85
    weight = _round_to_increment(bw * base * exp_mult, equipment)
    return {"weight": max(weight, 2.5), "reps": 8, "rir": 2, "source": "starter"}


def detect_plateau_e1rm(history: List[Dict]) -> bool:
    """Plateau if best e1RM of last 3 sessions hasn't improved >0.5% over the prior 3."""
    if len(history) < 6:
        return False
    sorted_h = sorted(history, key=lambda h: h.get("performed_at", ""))
    recent = sorted_h[-3:]
    prior = sorted_h[-6:-3]
    return max(h["e1rm"] for h in recent) <= max(h["e1rm"] for h in prior) * 1.005


def recommend_next_set(exercise: Dict, history: List[Dict], target_rep_range: List[int], user: Dict, recovery_for_subgroups: Dict[str, float]) -> Dict:
    """Suggest weight/reps/rir for the next set.
    Sources: 'starter' | 'last_set' | 'progression' | 'plateau_break' | 'deload_recovery'
    """
    if not history:
        return starter_weight(exercise, user)

    sorted_h = sorted(history, key=lambda h: h.get("performed_at", ""))
    last = sorted_h[-1]
    target_low, target_high = target_rep_range[0], target_rep_range[1]
    weight = float(last.get("weight") or 0)
    reps = int(last.get("reps") or target_low)
    rir = int(last.get("rir") or 2)
    equipment = exercise.get("equipment", "barbell")
    source = "last_set"

    # Progressive overload rules
    if reps >= target_high and rir <= 1:
        weight = _round_to_increment(weight * 1.025, equipment)
        source = "progression"
    elif reps < target_low and rir <= 0:
        weight = _round_to_increment(weight * 0.95, equipment)
        source = "deload_failed"

    # Plateau check overrides progression with rep-range refresh
    if detect_plateau_e1rm(sorted_h):
        weight = _round_to_increment(weight * 0.9, equipment)
        source = "plateau_break"

    # Recovery modulation: weight scales 0.85→1.0 as recovery 0→1 of primary subgroup
    primary_subgroups = list(exercise.get("subgroups", {}).keys())[:2]
    if primary_subgroups and recovery_for_subgroups:
        avg_recovery = sum(recovery_for_subgroups.get(sg, 1.0) for sg in primary_subgroups) / max(1, len(primary_subgroups))
        if avg_recovery < 0.6:
            scale = 0.85 + avg_recovery * 0.15  # ~0.85 at 0, ~0.94 at 0.6
            weight = _round_to_increment(weight * scale, equipment)
            source = "deload_recovery"

    return {
        "weight": max(weight, 0),
        "reps": min(target_high, max(target_low, reps)),
        "rir": 2,
        "source": source,
    }


def compute_weekly_volume(sets: List[Dict], exercises_by_id: Dict[str, Dict], week_start: datetime) -> Dict[str, float]:
    """Compute weekly volume per subgroup using exercise contributions."""
    volume = defaultdict(float)
    week_end = week_start + timedelta(days=7)
    for s in sets:
        if not s.get("completed"):
            continue
        ts_str = s.get("performed_at")
        if not ts_str:
            continue
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")) if isinstance(ts_str, str) else ts_str
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if not (week_start <= ts < week_end):
            continue
        ex = exercises_by_id.get(s.get("exercise_id"))
        if not ex:
            continue
        contrib = ex.get("subgroups", {})
        for subgroup, weight in contrib.items():
            volume[subgroup] += weight  # 1 set * weight contribution
    return dict(volume)


def detect_plateau(history: List[Dict]) -> bool:
    """Plateau if best e1RM in last 3 sessions hasn't improved over previous 3."""
    if len(history) < 6:
        return False
    recent = history[-3:]
    previous = history[-6:-3]
    recent_max = max(h["e1rm"] for h in recent)
    prev_max = max(h["e1rm"] for h in previous)
    return recent_max <= prev_max * 1.005


def generate_deterministic_insights(user_id: str, weekly_volume: Dict[str, float], landmarks: Dict[str, Dict], recent_workouts: List[Dict], prs: List[Dict]) -> List[Dict]:
    """Generate insights based on rules."""
    insights = []
    now = datetime.now(timezone.utc).isoformat()

    # Volume too low/high per subgroup
    for subgroup, sets in weekly_volume.items():
        lm = landmarks.get(subgroup) or DEFAULT_LANDMARKS.get(subgroup, {"mev": 0, "mav": 10, "mrv": 20})
        if sets > 0 and sets < lm["mev"]:
            insights.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "type": "volume_low",
                "severity": "warning",
                "title": f"Low volume: {subgroup.replace('_', ' ').title()}",
                "body": f"You logged {sets:.1f} sets this week. Minimum effective volume is {lm['mev']}. Add 1-2 sets to drive growth.",
                "data": {"subgroup": subgroup, "sets": sets, "mev": lm["mev"], "mav": lm["mav"]},
                "created_at": now,
                "dismissed": False,
            })
        elif sets > lm["mrv"]:
            insights.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "type": "volume_high",
                "severity": "warning",
                "title": f"Volume above MRV: {subgroup.replace('_', ' ').title()}",
                "body": f"You logged {sets:.1f} sets — above your max recoverable volume ({lm['mrv']}). Consider a deload.",
                "data": {"subgroup": subgroup, "sets": sets, "mrv": lm["mrv"]},
                "created_at": now,
                "dismissed": False,
            })

    # PR celebration
    recent_prs = [p for p in prs if (datetime.now(timezone.utc) - datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))).days < 7]
    for pr in recent_prs[:3]:
        insights.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "pr",
            "severity": "success",
            "title": f"New PR: {pr['exercise_name']}",
            "body": f"You hit {pr['weight']}kg × {pr['reps']} — your best e1RM is {pr['e1rm']}kg.",
            "data": pr,
            "created_at": now,
            "dismissed": False,
        })

    # Compliance: workouts completed last 7 days
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    completed_recent = [w for w in recent_workouts if w.get("completed_at") and datetime.fromisoformat(w["completed_at"].replace("Z", "+00:00")) >= week_ago]
    if len(recent_workouts) > 0:
        compliance = len(completed_recent) / max(1, len([w for w in recent_workouts if datetime.fromisoformat(w["scheduled_date"].replace("Z", "+00:00")) >= week_ago and datetime.fromisoformat(w["scheduled_date"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)]))
        if compliance < 0.6 and len(completed_recent) >= 1:
            insights.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "type": "compliance",
                "severity": "info",
                "title": "Adherence dropping",
                "body": f"You completed {len(completed_recent)} of your scheduled workouts in the last week. Consistency drives results — even shorter sessions beat skipping.",
                "data": {"compliance": compliance, "completed": len(completed_recent)},
                "created_at": now,
                "dismissed": False,
            })
    return insights


async def generate_llm_weekly_digest(user_name: str, weekly_volume: Dict[str, float], prs: List[Dict], compliance: float, completed_workouts: int) -> str:
    """Use Claude Sonnet 4.5 to generate friendly weekly digest prose."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            return _fallback_digest(weekly_volume, prs, compliance, completed_workouts)

        # Build data context
        top_volume = sorted(weekly_volume.items(), key=lambda x: -x[1])[:5]
        vol_summary = ", ".join([f"{k.replace('_', ' ')}: {v:.1f} sets" for k, v in top_volume])
        pr_summary = "; ".join([f"{p['exercise_name']} {p['weight']}kg×{p['reps']}" for p in prs[:5]]) or "no new PRs"

        system = (
            "You are a precise, encouraging strength coach. You write SHORT weekly digests (3-4 paragraphs max, ~150 words). "
            "Be specific about the user's data — never invent numbers. Tone: honest, warm, no hype, no exclamation marks. "
            "Acknowledge effort, point out one strong area, one area to watch, end with a forward-looking question or suggestion."
        )
        prompt = (
            f"Athlete name: {user_name}\n"
            f"Workouts completed this week: {completed_workouts}\n"
            f"Adherence rate: {compliance*100:.0f}%\n"
            f"Top volume areas: {vol_summary}\n"
            f"Personal records this week: {pr_summary}\n\n"
            f"Write a weekly training digest based ONLY on the data above. Keep it tight."
        )

        chat = LlmChat(api_key=api_key, session_id=f"digest-{uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", "claude-sonnet-4-5-20250929")
        response = await chat.send_message(UserMessage(text=prompt))
        return response.strip() if isinstance(response, str) else str(response).strip()
    except Exception as e:
        print(f"[digest] LLM failed: {e}")
        return _fallback_digest(weekly_volume, prs, compliance, completed_workouts)


def _fallback_digest(weekly_volume: Dict[str, float], prs: List[Dict], compliance: float, completed: int) -> str:
    top = sorted(weekly_volume.items(), key=lambda x: -x[1])[:3]
    top_str = ", ".join([k.replace("_", " ") for k, _ in top]) if top else "none yet"
    pr_str = f"{len(prs)} new personal record(s)" if prs else "no new PRs this week"
    return (
        f"You completed {completed} session(s) this week with {compliance*100:.0f}% adherence. "
        f"Your highest-volume areas were {top_str}. You hit {pr_str}. "
        "Stay consistent — small sessions beat skipped ones. What is one exercise you want to push next week?"
    )


def compute_recovery_score(stimulus_events: List[Dict]) -> Dict[str, float]:
    """Stimulus-fatigue model: each set adds stimulus that decays with half-life ~48h."""
    now = datetime.now(timezone.utc)
    fatigue = defaultdict(float)
    for ev in stimulus_events:
        ts = datetime.fromisoformat(ev["created_at"].replace("Z", "+00:00")) if isinstance(ev["created_at"], str) else ev["created_at"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        hours_ago = (now - ts).total_seconds() / 3600.0
        decay = 0.5 ** (hours_ago / 48.0)
        for sg, w in ev.get("contributions", {}).items():
            fatigue[sg] += w * decay
    # Recovery = 1 - normalized fatigue (cap at 1)
    recovery = {sg: max(0.0, min(1.0, 1.0 - f / 10.0)) for sg, f in fatigue.items()}
    return recovery
