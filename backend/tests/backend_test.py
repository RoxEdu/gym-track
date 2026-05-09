"""Backend tests for GymTrack API."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://analytics-152.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TOKEN = os.environ.get("TEST_SESSION_TOKEN", "test_session_1777273133679")
USER_ID = os.environ.get("TEST_USER_ID", "user_test1777273133679")
H = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


# ---- health + auth gating ----
def test_health():
    r = requests.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_session_invalid():
    r = requests.post(f"{API}/auth/session", json={"session_id": "bogus_session_id_xyz"})
    assert r.status_code == 401


@pytest.mark.parametrize("path", ["/auth/me", "/exercises", "/insights"])
def test_auth_gated(path):
    r = requests.get(f"{API}{path}")
    assert r.status_code == 401


def test_me_ok():
    r = requests.get(f"{API}/auth/me", headers=H)
    assert r.status_code == 200
    data = r.json()
    assert data["user_id"] == USER_ID
    assert "_id" not in data


# ---- exercises ----
def test_exercises_list():
    r = requests.get(f"{API}/exercises", headers=H)
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 59
    assert all("_id" not in e for e in items)


def test_exercises_filter_chest():
    r = requests.get(f"{API}/exercises?category=chest", headers=H)
    assert r.status_code == 200
    items = r.json()
    assert len(items) > 0
    assert all(e.get("category") == "chest" for e in items)


def test_exercises_search_bench():
    r = requests.get(f"{API}/exercises?search=bench", headers=H)
    assert r.status_code == 200
    items = r.json()
    assert len(items) > 0
    assert any("bench" in e["name"].lower() for e in items)


def test_exercise_detail():
    items = requests.get(f"{API}/exercises", headers=H).json()
    eid = items[0]["id"]
    r = requests.get(f"{API}/exercises/{eid}", headers=H)
    assert r.status_code == 200
    d = r.json()
    assert "exercise" in d and "history" in d and "pr" in d


def test_splits():
    r = requests.get(f"{API}/splits", headers=H)
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 4


def test_muscle_groups():
    r = requests.get(f"{API}/muscle-groups", headers=H)
    assert r.status_code == 200


# ---- onboarding ----
def test_onboarding():
    payload = {"sex": "male", "age": 28, "height_cm": 178.0, "weight_kg": 80.0,
               "experience": "intermediate", "goal": "hypertrophy", "days_per_week": 4,
               "equipment": ["barbell", "dumbbell"], "units": "kg"}
    r = requests.put(f"{API}/profile/onboarding", json=payload, headers=H)
    assert r.status_code == 200
    assert r.json()["onboarded"] is True


# ---- program/workouts ----
@pytest.fixture(scope="module")
def program_state():
    splits = requests.get(f"{API}/splits", headers=H).json()
    sid = splits[0]["id"]
    r = requests.post(f"{API}/programs", json={"split_id": sid, "weeks": 2}, headers=H)
    assert r.status_code == 200, r.text
    pdata = r.json()
    assert pdata["workouts_count"] > 0
    active = requests.get(f"{API}/programs/active", headers=H).json()
    assert active["program"] is not None
    workouts = active["workouts"]
    return {"program": pdata["program"], "workouts": workouts}


def test_create_program(program_state):
    assert program_state["program"]["id"]
    assert len(program_state["workouts"]) > 0


def test_workouts_today():
    r = requests.get(f"{API}/workouts/today", headers=H)
    assert r.status_code == 200


def test_workout_flow(program_state):
    w = program_state["workouts"][0]
    wid = w["id"]
    # start
    r = requests.post(f"{API}/workouts/{wid}/start", headers=H)
    assert r.status_code == 200
    # get
    r = requests.get(f"{API}/workouts/{wid}", headers=H)
    assert r.status_code == 200
    wdata = r.json()
    assert wdata["workout"]["status"] == "in_progress"
    # log set
    wex = wdata["workout"]["exercises"][0]
    set_payload = {
        "workout_id": wid,
        "workout_exercise_id": wex["id"],
        "exercise_id": wex["exercise_id"],
        "set_index": 0, "weight": 100.0, "reps": 8, "rir": 2,
    }
    r = requests.post(f"{API}/sets", json=set_payload, headers=H)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s.get("e1rm", 0) > 0
    sid = s["id"]
    # update
    r = requests.put(f"{API}/sets/{sid}", json={"weight": 105, "reps": 8, "rir": 2}, headers=H)
    assert r.status_code == 200
    assert r.json().get("e1rm", 0) > 0
    # delete
    r = requests.delete(f"{API}/sets/{sid}", headers=H)
    assert r.status_code == 200
    # log another + complete
    set_payload["weight"] = 110
    requests.post(f"{API}/sets", json=set_payload, headers=H)
    r = requests.post(f"{API}/workouts/{wid}/complete", headers=H)
    assert r.status_code == 200
    assert "duration_seconds" in r.json()


# ---- body ----
def test_body_log_and_list():
    r = requests.post(f"{API}/body", json={"weight_kg": 80.5, "waist_cm": 85.0}, headers=H)
    assert r.status_code == 200
    r = requests.get(f"{API}/body", headers=H)
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1


# ---- progress + insights ----
def test_progress_overview():
    r = requests.get(f"{API}/progress/overview", headers=H)
    assert r.status_code == 200
    d = r.json()
    for k in ["weekly_volume", "recent_prs", "body_history", "completed_workouts", "total_sets"]:
        assert k in d
    assert len(d["weekly_volume"]) == 8


def test_insights():
    r = requests.get(f"{API}/insights", headers=H)
    assert r.status_code == 200
    d = r.json()
    for k in ["insights", "weekly_volume", "landmarks", "recovery"]:
        assert k in d


def test_digest_llm():
    r = requests.post(f"{API}/insights/digest", headers=H, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("text") and len(d["text"]) > 10
