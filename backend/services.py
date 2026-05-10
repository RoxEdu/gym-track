"""Business logic: program generation, deterministic insights, LLM digest."""
import os
import re
import json
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple
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


def generate_program_workouts(user_id: str, program_id: str, split: Dict, exercises: List[Dict], start_date: datetime, weeks: int = 4, deload_last: bool = True) -> List[Dict]:
    """Generate concrete workouts for a mesocycle (default 4 weeks).
    Volume progression: week 0 = base, week 1 = base, week 2 = +1 set, week 3 = deload (60% sets) if deload_last."""
    workouts = []
    days = split["days"]
    used_global = set()
    for week in range(weeks):
        is_deload = deload_last and week == weeks - 1 and weeks >= 3
        for day in days:
            workout_date = start_date + timedelta(days=(week * 7) + day["day_index"])
            workout_id = str(uuid.uuid4())
            workout_exercises = []
            for idx, slot in enumerate(day["slots"]):
                ex = _pick_exercise(exercises, slot["category"], slot["movement"], slot.get("subgroup"), used_global)
                if not ex:
                    continue
                used_global.add(ex["id"])
                base_sets = slot["sets"] + (1 if week >= 2 and not is_deload else 0)
                target_sets = max(1, round(base_sets * 0.6)) if is_deload else base_sets
                workout_exercises.append({
                    "id": str(uuid.uuid4()),
                    "exercise_id": ex["id"],
                    "exercise_name": ex["name"],
                    "order_index": idx,
                    "target_sets": target_sets,
                    "rep_range": slot["rep_range"],
                    "rest_seconds": 180 if slot["movement"] in ("squat", "hinge", "push", "pull") else 90,
                    "notes": "",
                    "is_deload": is_deload,
                })
            workouts.append({
                "id": workout_id,
                "user_id": user_id,
                "program_id": program_id,
                "name": (day["name"] + " (Deload)") if is_deload else day["name"],
                "scheduled_date": workout_date.isoformat(),
                "week_index": week,
                "day_index": day["day_index"],
                "is_deload": is_deload,
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


def generate_deterministic_insights(user_id: str, weekly_volume: Dict[str, float], landmarks: Dict[str, Dict], recent_workouts: List[Dict], prs: List[Dict], streak_days: int = 0) -> List[Dict]:
    """Generate insights based on rules. Each insight includes raw 'data' for the See-the-Data toggle."""
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

    # Streak insight
    if streak_days >= 3:
        insights.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "streak",
            "severity": "success",
            "title": f"{streak_days}-day streak",
            "body": f"You've trained {streak_days} consecutive days. Your nervous system has adapted — keep listening to recovery cues.",
            "data": {"streak_days": streak_days},
            "created_at": now,
            "dismissed": False,
        })
    return insights


