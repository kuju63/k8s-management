"""targetRevision の安全な書き換えと、メジャー更新警告コメントの冪等な挿入/更新/削除。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from ts_scanner import CallSite

MAJOR_MARKER = "⚠ メジャーバージョン更新あり:"
_MAJOR_COMMENT_RE = re.compile(r'^(?P<indent>[ \t]*)//\s*' + re.escape(MAJOR_MARKER) + r'\s*"(?P<ver>[^"]+)"')


@dataclass
class Edit:
    start: int
    end: int
    replacement: str


def apply_edits(source: str, edits: list[Edit]) -> str:
    """絶対オフセットに基づく複数編集を、昇順ソート後の単一パスで適用する。
    行番号ベースの逐次置換だと1つ目の編集で後続のオフセットがズレて壊れるため、
    必ず元のソース文字列に対するオフセットを使い、1回で再構築する。"""
    ordered = sorted(edits, key=lambda e: e.start)
    out: list[str] = []
    cursor = 0
    for e in ordered:
        if e.start < cursor:
            raise ValueError(f"overlapping edits detected at offset {e.start}")
        out.append(source[cursor : e.start])
        out.append(e.replacement)
        cursor = e.end
    out.append(source[cursor:])
    return "".join(out)


def _existing_major_comment(source: str, line_start: int) -> Optional[tuple[int, int, str]]:
    """line_start から始まる行が既存のメジャー更新警告コメントであれば
    (line_start, line_end_including_newline, version) を返す。それ以外は None。"""
    nl_idx = source.find("\n", line_start)
    line_end = nl_idx + 1 if nl_idx != -1 else len(source)
    line = source[line_start : nl_idx if nl_idx != -1 else len(source)]
    m = _MAJOR_COMMENT_RE.match(line)
    if not m:
        return None
    return line_start, line_end, m.group("ver")


def plan_edits_for_site(call_site: CallSite, source: str, latest: str, kind: str) -> list[Edit]:
    """1つの createHelmApplication 呼び出しに対して適用すべき Edit のリストを返す。
    kind: 'patch' | 'minor' | 'major' | 'none' | 'downgrade' | 'error'
    """
    if call_site.tr_value_span is None or call_site.tr_line_end is None:
        return []

    existing = _existing_major_comment(source, call_site.tr_line_end)

    if kind in ("patch", "minor"):
        edits = [Edit(call_site.tr_value_span[0], call_site.tr_value_span[1], latest)]
        if existing is not None:
            # 今回の更新で major 警告が解消されたので、陳腐化したコメントを削除する。
            edits.append(Edit(existing[0], existing[1], ""))
        return edits

    if kind == "major":
        comment_text = (
            f'{call_site.tr_indent}// {MAJOR_MARKER} "{latest}" '
            "(要確認: リリースノート等でbreaking changeを確認してから手動更新すること)\n"
        )
        if existing is None:
            return [Edit(call_site.tr_line_end, call_site.tr_line_end, comment_text)]
        if existing[2] == latest:
            return []  # 既に同一バージョンの警告あり。冪等に何もしない。
        return [Edit(existing[0], existing[1], comment_text)]

    # none / downgrade / error: targetRevision の値は触らない。
    # ただし kind が 'error' の場合はフェッチ失敗であり判断材料が無いため、
    # 既存の major 警告コメントであっても削除しない（stale判定を避ける）。
    if existing is not None and kind != "error":
        return [Edit(existing[0], existing[1], "")]
    return []
