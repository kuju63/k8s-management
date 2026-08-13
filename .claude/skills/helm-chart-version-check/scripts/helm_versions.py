#!/usr/bin/env python3
"""createHelmApplication の targetRevision チェック/更新 CLI。

サブコマンド:
  scan    - packages/ns/**/index.ts から createHelmApplication 呼び出しを検出する（ネットワーク不使用）
  resolve - 各チャートの最新安定版を取得し、現在の targetRevision と比較する（ネットワークアクセスあり）
  apply   - resolve の結果に基づきファイルを書き換える（patch/minorは自動更新、majorは警告コメント挿入）
  report  - resolve の結果からメジャー更新一覧のMarkdown表を出力する（ファイル書き込みなし）

resolve は --versions-from <json> でオフライン動作できる（evals 用）。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import editor
import registries
import semver
import ts_scanner

_ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")


def _read_records(in_path: Optional[str]) -> list[dict]:
    if in_path:
        with open(in_path, encoding="utf-8") as f:
            return json.load(f)
    return json.load(sys.stdin)


def _write_records(records: list[dict], out_path: Optional[str]) -> None:
    text = json.dumps(records, ensure_ascii=False, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        print(text)


def cmd_scan(args: argparse.Namespace) -> None:
    pattern = os.path.join(args.root, "packages", "ns", "**", "index.ts")
    records: list[dict] = []
    for path in sorted(glob.glob(pattern, recursive=True)):
        rel_path = os.path.relpath(path, args.root)
        with open(path, encoding="utf-8") as f:
            source = f.read()
        for cs in ts_scanner.find_call_sites(source, rel_path):
            records.append(
                {
                    "file": cs.file,
                    "id": cs.id,
                    "name": cs.name,
                    "repo_url": cs.repo_url,
                    "chart": cs.chart,
                    "target_revision": cs.target_revision,
                    "tr_value_span": list(cs.tr_value_span) if cs.tr_value_span else None,
                    "tr_line_end": cs.tr_line_end,
                    "tr_indent": cs.tr_indent,
                    "warnings": cs.warnings,
                }
            )
    _write_records(records, args.out)


def _group_key(repo_url: str, chart: Optional[str]) -> str:
    return f"{repo_url}|{chart or ''}"


def cmd_resolve(args: argparse.Namespace) -> None:
    records = _read_records(args.in_path)

    versions_from = None
    if args.versions_from:
        with open(args.versions_from, encoding="utf-8") as f:
            versions_from = json.load(f)

    cache: dict[str, tuple[Optional[str], Optional[str]]] = {}

    for r in records:
        repo_url = r.get("repo_url")
        target_revision = r.get("target_revision")
        if not repo_url or not target_revision:
            r["latest"] = None
            r["kind"] = "error"
            r["error"] = "missing repo_url or target_revision (see warnings)"
            continue

        key = _group_key(repo_url, r.get("chart"))
        if key not in cache:
            if versions_from is not None:
                latest = versions_from.get(key)
                cache[key] = (latest, None) if latest else (None, f"no fixture entry for key '{key}'")
            elif repo_url.startswith("oci://"):
                cache[key] = registries.fetch_latest_oci_tag(repo_url)
            else:
                cache[key] = registries.fetch_latest_helm_repo_version(repo_url, r.get("chart") or "")

        latest, error = cache[key]
        r["latest"] = latest
        r["error"] = error
        if latest is None:
            r["kind"] = "error"
            continue

        latest_v = semver.parse(latest)
        if latest_v is None:
            r["kind"] = "error"
            r["error"] = f"fetched latest version '{latest}' is not valid semver"
            continue
        r["kind"] = semver.diff_kind(target_revision, latest_v)

    _write_records(records, args.out)


def cmd_apply(args: argparse.Namespace) -> None:
    records = _read_records(args.in_path)

    by_file: dict[str, list[dict]] = {}
    for r in records:
        by_file.setdefault(r["file"], []).append(r)

    changed_files: list[str] = []
    for file, recs in by_file.items():
        path = os.path.join(args.root, file)
        with open(path, encoding="utf-8") as f:
            source = f.read()

        call_sites = {cs.id: cs for cs in ts_scanner.find_call_sites(source, file)}

        edits: list[editor.Edit] = []
        for r in recs:
            cs = call_sites.get(r["id"])
            if cs is None:
                continue
            latest = r.get("latest") or r["target_revision"]
            edits.extend(editor.plan_edits_for_site(cs, source, latest, r["kind"]))

        if not edits:
            continue

        new_source = editor.apply_edits(source, edits)
        if new_source != source:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_source)
            changed_files.append(file)

    print(f"Updated {len(changed_files)} file(s):", file=sys.stderr)
    for f in changed_files:
        print(f"  - {f}", file=sys.stderr)

    print(_render_report(records))


def _render_report(records: list[dict]) -> str:
    majors = [r for r in records if r["kind"] == "major"]
    errors = [r for r in records if r["kind"] == "error"]

    template_path = os.path.join(_ASSETS_DIR, "major_update_report_template.md")
    with open(template_path, encoding="utf-8") as f:
        template = f.read()

    if majors:
        rows = "\n".join(
            "| {name} | {chart} | {current} | {latest} | {repo_url} |".format(
                name=r.get("name") or r["id"],
                chart=r.get("chart") or "(OCI)",
                current=r["target_revision"],
                latest=r["latest"],
                repo_url=r["repo_url"],
            )
            for r in majors
        )
    else:
        rows = "| (メジャーバージョン更新はありませんでした) | - | - | - | - |"

    out = template.replace("{{ROWS}}", rows)

    if errors:
        out += "\n\n## 取得エラー\n\n"
        for r in errors:
            out += f"- `{r['file']}` / `{r['id']}`: {r.get('error')}\n"

    return out


def cmd_report(args: argparse.Namespace) -> None:
    records = _read_records(args.in_path)
    print(_render_report(records))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("scan", help="createHelmApplication呼び出しを検出する")
    p_scan.add_argument("--root", required=True, help="リポジトリのルートディレクトリ")
    p_scan.add_argument("--out", help="出力先ファイル（省略時はstdout）")
    p_scan.set_defaults(func=cmd_scan)

    p_resolve = sub.add_parser("resolve", help="各チャートの最新版を取得し比較する")
    p_resolve.add_argument("--in", dest="in_path", help="scanの出力（省略時はstdin）")
    p_resolve.add_argument("--out", help="出力先ファイル（省略時はstdout）")
    p_resolve.add_argument(
        "--versions-from",
        help="ネットワークの代わりに使う {repoUrl|chart: latestVersion} 形式のJSON（evals用）",
    )
    p_resolve.set_defaults(func=cmd_resolve)

    p_apply = sub.add_parser("apply", help="targetRevisionを書き換える")
    p_apply.add_argument("--root", required=True, help="リポジトリのルートディレクトリ")
    p_apply.add_argument("--in", dest="in_path", help="resolveの出力（省略時はstdin）")
    p_apply.set_defaults(func=cmd_apply)

    p_report = sub.add_parser("report", help="メジャー更新一覧のMarkdown表を出力する")
    p_report.add_argument("--in", dest="in_path", help="resolveの出力（省略時はstdin）")
    p_report.set_defaults(func=cmd_report)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
