#!/usr/bin/env python3
"""Idempotently create/update GitHub labels, milestones, issue labels and assignments."""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
ROOT=Path(__file__).resolve().parents[1]
API="https://api.github.com"; REPO=os.environ.get("GITHUB_REPOSITORY",""); TOKEN=os.environ.get("GITHUB_TOKEN","")
def api(method,path,payload=None):
 data=None if payload is None else json.dumps(payload).encode()
 req=Request(API+path,data=data,method=method,headers={"Accept":"application/vnd.github+json","Authorization":f"Bearer {TOKEN}","X-GitHub-Api-Version":"2022-11-28","User-Agent":"shelf-metadata-sync","Content-Type":"application/json"})
 try:
  with urlopen(req,timeout=30) as response:
   raw=response.read(); return json.loads(raw) if raw else None
 except HTTPError as exc:
  raise RuntimeError(f"{method} {path}: HTTP {exc.code}: {exc.read().decode(errors='replace')}") from exc
 except URLError as exc: raise RuntimeError(f"GitHub API connection failed: {exc}") from exc
def pages(path):
 out=[]; page=1
 while True:
  sep="&" if "?" in path else "?"; batch=api("GET",f"{path}{sep}per_page=100&page={page}")
  if not isinstance(batch,list): raise RuntimeError(f"Expected list response from {path}")
  out.extend(batch)
  if len(batch)<100:return out
  page+=1
def sync_labels():
 manifest=json.loads((ROOT/".github/labels.json").read_text()); old={x["name"]:x for x in pages(f"/repos/{REPO}/labels")}; count=0
 for row in manifest:
  name=row["name"]; body={"name":name,"color":row["color"].lstrip("#"),"description":row["description"]}; current=old.get(name)
  if current and current.get("color","").lower()==body["color"].lower() and current.get("description","")==body["description"]:continue
  if current: api("PATCH",f"/repos/{REPO}/labels/{quote(name,safe='')}",body)
  else: api("POST",f"/repos/{REPO}/labels",body)
  count+=1; time.sleep(.04)
 return count
def sync_milestones():
 manifest=json.loads((ROOT/".github/milestones.json").read_text()); old={x["title"]:x for x in pages(f"/repos/{REPO}/milestones?state=all")}; result={}; count=0
 for row in manifest:
  title=row["title"]; body={"title":title,"description":row["description"],"state":"open"}; current=old.get(title)
  if current:
   if current.get("description","")==body["description"] and current.get("state")=="open": result[title]=current["number"]; continue
   saved=api("PATCH",f"/repos/{REPO}/milestones/{current['number']}",body)
  else: saved=api("POST",f"/repos/{REPO}/milestones",body)
  result[title]=saved["number"]; count+=1; time.sleep(.04)
 return result,count
def sync_issues(milestones):
 manifest=json.loads((ROOT/".github/issue-metadata.json").read_text()); count=0
 for number,row in manifest.items():
  milestone=milestones.get(row["milestone"])
  if not milestone: raise RuntimeError(f"Missing milestone {row['milestone']} for issue #{number}")
  api("PATCH",f"/repos/{REPO}/issues/{number}",{"labels":row["labels"],"milestone":milestone,"assignees":row["assignees"]})
  count+=1; time.sleep(.04)
 return count
def main():
 if not REPO or not TOKEN: raise SystemExit("GITHUB_REPOSITORY and GITHUB_TOKEN are required")
 labels=sync_labels(); milestones,milestone_count=sync_milestones(); issues=sync_issues(milestones)
 print(f"Metadata synchronized: {labels} labels changed, {milestone_count} milestones changed, {issues} issues assigned/labeled/milestoned.")
if __name__=="__main__":
 try:main()
 except Exception as exc:print(f"ERROR: {exc}",file=sys.stderr);raise SystemExit(1)
