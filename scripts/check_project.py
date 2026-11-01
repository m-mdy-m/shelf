#!/usr/bin/env python3
"""Validate Shelf's specification-first repository using Python's standard library."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    "README.md",
    "LICENSE",
    "psx.yml",
    ".gix/config",
    "pipeline.toml",
    "Makefile",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/sync-project-metadata.yml",
    ".github/labels.json",
    ".github/milestones.json",
    ".github/issue-metadata.json",
    "archive/README.md",
    "archive/catalog.json",
    "archive/SCHEMA.md",
    "spec/README.md",
    "spec/00-product-brief.md",
    "spec/01-architecture.md",
    "spec/02-reader-engine.md",
    "spec/03-ai-companion.md",
    "spec/04-data-model.md",
    "spec/05-cross-platform.md",
    "spec/06-quality-security.md",
    "spec/07-roadmap.md",
    "spec/08-github-work-plan.md",
    "docs/README.md",
    "docs/product/README.md",
    "docs/architecture/README.md",
    "docs/development/README.md",
    "docs/decisions/README.md",
    "docs/web-assets.md",
    "apps/web/public/favicon.svg",
    "apps/web/public/site.webmanifest",
    "apps/web/public/robots.txt",
    "apps/web/public/brand/shelf-mark.svg",
    "apps/web/public/icons/shelf.svg",
    "scripts/check_project.py",
    "scripts/sync_github_metadata.py",
    "tests/README.md",
)
REQUIRED_DIRS = (
    "apps/web/src",
    "apps/web/public",
    "apps/desktop",
    "apps/mobile",
    "packages/reader-core",
    "packages/pdf-engine",
    "packages/selection",
    "packages/annotations",
    "packages/ai-contracts",
    "packages/platform-adapters",
    "backend/cmd/shelf",
    "backend/internal/domain",
    "backend/internal/application",
    "backend/internal/ports",
    "backend/internal/adapters/storage",
    "backend/internal/adapters/ai",
    "tests/unit",
    "tests/integration",
    "tests/e2e",
    "tests/fixtures/pdf",
)
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: str):
    try:
        return json.loads((ROOT / path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{path} is invalid JSON: {exc}")


def check_required_paths() -> None:
    missing_files = [path for path in REQUIRED_FILES if not (ROOT / path).is_file()]
    missing_dirs = [path for path in REQUIRED_DIRS if not (ROOT / path).is_dir()]
    if missing_files:
        fail("required files missing: " + ", ".join(missing_files))
    if missing_dirs:
        fail("required directories missing: " + ", ".join(missing_dirs))


def check_archive() -> None:
    catalog = load_json("archive/catalog.json")
    if not isinstance(catalog, dict) or not catalog.get("version") or not isinstance(catalog.get("books"), list):
        fail("archived catalog must retain version and a top-level books array")
    schema = (ROOT / "archive/SCHEMA.md").read_text(encoding="utf-8")
    if "TechShelf Catalog Schema" not in schema:
        fail("archived schema does not match the preserved catalog schema")


def check_pipeline() -> None:
    try:
        config = tomllib.loads((ROOT / "pipeline.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"pipeline.toml is invalid: {exc}")
    if config.get("schema_version") != 1:
        fail("pipeline.toml schema_version must be 1")
    tasks = config.get("tasks", {})
    for name in ("project-check", "compile", "check", "ci"):
        if name not in tasks:
            fail(f"pipeline.toml is missing task {name!r}")
    for name, task in tasks.items():
        command = task.get("command")
        if not isinstance(command, list) or not command or not all(isinstance(part, str) and part for part in command):
            fail(f"pipeline task {name!r} needs a non-empty command array")
        for dependency in task.get("depends_on", []):
            if dependency not in tasks:
                fail(f"pipeline task {name!r} depends on unknown task {dependency!r}")


def check_github_manifests() -> None:
    labels = load_json(".github/labels.json")
    milestones = load_json(".github/milestones.json")
    issues = load_json(".github/issue-metadata.json")
    if not isinstance(labels, list) or not isinstance(milestones, list) or not isinstance(issues, dict):
        fail("GitHub metadata manifests have invalid top-level types")

    label_names = set()
    for item in labels:
        if not all(key in item for key in ("name", "color", "description")):
            fail("every label needs name, color, and description")
        if item["name"] in label_names:
            fail(f"duplicate label name: {item['name']}")
        label_names.add(item["name"])

    milestone_titles = set()
    for item in milestones:
        if not all(key in item for key in ("title", "description")):
            fail("every milestone needs title and description")
        if item["title"] in milestone_titles:
            fail(f"duplicate milestone title: {item['title']}")
        milestone_titles.add(item["title"])

    for issue_number, item in issues.items():
        if not all(key in item for key in ("labels", "milestone", "assignees")):
            fail(f"issue metadata #{issue_number} is incomplete")
        if item["milestone"] not in milestone_titles:
            fail(f"issue #{issue_number} references unknown milestone {item['milestone']}")
        if not item["assignees"]:
            fail(f"issue #{issue_number} has no assignee")
        for label in item["labels"]:
            if label not in label_names:
                fail(f"issue #{issue_number} references unknown label {label}")


def check_psx_gix() -> None:
    psx = (ROOT / "psx.yml").read_text(encoding="utf-8")
    for token in ("version: 1", "type: generic", "kind: app", "custom:", "folders:", "public:"):
        if token not in psx:
            fail(f"psx.yml is missing {token!r}")

    gix = (ROOT / ".gix/config").read_text(encoding="utf-8")
    for token in ('version: "1"', "remote: origin", "main:", "develop:", "feature:", "bugfix:", "hotfix:", "release:"):
        if token not in gix:
            fail(f".gix/config is missing {token!r}")


def check_public_assets() -> None:
    manifest = load_json("apps/web/public/site.webmanifest")
    if manifest.get("name") != "Shelf" and not str(manifest.get("name", "")).startswith("Shelf"):
        fail("web manifest name must identify Shelf")
    if manifest.get("display") != "standalone":
        fail("web manifest display must be standalone")
    if not manifest.get("icons"):
        fail("web manifest must declare at least one icon")
    for icon in manifest["icons"]:
        path = icon.get("src", "").lstrip("/")
        if not path or not (ROOT / "apps/web/public" / path).is_file():
            fail(f"web manifest icon is missing: {icon.get('src')}")


def check_markdown_links() -> None:
    markdown_files = [
        ROOT / "README.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "archive/README.md",
        *sorted((ROOT / "spec").glob("*.md")),
        *sorted((ROOT / "docs").rglob("*.md")),
    ]
    broken: list[str] = []
    for source in markdown_files:
        content = source.read_text(encoding="utf-8")
        for match in LINK_RE.finditer(content):
            target = match.group(1).strip().split()[0].strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith("#") or not parsed.path:
                continue
            path = (source.parent / unquote(parsed.path)).resolve()
            if not path.exists():
                broken.append(f"{source.relative_to(ROOT)} -> {target}")
    if broken:
        fail("broken local Markdown links:\n  " + "\n  ".join(broken))


def main() -> None:
    check_required_paths()
    check_archive()
    check_pipeline()
    check_github_manifests()
    check_psx_gix()
    check_public_assets()
    check_markdown_links()
    print("PASS: Shelf docs, archive, public assets, PSX/GIX config, Pipeline graph, and GitHub manifests")


if __name__ == "__main__":
    main()
