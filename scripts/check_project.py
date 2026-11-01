#!/usr/bin/env python3
"""Validate the specification-first Shelf repository with Python's standard library."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "README.md", "LICENSE", "psx.yml", ".gix/config", "pipeline.toml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/sync-project-metadata.yml",
    ".github/labels.json", ".github/milestones.json",
    "archive/README.md", "archive/catalog.json", "archive/SCHEMA.md",
    "spec/README.md", "spec/00-product-brief.md", "spec/01-architecture.md",
    "spec/02-reader-engine.md", "spec/03-ai-companion.md",
    "spec/04-data-model.md", "spec/05-cross-platform.md",
    "spec/06-quality-security.md", "spec/07-roadmap.md",
    "spec/08-github-work-plan.md",
)
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_json(path: str):
    try:
        return json.loads((ROOT / path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{path} is invalid JSON: {exc}")


def main() -> None:
    missing = [name for name in REQUIRED if not (ROOT / name).is_file()]
    if missing:
        fail("required files missing: " + ", ".join(missing))

    catalog = read_json("archive/catalog.json")
    if not isinstance(catalog, dict) or not isinstance(catalog.get("books"), list) or not catalog.get("version"):
        fail("archived catalog must retain version and top-level books array")
    schema = (ROOT / "archive/SCHEMA.md").read_text(encoding="utf-8")
    if "TechShelf Catalog Schema" not in schema:
        fail("archived schema does not match the preserved TechShelf schema")

    pipeline = tomllib.loads((ROOT / "pipeline.toml").read_text(encoding="utf-8"))
    tasks = pipeline.get("tasks", {})
    for task in ("project-check", "compile", "check", "ci"):
        if task not in tasks:
            fail(f"pipeline.toml is missing task {task!r}")
    for name, task in tasks.items():
        command = task.get("command")
        if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
            fail(f"pipeline task {name!r} needs a non-empty command array")
        for dep in task.get("depends_on", []):
            if dep not in tasks:
                fail(f"pipeline task {name!r} has unknown dependency {dep!r}")

    for path, keys in (
        (".github/labels.json", ("name", "color", "description")),
        (".github/milestones.json", ("title", "description")),
    ):
        manifest = read_json(path)
        if not isinstance(manifest, list):
            fail(f"{path} must be an array")
        for i, item in enumerate(manifest):
            if not isinstance(item, dict) or any(k not in item for k in keys):
                fail(f"{path}[{i}] is missing a required key")

    psx = (ROOT / "psx.yml").read_text(encoding="utf-8")
    for token in ("version: 1", "type: generic", "kind: app", "custom:", "folders:"):
        if token not in psx:
            fail(f"psx.yml lacks {token!r}")
    gix = (ROOT / ".gix/config").read_text(encoding="utf-8")
    for token in ('version: "1"', "remote: origin", "main:", "develop:", "feature:", "bugfix:", "hotfix:", "release:"):
        if token not in gix:
            fail(f".gix/config lacks {token!r}")

    markdown = [ROOT / "README.md", ROOT / "archive/README.md", *sorted((ROOT / "spec").glob("*.md"))]
    broken = []
    for source in markdown:
        for match in LINK_RE.finditer(source.read_text(encoding="utf-8")):
            target = match.group(1).strip().split()[0].strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith("#") or not parsed.path:
                continue
            local = (source.parent / unquote(parsed.path)).resolve()
            if not local.exists():
                broken.append(f"{source.relative_to(ROOT)} -> {target}")
    if broken:
        fail("broken local links:\n  " + "\n  ".join(broken))

    print("PASS: Shelf spec, archived catalog, PSX/GIX config, Pipeline graph, manifests, and local links")


if __name__ == "__main__":
    main()
