#!/usr/bin/env python3
"""Idempotently synchronize Shelf's GitHub labels, milestones, and issue metadata."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.github.com"
REPO = os.environ.get("GITHUB_REPOSITORY", "")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
OBSOLETE_LABELS = {"area:integration"}
MILESTONE_RENAMES = {"0.3 — Knowledge & Portability": 3}


def api(method: str, path: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {TOKEN}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "shelf-project-metadata-sync",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {method} {path}: HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"GitHub API connection failed: {exc}") from exc


def pages(path: str) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        separator = "&" if "?" in path else "?"
        batch = api("GET", f"{path}{separator}per_page=100&page={page}")
        if not isinstance(batch, list):
            raise RuntimeError(f"Expected list response from {path}")
        out.extend(batch)
        if len(batch) < 100:
            return out
        page += 1


def sync_labels() -> int:
    manifest = json.loads((ROOT / ".github/labels.json").read_text(encoding="utf-8"))
    existing = {item["name"]: item for item in pages(f"/repos/{REPO}/labels")}
    changed = 0
    for item in manifest:
        name = item["name"]
        payload = {
            "name": name,
            "color": item["color"].lstrip("#"),
            "description": item["description"],
        }
        current = existing.get(name)
        if current and current.get("color", "").lower() == payload["color"].lower() and current.get("description", "") == payload["description"]:
            continue
        if current:
            api("PATCH", f"/repos/{REPO}/labels/{quote(name, safe='')}", payload)
        else:
            api("POST", f"/repos/{REPO}/labels", payload)
        changed += 1
        time.sleep(0.04)

    for name in OBSOLETE_LABELS:
        if name in existing:
            api("DELETE", f"/repos/{REPO}/labels/{quote(name, safe='')}")
            changed += 1
            time.sleep(0.04)
    return changed


def sync_milestones() -> tuple[dict[str, int], int]:
    manifest = json.loads((ROOT / ".github/milestones.json").read_text(encoding="utf-8"))
    rows = pages(f"/repos/{REPO}/milestones?state=all")
    by_title = {item["title"]: item for item in rows}
    by_number = {item["number"]: item for item in rows}
    resolved: dict[str, int] = {}
    changed = 0

    for item in manifest:
        title = item["title"]
        payload = {"title": title, "description": item["description"], "state": "open"}
        current = by_title.get(title)
        if current is None and title in MILESTONE_RENAMES:
            current = by_number.get(MILESTONE_RENAMES[title])

        if current:
            if current.get("title") == title and current.get("description", "") == payload["description"] and current.get("state") == "open":
                resolved[title] = current["number"]
                continue
            saved = api("PATCH", f"/repos/{REPO}/milestones/{current['number']}", payload)
        else:
            saved = api("POST", f"/repos/{REPO}/milestones", payload)

        resolved[title] = saved["number"]
        changed += 1
        time.sleep(0.04)
    return resolved, changed


def sync_issues(milestones: dict[str, int]) -> int:
    manifest = json.loads((ROOT / ".github/issue-metadata.json").read_text(encoding="utf-8"))
    changed = 0
    for issue_number, item in manifest.items():
        milestone_number = milestones.get(item["milestone"])
        if milestone_number is None:
            raise RuntimeError(f"Missing milestone {item['milestone']} for issue #{issue_number}")
        api(
            "PATCH",
            f"/repos/{REPO}/issues/{issue_number}",
            {
                "labels": item["labels"],
                "milestone": milestone_number,
                "assignees": item["assignees"],
            },
        )
        changed += 1
        time.sleep(0.04)
    return changed


def main() -> None:
    if not REPO or not TOKEN:
        raise SystemExit("GITHUB_REPOSITORY and GITHUB_TOKEN are required")
    labels = sync_labels()
    milestones, milestone_changes = sync_milestones()
    issues = sync_issues(milestones)
    print(
        f"Metadata synchronized: {labels} label changes, "
        f"{milestone_changes} milestone changes, {issues} issues updated."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