async def generate_llm_weekly_digest(user_name: str, weekly_volume: Dict[str, float], prev_weekly_volume: Dict[str, float], prs: List[Dict], compliance: float, completed_workouts: int, streak_days: int, weak_subgroups: List[Dict], top_movers: List[Dict]) -> Dict:
    """Use Claude Sonnet 4.5 to generate friendly weekly digest prose with hallucination guard.
    Returns dict {text, source: 'llm' | 'fallback' | 'guard_failed', allowed_numbers: [..]}"""
    # Build the canonical fact base — every number we pass in becomes "allowed"
    top_volume = sorted(weekly_volume.items(), key=lambda x: -x[1])[:5]
    allowed_numbers = set()

    def _add_num(*vals):
        for v in vals:
            if v is None:
                continue
            try:
                f = float(v)
                allowed_numbers.add(round(f, 1))
                allowed_numbers.add(round(f))
                allowed_numbers.add(round(f * 100))  # for percentages
            except (TypeError, ValueError):
                pass

    _add_num(completed_workouts, compliance * 100, streak_days, len(prs))
    for k, v in top_volume:
        _add_num(v)
    for k, v in prev_weekly_volume.items():
        _add_num(v)
    for p in prs[:5]:
        _add_num(p.get("weight"), p.get("reps"), p.get("e1rm"))
    for w in weak_subgroups[:3]:
        _add_num(w.get("sets"), w.get("mev"))
    for m in top_movers[:3]:
        _add_num(m.get("delta"), m.get("current"), m.get("previous"))

    fallback_text = _fallback_digest(weekly_volume, prs, compliance, completed_workouts, streak_days)
    try:
        from groq import Groq
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            return {"text": fallback_text, "source": "fallback", "allowed_numbers": sorted(allowed_numbers)}

        vol_summary = ", ".join([f"{k.replace('_', ' ')}: {v:.1f} sets" for k, v in top_volume]) or "none"
        weak_summary = "; ".join([f"{w['subgroup'].replace('_', ' ')} ({w['sets']:.1f} sets vs MEV {w['mev']})" for w in weak_subgroups[:3]]) or "none"
        movers_summary = "; ".join([f"{m['subgroup'].replace('_', ' ')} {m['delta']:+.1f} sets" for m in top_movers[:3]]) or "none"
        pr_summary = "; ".join([f"{p['exercise_name']} {p['weight']}kg×{p['reps']}" for p in prs[:5]]) or "no new PRs"

        system = (
            "You are a precise, encouraging strength coach writing a SHORT weekly digest (3-4 paragraphs, ~140 words). "
            "Rules: (1) NEVER invent numbers — only use exact values from the data. "
            "(2) Tone: honest, warm, no hype, no exclamation marks. "
            "(3) Reference at least one specific data point (PR, weak muscle, or volume change). "
            "(4) End with one forward-looking suggestion or question. "
            "(5) Do not use markdown headers or bullets — flowing prose only."
        )
        prompt = (
            f"Athlete: {user_name}\n"
            f"Workouts completed this week: {completed_workouts}\n"
            f"Adherence: {compliance*100:.0f}%\n"
            f"Current streak: {streak_days} consecutive day(s) with logged sessions\n"
            f"Top volume areas: {vol_summary}\n"
            f"Top movers vs last week: {movers_summary}\n"
            f"Below-MEV areas to watch: {weak_summary}\n"
            f"Personal records this week: {pr_summary}\n\n"
            f"Write the weekly digest now."
        )

        client = Groq(api_key=api_key)
        message = client.chat.completions.create(
            model="mixtral-8x7b-32768",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=300
        )
        text = message.choices[0].message.content.strip()

        # Hallucination guard: every number in the response must be in allowed_numbers (or be 0/1 — common harmless values)
        import re
        numbers_in_text = re.findall(r"\d+(?:\.\d+)?", text)
        suspicious = []
        for n in numbers_in_text:
            f = float(n)
            if f in {0, 1, 2, 3, 4, 5, 6, 7}:  # small ordinals — allow
                continue
            if round(f, 1) in allowed_numbers or round(f) in allowed_numbers:
                continue
            suspicious.append(f)
        if len(suspicious) >= 2:  # 2+ unverified numbers → reject the LLM output
            print(f"[digest] hallucination guard tripped: {suspicious[:5]}")
            return {"text": fallback_text, "source": "guard_failed", "suspicious_numbers": suspicious[:5], "allowed_numbers": sorted(allowed_numbers)}
        return {"text": text, "source": "llm", "allowed_numbers": sorted(allowed_numbers)}
    except Exception as e:
        print(f"[digest] LLM failed: {e}")
        return {"text": fallback_text, "source": "fallback", "allowed_numbers": sorted(allowed_numbers), "error": str(e)}


def _fallback_digest(weekly_volume: Dict[str, float], prs: List[Dict], compliance: float, completed: int, streak_days: int = 0) -> str:
    top = sorted(weekly_volume.items(), key=lambda x: -x[1])[:3]
    top_str = ", ".join([k.replace("_", " ") for k, _ in top]) if top else "none yet"
    pr_str = f"{len(prs)} new personal record(s)" if prs else "no new PRs this week"
    streak_str = f" Streak: {streak_days} consecutive day(s)." if streak_days >= 2 else ""
    return (
        f"You completed {completed} session(s) this week with {compliance*100:.0f}% adherence.{streak_str} "
        f"Your highest-volume areas were {top_str}. You hit {pr_str}. "
        "Stay consistent — small sessions beat skipped ones. What is one exercise you want to push next week?"
    )


