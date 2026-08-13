"""createHelmApplication(...) 呼び出しブロックの検出。

TypeScript の AST パーサーには依存せず、文字オフセットベースの括弧対応スキャナで
呼び出しブロックの範囲を特定する。文字列リテラル / テンプレートリテラル
(`...${...}...` のネストを含む) の内側にある括弧はカウントしないため、
`valuesObject` のような深いネストや `configMap: { content: SOME_TEMPLATE_LITERAL }`
のような構造があっても壊れない。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

CALL_RE = re.compile(r"\bcreateHelmApplication\s*\(")


@dataclass
class CallSite:
    file: str
    id: Optional[str]
    name: Optional[str]
    repo_url: Optional[str]
    chart: Optional[str]
    target_revision: Optional[str]
    # targetRevision の値（クォートの内側）の絶対文字オフセット (start, end)。
    tr_value_span: Optional[tuple[int, int]]
    # targetRevision プロパティ行の直後（改行込み）の絶対オフセット。コメント挿入位置。
    tr_line_end: Optional[int]
    tr_indent: str
    warnings: list[str] = field(default_factory=list)


def _skip_string_or_template(source: str, i: int) -> int:
    """source[i] がクォート開始文字であることを前提に、対応する終端の次のインデックスを返す。"""
    quote = source[i]
    n = len(source)
    i += 1
    if quote != "`":
        while i < n:
            c = source[i]
            if c == "\\":
                i += 2
                continue
            if c == quote:
                return i + 1
            i += 1
        return n

    # テンプレートリテラル: ${...} のネストを追跡する。
    depth = 0
    while i < n:
        c = source[i]
        if c == "\\":
            i += 2
            continue
        if depth == 0:
            if c == "`":
                return i + 1
            if c == "$" and i + 1 < n and source[i + 1] == "{":
                depth = 1
                i += 2
                continue
            i += 1
        else:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            i += 1
    return n


def _find_matching_bracket(source: str, open_idx: int, open_ch: str, close_ch: str) -> int:
    """source[open_idx] == open_ch を前提に、対応する close_ch のインデックスを返す。
    見つからなければ -1。"""
    depth = 0
    i = open_idx
    n = len(source)
    while i < n:
        c = source[i]
        if c in ("'", '"', "`"):
            i = _skip_string_or_template(source, i)
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _split_top_level(source: str, start: int, end: int, sep: str = ",") -> list[tuple[int, int]]:
    """source[start:end] を深さ0でのsep出現位置で分割し、各セグメントの(start, end)を返す。
    文字列・テンプレートリテラルの内側と、ネストした ()[]{} の内側は分割対象にしない。"""
    segments = []
    depth = 0
    seg_start = start
    i = start
    while i < end:
        c = source[i]
        if c in ("'", '"', "`"):
            i = _skip_string_or_template(source, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == sep and depth == 0:
            segments.append((seg_start, i))
            seg_start = i + 1
        i += 1
    segments.append((seg_start, end))
    return segments


def _extract_string_field(
    source: str, fields: dict[str, tuple[int, int]], key: str
) -> tuple[Optional[str], Optional[tuple[int, int]]]:
    if key not in fields:
        return None, None
    value_start, value_end = fields[key]
    text = source[value_start:value_end]
    m = re.match(r"^([\"'])(.*)\1$", text, re.DOTALL)
    if not m:
        return None, None
    inner_start = value_start + 1
    inner_end = value_end - 1
    return m.group(2), (inner_start, inner_end)


def find_call_sites(source: str, file: str) -> list[CallSite]:
    sites: list[CallSite] = []

    for m in CALL_RE.finditer(source):
        open_paren = m.end() - 1
        close_paren = _find_matching_bracket(source, open_paren, "(", ")")
        if close_paren == -1:
            continue

        args = _split_top_level(source, open_paren + 1, close_paren, ",")
        if len(args) < 3:
            continue

        id_start, id_end = args[1]
        id_match = re.search(r"[\"']([^\"']*)[\"']", source[id_start:id_end])
        call_id = id_match.group(1) if id_match else None

        props_start, props_end = args[2]
        props_text = source[props_start:props_end]
        obj_open_rel = props_text.find("{")
        if obj_open_rel == -1:
            sites.append(
                CallSite(
                    file=file,
                    id=call_id,
                    name=None,
                    repo_url=None,
                    chart=None,
                    target_revision=None,
                    tr_value_span=None,
                    tr_line_end=None,
                    tr_indent="",
                    warnings=["3rd argument is not an object literal"],
                )
            )
            continue

        obj_open = props_start + obj_open_rel
        obj_close = _find_matching_bracket(source, obj_open, "{", "}")
        if obj_close == -1:
            continue

        prop_segments = _split_top_level(source, obj_open + 1, obj_close, ",")
        fields: dict[str, tuple[int, int]] = {}
        for seg_start, seg_end in prop_segments:
            seg = source[seg_start:seg_end]
            if not seg.strip():
                continue
            colon_idx = seg.find(":")
            if colon_idx == -1:
                continue
            key = seg[:colon_idx].strip()
            raw_value = seg[colon_idx + 1 :]
            leading_ws = len(raw_value) - len(raw_value.lstrip())
            trailing_stripped = raw_value.rstrip()
            value_abs_start = seg_start + colon_idx + 1 + leading_ws
            value_abs_end = value_abs_start + len(trailing_stripped) - leading_ws
            fields[key] = (value_abs_start, value_abs_end)

        name_val, _ = _extract_string_field(source, fields, "name")
        repo_url_val, _ = _extract_string_field(source, fields, "repoUrl")
        chart_val, _ = _extract_string_field(source, fields, "chart")
        tr_val, tr_span = _extract_string_field(source, fields, "targetRevision")

        warnings: list[str] = []
        if repo_url_val is None:
            warnings.append("repoUrl not found or not a string literal")
        if tr_val is None:
            warnings.append("targetRevision not found or not a string literal")

        tr_line_end = None
        tr_indent = ""
        if "targetRevision" in fields:
            _, value_end = fields["targetRevision"]
            value_start = fields["targetRevision"][0]
            line_start = source.rfind("\n", 0, value_start) + 1
            indent_match = re.match(r"[ \t]*", source[line_start:])
            tr_indent = indent_match.group(0) if indent_match else ""
            nl_idx = source.find("\n", value_end)
            tr_line_end = nl_idx + 1 if nl_idx != -1 else len(source)

        sites.append(
            CallSite(
                file=file,
                id=call_id,
                name=name_val,
                repo_url=repo_url_val,
                chart=chart_val,
                target_revision=tr_val,
                tr_value_span=tr_span,
                tr_line_end=tr_line_end,
                tr_indent=tr_indent,
                warnings=warnings,
            )
        )

    return sites
