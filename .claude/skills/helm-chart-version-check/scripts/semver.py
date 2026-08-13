"""Semver のパース・比較・安定版フィルタ。stdlib のみで完結する。"""

from __future__ import annotations

import re
from typing import NamedTuple, Optional

_SEMVER_RE = re.compile(
    r"^v?(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


class Version(NamedTuple):
    major: int
    minor: int
    patch: int
    prerelease: Optional[str]
    raw: str

    @property
    def key(self) -> tuple:
        return (self.major, self.minor, self.patch)


def parse(raw: str) -> Optional[Version]:
    if not raw:
        return None
    m = _SEMVER_RE.match(raw.strip())
    if not m:
        return None
    return Version(
        major=int(m.group("major")),
        minor=int(m.group("minor")),
        patch=int(m.group("patch")),
        prerelease=m.group("prerelease"),
        raw=raw.strip(),
    )


def is_stable(v: Version) -> bool:
    return v.prerelease is None


def max_stable(raw_versions: list[str]) -> Optional[Version]:
    """パース可能かつ安定版のみを対象に、(major, minor, patch) が最大のものを返す。
    候補が1件も無ければ None。"""
    candidates = [v for v in (parse(r) for r in raw_versions) if v is not None and is_stable(v)]
    if not candidates:
        return None
    return max(candidates, key=lambda v: v.key)


def diff_kind(current_raw: str, latest: Version) -> str:
    """current_raw と latest の関係を none/patch/minor/major/downgrade/error で返す。
    current_raw がパース不能な場合は 'error'。"""
    current = parse(current_raw)
    if current is None:
        return "error"
    if current.key == latest.key:
        return "none"
    if current.key > latest.key:
        return "downgrade"
    if current.major != latest.major:
        return "major"
    if current.minor != latest.minor:
        return "minor"
    return "patch"
