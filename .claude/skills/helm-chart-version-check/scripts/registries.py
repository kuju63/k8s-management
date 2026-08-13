"""OCI レジストリ (docker.io / ghcr.io) と通常の Helm リポジトリ (index.yaml) から
チャートの最新安定版バージョンを取得する。標準ライブラリのみで完結させる:
  - OCI 側は Docker/OCI Distribution API を直接叩く（helm/crane/oras 等の外部ツール不要）。
  - index.yaml 側は pyyaml を使わず、行ベースの簡易状態機械でストリーム走査する
    （OCI 側と依存関係を非対称にしないため、また index.yaml が数MB級のリポジトリでも
    全文をメモリに載せずに早期終了できるようにするため）。

いずれの関数も例外を外に投げず (latest_version_or_None, error_message_or_None) を返す。
1チャートの取得失敗が呼び出し側の全体処理を止めないようにするための方針。
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Optional

import semver

_LINK_NEXT_RE = re.compile(r'<([^>]+)>;\s*rel="next"')
_ENTRIES_RE = re.compile(r"^entries:\s*$")
_CHART_BOUNDARY_RE = re.compile(r"^ {2}([^\s:-][^:]*):\s*$")
_VERSION_LINE_RE = re.compile(r"^ {4}version:\s*[\"']?([^\"'\s][^\"'\n]*?)[\"']?\s*$")

_DEFAULT_TIMEOUT = 15


def fetch_latest_oci_tag(repo_url: str, timeout: int = _DEFAULT_TIMEOUT) -> tuple[Optional[str], Optional[str]]:
    """repo_url は 'oci://docker.io/envoyproxy/gateway-helm' の形式。"""
    try:
        registry, repo = _split_oci_url(repo_url)
    except ValueError as e:
        return None, str(e)

    try:
        token = _get_anonymous_token(registry, repo, timeout)
        tags = _list_all_tags(registry, repo, token, timeout)
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code} while listing tags for {repo_url}"
    except urllib.error.URLError as e:
        return None, f"network error while listing tags for {repo_url}: {e.reason}"
    except TimeoutError:
        return None, f"timeout while listing tags for {repo_url}"

    stable = semver.max_stable(tags)
    if stable is None:
        return None, f"no semver-looking stable tags found for {repo_url} ({len(tags)} tags total)"
    return stable.raw, None


def _split_oci_url(repo_url: str) -> tuple[str, str]:
    if not repo_url.startswith("oci://"):
        raise ValueError(f"not an OCI url: {repo_url}")
    rest = repo_url[len("oci://") :]
    if "/" not in rest:
        raise ValueError(f"OCI url has no repository path: {repo_url}")
    registry, repo = rest.split("/", 1)
    return registry, repo


def _get_anonymous_token(registry: str, repo: str, timeout: int) -> str:
    if registry == "docker.io":
        url = f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull"
    elif registry == "ghcr.io":
        url = f"https://ghcr.io/token?scope=repository:{repo}:pull&service=ghcr.io"
    else:
        raise ValueError(f"unsupported OCI registry: {registry}")
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        body = json.load(resp)
    return body["token"]


def _list_all_tags(registry: str, repo: str, token: str, timeout: int, max_pages: int = 20) -> list[str]:
    host = "registry-1.docker.io" if registry == "docker.io" else registry
    url = f"https://{host}/v2/{repo}/tags/list"
    tags: list[str] = []

    for _ in range(max_pages):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.load(resp)
            tags.extend(body.get("tags") or [])
            link_header = resp.headers.get("Link")

        next_url = _parse_link_header(link_header, host)
        if not next_url:
            break
        url = next_url

    return tags


def _parse_link_header(link_header: Optional[str], host: str) -> Optional[str]:
    if not link_header:
        return None
    m = _LINK_NEXT_RE.search(link_header)
    if not m:
        return None
    next_ref = m.group(1)
    if next_ref.startswith("http"):
        return next_ref
    return f"https://{host}{next_ref}"


def fetch_latest_helm_repo_version(
    repo_url: str, chart: str, timeout: int = _DEFAULT_TIMEOUT
) -> tuple[Optional[str], Optional[str]]:
    index_url = f"{repo_url.rstrip('/')}/index.yaml"
    try:
        req = urllib.request.Request(index_url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            versions = _scan_index_yaml_for_chart(resp, chart)
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code} while fetching {index_url}"
    except urllib.error.URLError as e:
        return None, f"network error while fetching {index_url}: {e.reason}"
    except TimeoutError:
        return None, f"timeout while fetching {index_url}"

    if versions is None:
        return None, f"chart '{chart}' not found in {index_url}"

    stable = semver.max_stable(versions)
    if stable is None:
        return None, f"no stable semver versions found for chart '{chart}' in {index_url}"
    return stable.raw, None


def _scan_index_yaml_for_chart(response, chart: str) -> Optional[list[str]]:
    """entries: -> <chart>: -> (4スペースインデントの) version: の行だけを収集する
    行ベース状態機械。対象チャートのセクションを通過し終えたら早期に走査を打ち切る。

    entries直下の各chartは複数バージョンのリストで、各バージョンのエントリは
    'dependencies:' のようなネストしたリストの中にも 'version:' フィールドを
    持ちうる（依存チャートのバージョン）。これを誤収集しないよう、対象チャート
    自身のトップレベルフィールドである「ちょうど4スペースインデント」の
    'version:' 行のみにマッチさせる（依存関係のversionは6スペース以上）。
    """
    state = "seek_entries"  # seek_entries -> in_entries -> (in_chart | skip_chart)
    versions: list[str] = []
    found_chart = False

    for raw_line in response:
        line = raw_line.decode("utf-8", errors="replace").rstrip("\n")

        if state == "seek_entries":
            if _ENTRIES_RE.match(line):
                state = "in_entries"
            continue

        boundary_match = _CHART_BOUNDARY_RE.match(line)
        if boundary_match:
            if state == "in_chart":
                # 対象チャートのセクションを通過し終えた。早期終了。
                break
            name = boundary_match.group(1)
            if name == chart:
                state = "in_chart"
                found_chart = True
            else:
                state = "skip_chart"
            continue

        if line and not line[0].isspace():
            # インデント無しの行 = entries セクションの終了。
            if state == "in_chart":
                break
            state = "seek_entries"
            continue

        if state == "in_chart":
            version_match = _VERSION_LINE_RE.match(line)
            if version_match:
                versions.append(version_match.group(1))

    if not found_chart:
        return None
    return versions
