<!-- markdownlint-disable -->
# レジストリからの最新版取得の仕組み

`scripts/registries.py` の詳細。デバッグや拡張が必要なときに読む。

## OCI レジストリ (docker.io / ghcr.io)

`repoUrl` が `oci://docker.io/...` や `oci://ghcr.io/...` の場合、Helm チャートは OCI
Distribution API 経由で配布されている。helm CLI 単体では OCI リポジトリのタグ一覧を
取得できず（特定バージョンを `helm pull` するだけ）、`crane`/`oras` のような外部ツール
を入れるのも重いため、Python 標準ライブラリ (`urllib`) だけで Distribution API を直接
叩く。

1. **匿名トークン取得**
   - docker.io: `GET https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull`
   - ghcr.io: `GET https://ghcr.io/token?scope=repository:{repo}:pull&service=ghcr.io`
   - レスポンスJSONの `token` フィールドを使う。
2. **タグ一覧取得**
   - `GET https://{host}/v2/{repo}/tags/list` に `Authorization: Bearer <token>` を付与。
   - docker.io の場合、実際にAPIを叩くホストは `registry-1.docker.io`（`docker.io` 自体ではない）。
   - レスポンスの `Link` ヘッダ（`<...>; rel="next"`）でページネーションされることがある。
     追従しないと、リリース頻度の高いリポジトリ（例: `gha-runner-scale-set`）で
     一部のタグしか見えず最新版を見落とす。`max_pages=20` を安全弁として設定している。
3. **最新版の決定**
   - 取得した全タグを `semver.max_stable()` に渡し、`(major, minor, patch)` が最大の
     安定版（prerelease サフィックス無し）を採用する。
   - `latest` タグや cosign 署名タグ (`sha256-....sig`) は semver としてパースできない
     ため自然に除外される。

失敗時は例外を投げず `(None, "エラー内容")` を返す。1チャートの取得失敗が全体の
`resolve` を止めないようにするための設計。

## 通常の Helm リポジトリ (`index.yaml`)

`{repoUrl}/index.yaml` を HTTP GET し、行ベースの状態機械でストリーム走査する。
**pyyaml は使わない。** 理由:

- OCI 側が stdlib のみで実装されているため、Helm リポジトリ側だけ外部ライブラリに
  依存すると、動く/動かないの分岐点が非対称になる。
- `index.yaml` の必要な部分（`entries: → <chart>: → version:`）は構造が単純で安定
  しており、YAMLの汎用機能（アンカー、マルチドキュメント等）は使われない。
- `prometheus-community` の index.yaml は 6MB 超あり、`yaml.safe_load()` で全文を
  メモリに載せてからパースするより、対象チャートのセクションを読み終えた時点で
  即座に打ち切れるストリーム走査の方が速く安全。

### 状態遷移

```
seek_entries --("entries:"を検出)--> in_entries
in_entries --(2スペースインデントのchart境界 == 対象chart)--> in_chart
in_entries --(2スペースインデントのchart境界 != 対象chart)--> skip_chart
skip_chart --(次のchart境界)--> in_entries に戻って再判定
in_chart --(次のchart境界 or entries終了)--> break（早期終了）
```

### ハマりどころ: リスト項目行との混同

`entries:` 配下は次のような構造になっている。

```yaml
entries:
  metallb:              # ← chart境界（2スペースインデント、ハイフン無し）
  - apiVersion: v2       # ← バージョンエントリの開始（2スペース + "- "）
    appVersion: v0.16.1
    dependencies:
    - condition: crds.enabled
      name: crds
      version: 0.16.1    # ← これは依存チャートのバージョン（6スペースインデント）
    version: 0.16.1       # ← これが対象チャート自身のバージョン（4スペースインデント固定）
```

chart境界の正規表現 `^ {2}([^\s:-][^:]*):\s*$` は先頭文字がハイフンでないことを
必須にしている。これが無いと `  - apiVersion: v2` のようなリスト項目の行を
次のチャートの境界と誤認し、対象チャートのバージョン一覧を1件も収集できずに
`skip_chart` へ抜けてしまう（実装時に実際に踏んだバグ）。

同様に、バージョン行の正規表現 `^ {4}version:` は**ちょうど4スペースのインデント**
に固定している。依存関係の `version:`（6スペース以上）を誤収集しないため。
