"""프로젝트 저장소 (SQLite).

설계 문서(params/underlay)는 프론트엔드 스키마이므로 서버는 내용을 해석하지
않고 JSON 문자열로 그대로 보관한다. 스키마가 바뀌어도 서버는 손대지 않는다.
검색·정렬에 필요한 최소 메타(이름, 시각)만 컬럼으로 뽑아 둔다.

의존성 없음 — 표준 라이브러리 sqlite3 만 사용한다.
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(os.environ.get("FLOORPLAN_DB", Path(__file__).parent / "projects.db"))

# 문서 하나가 이보다 크면 거부한다. 밑그림 이미지가 base64 로 들어와도
# 서버가 통째로 삼키지 않도록 하는 안전장치(바이트).
MAX_DOC_BYTES = 12 * 1024 * 1024


class ProjectError(Exception):
    """저장소 사용 오류 (호출자가 4xx 로 바꾼다)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # 동시 읽기/쓰기에서 잠금 충돌을 줄인다.
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                doc         TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC)")


def _dump(doc: Any) -> str:
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_DOC_BYTES:
        raise ProjectError(
            f"문서가 너무 큽니다 ({len(text.encode('utf-8')) // 1024}KB). "
            f"밑그림 이미지를 빼거나 해상도를 낮춰 주세요."
        )
    return text


def _summary(row: sqlite3.Row) -> dict:
    """목록용 요약 — 문서 본문은 빼고 규모만 알려준다."""
    try:
        doc = json.loads(row["doc"])
        params = doc.get("params") or {}
        boundary = params.get("boundary") or []
        corridors = params.get("corridors") or []
        cores = params.get("cores") or []
    except (json.JSONDecodeError, AttributeError):
        boundary, corridors, cores = [], [], []
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "boundary_points": len(boundary),
        "corridor_count": len(corridors),
        "core_count": len(cores),
    }


def list_projects() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, doc, created_at, updated_at FROM projects ORDER BY updated_at DESC"
        ).fetchall()
    return [_summary(r) for r in rows]


def get_project(project_id: str) -> dict:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name, doc, created_at, updated_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
    if row is None:
        raise ProjectError(f"프로젝트를 찾을 수 없습니다: {project_id}")
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "doc": json.loads(row["doc"]),
    }


def create_project(name: str, doc: Any) -> dict:
    name = (name or "").strip() or "제목 없음"
    text = _dump(doc)
    pid = uuid.uuid4().hex[:12]
    ts = _now()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (pid, name, text, ts, ts),
        )
    return get_project(pid)


def update_project(project_id: str, name: str | None, doc: Any | None) -> dict:
    sets, args = [], []
    if name is not None:
        sets.append("name = ?")
        args.append(name.strip() or "제목 없음")
    if doc is not None:
        sets.append("doc = ?")
        args.append(_dump(doc))
    if not sets:
        return get_project(project_id)

    sets.append("updated_at = ?")
    args.append(_now())
    args.append(project_id)

    with _connect() as conn:
        cur = conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", args)
        if cur.rowcount == 0:
            raise ProjectError(f"프로젝트를 찾을 수 없습니다: {project_id}")
    return get_project(project_id)


def delete_project(project_id: str) -> None:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        if cur.rowcount == 0:
            raise ProjectError(f"프로젝트를 찾을 수 없습니다: {project_id}")