def compute_streak_days(workouts: List[Dict]) -> int:
    """Count consecutive days (ending today or yesterday) with at least one completed workout."""
    days_with = set()
    for w in workouts:
        if not w.get("completed_at"):
            continue
        ts = w["completed_at"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        days_with.add(ts.date())
    today = datetime.now(timezone.utc).date()
    streak = 0
    cursor = today
    if cursor not in days_with:
        cursor = today - timedelta(days=1)
        if cursor not in days_with:
            return 0
    while cursor in days_with:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def find_weak_subgroups(weekly_volume: Dict[str, float], landmarks: Dict[str, Dict]) -> List[Dict]:
    """Return subgroups below MEV, sorted by ratio (most under-trained first)."""
    weak = []
    for sg, sets in weekly_volume.items():
        lm = landmarks.get(sg) or DEFAULT_LANDMARKS.get(sg) or {"mev": 0, "mav": 10, "mrv": 20}
        if lm["mev"] > 0 and sets < lm["mev"]:
            weak.append({"subgroup": sg, "sets": round(sets, 1), "mev": lm["mev"], "ratio": sets / lm["mev"]})
    return sorted(weak, key=lambda x: x["ratio"])


def compute_top_movers(current: Dict[str, float], previous: Dict[str, float], n: int = 3) -> List[Dict]:
    """Subgroups with biggest week-over-week absolute volume delta."""
    deltas = []
    for sg in set(current) | set(previous):
        c = current.get(sg, 0)
        p = previous.get(sg, 0)
        deltas.append({"subgroup": sg, "current": round(c, 1), "previous": round(p, 1), "delta": round(c - p, 1)})
    return sorted(deltas, key=lambda x: -abs(x["delta"]))[:n]


# ==================== AI Split Generator ====================

_SLOT_TEMPLATES: Dict[str, List[Dict]] = {
    "chest": [
        {"category": "chest", "movement": "push", "sets": 3, "rep_range": [6, 10]},
        {"category": "chest", "movement": "isolation", "sets": 3, "rep_range": [10, 15]},
    ],
    "back": [
        {"category": "back", "movement": "pull", "sets": 3, "rep_range": [6, 10]},
        {"category": "back", "movement": "pull", "sets": 3, "rep_range": [8, 12]},
    ],
    "shoulders": [
        {"category": "shoulders", "movement": "push", "sets": 3, "rep_range": [8, 12]},
        {"category": "shoulders", "movement": "isolation", "sets": 3, "rep_range": [12, 20], "subgroup": "side_delts"},
    ],
    "arms": [
        {"category": "arms", "movement": "isolation", "sets": 3, "rep_range": [8, 12], "subgroup": "biceps_short"},
        {"category": "arms", "movement": "isolation", "sets": 3, "rep_range": [8, 12], "subgroup": "triceps_long"},
    ],
    "legs": [
        {"category": "legs", "movement": "squat", "sets": 4, "rep_range": [6, 10]},
        {"category": "legs", "movement": "hinge", "sets": 3, "rep_range": [8, 12]},
        {"category": "legs", "movement": "isolation", "sets": 3, "rep_range": [10, 15], "subgroup": "calves"},
    ],
    "core": [
        {"category": "core", "movement": "isolation", "sets": 3, "rep_range": [12, 20]},
    ],
}

_VALID_CATEGORIES = {"chest", "back", "shoulders", "arms", "legs", "core"}


def _slots_from_focus(muscle_focus: List[str]) -> List[Dict]:
    slots = []
    for muscle in muscle_focus:
        slots.extend(_SLOT_TEMPLATES.get(muscle, []))
    return slots


def generate_ai_split_structure(days_per_week: int, description: str, goal: str, experience: str) -> Dict:
    """Use Groq to generate a workout split structure from the user's natural-language description."""
    import json
    import re

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {"error": "Groq API key not configured"}

    try:
        from groq import Groq
        client = Groq(api_key=api_key)

        system = (
            "You are an expert strength coach. Respond ONLY with valid JSON — no markdown, no explanation."
        )
        prompt = (
            f"Create a {days_per_week}-day workout split for a {experience} lifter whose goal is {goal}.\n"
            f'User request: "{description}"\n\n'
            f"Return ONLY this JSON structure (no other text):\n"
            f'{{"name":"Split Name","description":"One sentence.","days":['
            f'{{"day_index":0,"name":"Day Name","muscle_focus":["chest","shoulders"]}}]}}\n\n'
            f"Rules:\n"
            f"- Exactly {days_per_week} days with day_index 0 to {days_per_week - 1}\n"
            f"- muscle_focus may only contain: chest, back, shoulders, arms, legs, core\n"
            f"- Match the user request as closely as possible"
        )

        message = client.chat.completions.create(
            model="mixtral-8x7b-32768",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.35,
            max_tokens=600,
        )
        text = message.choices[0].message.content.strip()

        json_match = re.search(r"\{.*\}", text, re.DOTALL)
        if not json_match:
            return {"error": "Could not parse AI response"}

        split_data = json.loads(json_match.group())
        days = split_data.get("days", [])
        if len(days) != days_per_week:
            return {"error": f"AI returned {len(days)} days instead of {days_per_week}"}

        for i, day in enumerate(days):
            day["day_index"] = i
            day["muscle_focus"] = [f for f in day.get("muscle_focus", []) if f in _VALID_CATEGORIES]
            day["slots"] = _slots_from_focus(day["muscle_focus"])

        return {
            "name": split_data.get("name", f"Custom {days_per_week}-Day Split"),
            "description": split_data.get("description", "AI-generated custom split"),
            "frequency_per_week": days_per_week,
            "days": days,
        }

    except Exception as e:
        return {"error": str(e)}


# ==================== AI Chat ====================

def build_chat_system_prompt(
    user: Dict,
    program: Dict,
    recent_workouts: List[Dict],
    prs: List[Dict],
    week_completed: List[Dict] = None,
    week_planned: List[Dict] = None,
) -> str:
    name = (user.get("name") or "Athlete").split()[0]
    goal = user.get("goal", "hypertrophy")
    experience = user.get("experience", "intermediate")
    days = user.get("days_per_week", 4)
    weight = user.get("weight_kg")
    units = user.get("units", "kg")

    lines = [
        f"You are a knowledgeable, concise personal trainer coaching {name}.",
        "",
        "ATHLETE PROFILE:",
        f"- Goal: {goal}",
        f"- Experience: {experience}",
        f"- Training {days} days/week",
    ]
    if weight:
        lines.append(f"- Body weight: {weight} {units}")

    if program:
        lines += [
            "",
            "ACTIVE PROGRAM:",
            f"- Split: {program.get('split_name', 'unknown')}",
            f"- Week {(program.get('current_week') or 0) + 1} of {program.get('weeks', 4)}",
        ]

    if week_completed or week_planned:
        lines += ["", "THIS WEEK:"]
        if week_completed:
            names = ", ".join(w.get("name", "Workout") for w in week_completed)
            lines.append(f"- Completed: {names}")
        else:
            lines.append("- Completed: none yet")
        if week_planned:
            for w in week_planned:
                ex_names = ", ".join(e.get("exercise_name", "") for e in (w.get("exercises") or [])[:5])
                suffix = "..." if len(w.get("exercises") or []) > 5 else ""
                lines.append(f"- Scheduled: {w.get('name')} ({(w.get('scheduled_date') or '')[:10]}) — {ex_names}{suffix}")
        else:
            lines.append("- No more workouts scheduled this week")

    if recent_workouts:
        lines += ["", "RECENT WORKOUTS (most recent first):"]
        for w in recent_workouts[:6]:
            date = (w.get("completed_at") or "")[:10]
            lines.append(f"- {w.get('name', 'Workout')} ({date})")

    if prs:
        lines += ["", "TOP PERSONAL RECORDS:"]
        for pr in prs[:8]:
            lines.append(f"- {pr.get('exercise_name')}: {pr.get('weight')}{units} × {pr.get('reps')} reps (e1RM {pr.get('e1rm')}{units})")

    lines += [
        "",
        "PLAN MODIFICATION — use when user requests it:",
        "You can propose workout plan changes. Include ONE <action> tag when appropriate:",
        "",
        "  Fewer training days this week:",
        '  <action>{"type":"reschedule_week","days":N}</action>',
        "",
        "  Injury / avoid a muscle group:",
        '  <action>{"type":"remove_exercises","muscle_groups":["hamstrings"]}</action>',
        "",
        "  Lagging muscle — add volume:",
        '  <action>{"type":"add_volume","muscle_groups":["chest"],"extra_sets":2}</action>',
        "",
        "RULES:",
        "- Only propose an action when the user is clearly requesting a plan change.",
        "- Always explain what you will do BEFORE the <action> tag.",
        "- The user will see a confirmation card — nothing changes without their approval.",
        "- Do not invent exercise names. The system handles the exact exercises.",
        "- Answer in 2-4 short paragraphs. Be specific and reference their data.",
        "- Do not make up numbers not present in the data above.",
    ]
    return "\n".join(lines)


# ── Coach action helpers ─────────────────────────────────────────────────────

MUSCLE_ALIASES: Dict[str, List[str]] = {
    "chest": ["chest"], "pecs": ["chest"],
    "back": ["upper_back", "lats", "lower_back"], "lats": ["lats"], "upper back": ["upper_back"],
    "shoulders": ["front_delt", "side_delt", "rear_delt"], "delts": ["front_delt", "side_delt", "rear_delt"],
    "shoulder": ["front_delt", "side_delt", "rear_delt"],
    "biceps": ["biceps"], "triceps": ["triceps"],
    "arms": ["biceps", "triceps"],
    "legs": ["quads", "hamstrings", "glutes", "calves"],
    "quads": ["quads"], "quadriceps": ["quads"],
    "hamstrings": ["hamstrings"], "hamstring": ["hamstrings"],
    "glutes": ["glutes"], "glute": ["glutes"],
    "calves": ["calves"], "calf": ["calves"],
    "core": ["abs", "obliques"], "abs": ["abs"], "abdomen": ["abs"],
    "lower back": ["lower_back"],
}


def resolve_muscle_groups(names: List[str]) -> List[str]:
    result: set = set()
    for n in names:
        n_lower = n.lower().strip()
        if n_lower in MUSCLE_ALIASES:
            result.update(MUSCLE_ALIASES[n_lower])
        else:
            result.add(n_lower.replace(" ", "_"))
    return list(result)


def parse_coach_action(text: str) -> Tuple[str, Optional[Dict]]:
    """Extract <action>JSON</action> from LLM response. Returns (clean_text, action_dict)."""
    match = re.search(r"<action>(.*?)</action>", text, re.DOTALL)
    if not match:
        return text, None
    clean = (text[: match.start()] + text[match.end() :]).strip()
    try:
        return clean, json.loads(match.group(1).strip())
    except Exception:
        return text, None


def preview_reschedule_week(planned_workouts: List[Dict], days_available: int) -> Dict:
    """Merge remaining planned workouts into days_available sessions."""
    if not planned_workouts:
        return {"summary": "No workouts remaining this week to reschedule.", "new_workouts": [], "original_ids": []}

    n = len(planned_workouts)
    original_ids = [w["id"] for w in planned_workouts]

    if days_available >= n:
        return {
            "summary": f"You already have only {n} workout(s) remaining — no merging needed.",
            "new_workouts": planned_workouts,
            "original_ids": original_ids,
        }

    # Spread n workouts into days_available groups
    groups: List[List[Dict]] = []
    per = n / days_available
    for i in range(days_available):
        s = round(i * per)
        e = round((i + 1) * per)
        groups.append(planned_workouts[s:e])

    new_workouts = []
    for group in groups:
        if len(group) == 1:
            new_workouts.append(dict(group[0]))
        else:
            merged_exercises: List[Dict] = []
            seen: set = set()
            for w in group:
                for ex in w.get("exercises") or []:
                    if ex["exercise_name"] not in seen:
                        seen.add(ex["exercise_name"])
                        merged_exercises.append(ex)
            merged_exercises = merged_exercises[:8]  # cap session length
            merged = dict(group[0])
            merged["name"] = " + ".join(w["name"] for w in group)
            merged["exercises"] = merged_exercises
            merged["_merged_from"] = [w["id"] for w in group]
            new_workouts.append(merged)

    # Assign dates from the first workout of each group
    for nw, group in zip(new_workouts, groups):
        nw["scheduled_date"] = group[0]["scheduled_date"]

    lines = [f"Merge {n} remaining workouts into {days_available} session(s):"]
    for nw in new_workouts:
        date = (nw.get("scheduled_date") or "")[:10]
        ex_preview = ", ".join(e["exercise_name"] for e in (nw.get("exercises") or [])[:4])
        if len(nw.get("exercises") or []) > 4:
            ex_preview += "…"
        lines.append(f"• {nw['name']} ({date}): {ex_preview}")

    return {"summary": "\n".join(lines), "new_workouts": new_workouts, "original_ids": original_ids}


def preview_remove_exercises(planned_workouts: List[Dict], muscle_groups: List[str], exercises_db: List[Dict]) -> Dict:
    """Find exercises targeting muscle_groups in upcoming workouts."""
    subgroups = set(resolve_muscle_groups(muscle_groups))
    exs_by_id = {e["id"]: e for e in exercises_db}

    removals: List[Dict] = []
    for w in planned_workouts:
        for ex in w.get("exercises") or []:
            db_ex = exs_by_id.get(ex.get("exercise_id"), {})
            ex_sgs = set((db_ex.get("subgroups") or {}).keys())
            if ex_sgs & subgroups:
                removals.append({
                    "workout_id": w["id"],
                    "workout_name": w["name"],
                    "exercise_id": ex.get("exercise_id"),
                    "exercise_name": ex["exercise_name"],
                })

    if not removals:
        return {
            "summary": f"No exercises found targeting {', '.join(muscle_groups)} in your upcoming workouts. Nothing to remove.",
            "removals": [],
            "muscle_groups": list(subgroups),
        }

    lines = [f"Remove {len(removals)} exercise(s) targeting {', '.join(muscle_groups)}:"]
    for r in removals:
        lines.append(f"• {r['exercise_name']} (from {r['workout_name']})")

    return {"summary": "\n".join(lines), "removals": removals, "muscle_groups": list(subgroups)}


def preview_add_volume(planned_workouts: List[Dict], muscle_groups: List[str], extra_sets: int, exercises_db: List[Dict]) -> Dict:
    """Preview adding extra_sets to exercises targeting muscle_groups."""
    subgroups = set(resolve_muscle_groups(muscle_groups))
    exs_by_id = {e["id"]: e for e in exercises_db}

    additions: List[Dict] = []
    for w in planned_workouts:
        for ex in w.get("exercises") or []:
            db_ex = exs_by_id.get(ex.get("exercise_id"), {})
            ex_sgs = set((db_ex.get("subgroups") or {}).keys())
            if ex_sgs & subgroups:
                additions.append({
                    "workout_id": w["id"],
                    "workout_name": w["name"],
                    "exercise_name": ex["exercise_name"],
                    "current_sets": ex.get("target_sets", 3),
                    "new_sets": ex.get("target_sets", 3) + extra_sets,
                })

    if not additions:
        return {
            "summary": f"No exercises found targeting {', '.join(muscle_groups)} in upcoming workouts.",
            "additions": [],
            "muscle_groups": list(subgroups),
            "extra_sets": extra_sets,
        }

    lines = [f"Add {extra_sets} set(s) to {len(additions)} exercise(s) targeting {', '.join(muscle_groups)}:"]
    for a in additions:
        lines.append(f"• {a['exercise_name']} ({a['workout_name']}): {a['current_sets']} → {a['new_sets']} sets")

    return {"summary": "\n".join(lines), "additions": additions, "muscle_groups": list(subgroups), "extra_sets": extra_sets}


def call_groq_chat(messages: List[Dict]) -> str:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return "Chat is not configured (missing GROQ_API_KEY)."
    # Try models in order until one succeeds
    models = ["llama-3.1-70b-versatile", "llama3-70b-8192", "mixtral-8x7b-32768"]
    last_err = None
    for model in models:
        try:
            from groq import Groq
            client = Groq(api_key=api_key)
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.6,
                max_tokens=600,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            last_err = e
            continue
    return f"Sorry, I couldn't process that right now. ({last_err})"


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
