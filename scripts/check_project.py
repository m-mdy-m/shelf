#!/usr/bin/env python3
"""Validate Shelf's specification-first repository using the Python standard library."""
from __future__ import annotations
import json, re, sys, tomllib
from pathlib import Path
from urllib.parse import unquote, urlsplit
ROOT=Path(__file__).resolve().parents[1]
REQUIRED=(
"README.md","LICENSE","psx.yml",".gix/config","pipeline.toml",
".github/PULL_REQUEST_TEMPLATE.md",".github/ISSUE_TEMPLATE/bug_report.yml",
".github/ISSUE_TEMPLATE/feature_request.yml",".github/workflows/ci.yml",
".github/workflows/sync-project-metadata.yml",".github/labels.json",
".github/milestones.json",".github/issue-metadata.json",
"archive/README.md","archive/catalog.json","archive/SCHEMA.md",
"spec/README.md","spec/00-product-brief.md","spec/01-architecture.md",
"spec/02-reader-engine.md","spec/03-ai-companion.md","spec/04-data-model.md",
"spec/05-cross-platform.md","spec/06-quality-security.md","spec/07-roadmap.md",
"spec/08-github-work-plan.md")
LINK_RE=re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
def fail(msg):
 print(f"FAIL: {msg}",file=sys.stderr); raise SystemExit(1)
def load_json(path):
 try: return json.loads((ROOT/path).read_text(encoding="utf-8"))
 except (OSError,json.JSONDecodeError) as exc: fail(f"{path} is invalid JSON: {exc}")
def main():
 missing=[p for p in REQUIRED if not (ROOT/p).is_file()]
 if missing: fail("missing files: "+", ".join(missing))
 catalog=load_json("archive/catalog.json")
 if not isinstance(catalog,dict) or not catalog.get("version") or not isinstance(catalog.get("books"),list):
  fail("archived catalog must retain version and top-level books array")
 schema=(ROOT/"archive/SCHEMA.md").read_text(encoding="utf-8")
 if "TechShelf Catalog Schema" not in schema: fail("archived schema does not match original TechShelf schema")
 cfg=tomllib.loads((ROOT/"pipeline.toml").read_text(encoding="utf-8")); tasks=cfg.get("tasks",{})
 for name in ("project-check","compile","check","ci"):
  if name not in tasks: fail(f"pipeline.toml missing task {name}")
 for name,task in tasks.items():
  cmd=task.get("command")
  if not isinstance(cmd,list) or not cmd or not all(isinstance(x,str) and x for x in cmd):
   fail(f"pipeline task {name} requires a non-empty command array")
  for dep in task.get("depends_on",[]):
   if dep not in tasks: fail(f"pipeline task {name} has unknown dependency {dep}")
 for path,keys in ((".github/labels.json",("name","color","description")),
                   (".github/milestones.json",("title","description")),
                   (".github/issue-metadata.json",("labels","milestone","assignees"))):
  data=load_json(path)
  if not isinstance(data,(list,dict)): fail(f"{path} must be an object or array")
  rows=data.values() if isinstance(data,dict) else data
  for i,item in enumerate(rows):
   if not isinstance(item,dict) or any(k not in item for k in keys): fail(f"{path}[{i}] missing required keys")
 psx=(ROOT/"psx.yml").read_text(encoding="utf-8")
 for token in ("version: 1","type: generic","kind: app","custom:","folders:"):
  if token not in psx: fail(f"psx.yml missing {token}")
 gix=(ROOT/".gix/config").read_text(encoding="utf-8")
 for token in ('version: "1"',"remote: origin","main:","develop:","feature:","bugfix:","hotfix:","release:"):
  if token not in gix: fail(f".gix/config missing {token}")
 markdown=[ROOT/"README.md",ROOT/"archive/README.md",*sorted((ROOT/"spec").glob("*.md"))]
 broken=[]
 for source in markdown:
  for match in LINK_RE.finditer(source.read_text(encoding="utf-8")):
   target=match.group(1).strip().split()[0].strip("<>"); parsed=urlsplit(target)
   if parsed.scheme or target.startswith("#") or not parsed.path: continue
   if not (source.parent/unquote(parsed.path)).resolve().exists():
    broken.append(f"{source.relative_to(ROOT)} -> {target}")
 if broken: fail("broken local links:\n  "+"\n  ".join(broken))
 print("PASS: Shelf spec, archive, PSX/GIX config, Pipeline graph, metadata manifests, and local links")
if __name__=="__main__": main()
