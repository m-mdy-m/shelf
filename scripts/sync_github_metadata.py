#!/usr/bin/env python3
"""Create/update repository labels and milestones from checked-in JSON manifests."""

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


def request(method: str, path: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(
        API + path, data=data, method=method,
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


def paginated(path: str) -> list[dict]:
    items: list[dict] = []
    page = 1
    while True:
        separator = "&" if "?" in path else "?"
        batch = request("GET", f"{path}{separator}per_page=100&page={page}")
        if not isinstance(batch, list):
            raise RuntimeError(f"Expected a list from {path}")
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1


def sync_labels() -> int:
    rows = json.loads((ROOT / ".github/labels.json").read_text(encoding="utf-8"))
    existing = {row["name"]: row for row in paginated(f"/repos/{REPO}/labels")}
    changed = 0
    for row in rows:
        name = row["name"]
        payload = {"name": name, "color": row["color"].lstrip("#"), "description": row["description"]}
        current = existing.get(name)
        if current:
            if current.get("color", "").lower() == payload["color"].lower() and current.get("description", "") == payload["description"]:
                continue
            request("PATCH", f"/repos/{REPO}/labels/{quote(name, safe='')}", payload)
        else:
            request("POST", f"/repos/{REPO}/labels", payload)
        changed += 1
        time.sleep(0.05)
    return changed


def sync_milestones() -> int:
    rows = json.loads((ROOT / ".github/milestones.json").read_text(encoding="utf-8"))
    existing = {row["title"]: row for row in paginated(f"/repos/{REPO}/milestones?state=all")}
    changed = 0
    for row in rows:
        title = row["title"]
        payload = {"title": title, "description": row["description"], "state": "open"}
        current = existing.get(title)
        if current:
            if current.get("description", "") == payload["description"] and current.get("state") == "open":
                continue
            request("PATCH", f"/repos/{REPO}/milestones/{current['number']}", payload)
        else:
            request("POST", f"/repos/{REPO}/milestones", payload)
        changed += 1
        time.sleep(0.05)
    return changed


def main() -> None:
    if not REPO or not TOKEN:
        raise SystemExit("GITHUB_REPOSITORY and GITHUB_TOKEN are required")
    labels = sync_labels()
    milestones = sync_milestones()
    print(f"Metadata synchronized: {labels} labels and {milestones} milestones created/updated.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
