---
name: helm-chart-version-check
description: >-
  k8s-managementリポジトリの packages/ns/**/index.ts にある createHelmApplication(...)
  呼び出しの targetRevision（Helmチャートのバージョン、またはOCIタグ）を検出し、実際の
  Helmリポジトリ（index.yaml）やdocker.io/ghcr.ioのOCIレジストリ上の最新安定版と比較する。
  パッチ/マイナー更新は targetRevision の値を自動で書き換え、メジャー更新は値を変えずに
  直後へ警告コメントを挿入し、最後にメジャー更新が発生した Application 一覧をMarkdown表
  で報告する。ユーザーが「Helmチャートのバージョンを確認して」「targetRevisionを最新化
  して」「ArgoCD ApplicationのHelm依存を更新チェックして」「依存関係のアップデート確認」
  「envoy-gatewayの最新版と比較して」のように言った場合は必ずこのスキルを使うこと。
  createGitApplication（targetRevision: "main" 固定のGitソース）や
  createDirectoryApplication は対象外。createContainerApplication（内部で
  createHelmApplication をラップするコンテナ用ヘルパー）も、呼び出し側コードに
  createHelmApplication(...) という文字列が現れないため現状のスキャナでは
  検出できず対象外。
---
<!-- markdownlint-disable -->
# Helm チャートバージョンチェック

`packages/lib/argocd-application.ts` の `createHelmApplication` 経由で生成している
ArgoCD Application の `targetRevision`（Helm チャートのバージョン、または OCI タグ）を
巡回し、実際のリポジトリ上の最新安定版と比較する。パッチ/マイナー更新は自動で反映し、
メジャー更新は breaking change のリスクがあるため**値を書き換えず**警告コメントで
可視化するだけに留める。

`createContainerApplication`（コンテナイメージ用ヘルパー、内部で `createHelmApplication`
を呼び出している）はスキャナの検出対象外。`ts_scanner.py` の `CALL_RE` が
`createHelmApplication(` という文字列を直接検出する実装のため、別名関数経由の
呼び出しは拾えない。対応が必要になった場合は `CALL_RE` の複数関数名対応と、
`repoUrl` が呼び出し側に現れない分の暗黙値フォールバックを追加すること。

`scripts/` 配下の CLI は `scan` → `resolve` → `apply` → `report` の4段階に分かれている。
ネットワークアクセスが発生するのは `resolve` だけ。各段階の出力は中間ファイルとして
確認しながら進めること。

## 手順

1. **呼び出し箇所スキャン**（ネットワーク不使用）
   ```bash
   python3 .claude/skills/helm-chart-version-check/scripts/helm_versions.py scan \
     --root . --out /tmp/helm-scan.json
   ```
   `packages/ns/**/index.ts` から `createHelmApplication` の呼び出しを検出する。
   現時点で9件前後のレコードが出力されるはず。`warnings` が付いたレコードがあれば、
   対象コードが想定外の書き方になっている可能性があるので中身を確認すること。

2. **各chartの最新バージョン取得**（ここで初めてネットワークアクセス）
   ```bash
   python3 .claude/skills/helm-chart-version-check/scripts/helm_versions.py resolve \
     --in /tmp/helm-scan.json --out /tmp/helm-resolved.json
   ```
   各レコードに `latest`（最新安定版）と `kind`（`none`/`patch`/`minor`/`major`/
   `downgrade`/`error`）が付与される。個別チャートの取得に失敗しても全体は止まらず
   `kind: "error"` として記録されるだけなので、`resolve` 後に `error` レコードが
   無いか確認すること（レジストリ側の一時的な不調、chart名変更などが疑われる）。
   詳細な取得ロジック（OCI Distribution API・index.yaml走査）は
   `references/registries.md` を参照。

3. **比較結果の確認**
   `resolved.json` の `kind` を見れば、各チャートが最新か・更新が必要かが分かる。
   何もアクションせずレポートだけ欲しい場合はここで手順6の `report` に進んでよい。

4. **ファイル書き換え / 警告コメント挿入**
   ```bash
   python3 .claude/skills/helm-chart-version-check/scripts/helm_versions.py apply \
     --root . --in /tmp/helm-resolved.json
   ```
   - `patch`/`minor`: `targetRevision` の値をその場で書き換える（承認不要で自動実行してよい）。
   - `major`: 値は変えず、直後に警告コメントを冪等に挿入/更新する（書式は
     `references/comment-format.md` を参照）。値が既に手動でメジャー更新された後は
     陳腐化したコメントを自動で削除する。
   - `error`: そのレコードのファイルは一切触らない。
   標準出力にメジャー更新一覧のMarkdown表（手順6と同じ内容）が出るので、そのまま
   使い回せる。標準エラー出力に実際に書き換えたファイル一覧が出る。

5. **日付コメントの更新**（スクリプトの範囲外・人手判断が必要）
   多くの呼び出し箇所には `// targetRevision: YYYY-MM-DD 時点の...` のような日本語の
   基準日コメントが添えられている（ファイルによって書き方が微妙に異なる）。`apply` は
   この自然文コメントには触れないので、実際に targetRevision を書き換えた箇所については
   Edit ツールで当日の日付に更新すること。

6. **書き換え後の検証**
   ```bash
   pnpm compile
   ```
   TypeScript として壊れていないことを確認する。失敗した場合は、どの書き換えが原因か
   特定して修正すること（`git diff` で変更箇所を確認できる）。

7. **メジャー更新一覧のレポート**
   ```bash
   python3 .claude/skills/helm-chart-version-check/scripts/helm_versions.py report \
     --in /tmp/helm-resolved.json
   ```
   （`apply` を実行した場合は手順4の出力を使い回してよく、この手順は単独で再実行しなくてよい）
   出力される Markdown 表をそのままユーザーに提示する。メジャー更新が無ければ
   「メジャーバージョン更新はありませんでした」という行になる。取得エラーが
   あった場合は表の下に別セクションとして併記されるので、それも忘れずに伝えること
   （エラーで確認できなかったチャートを「更新なし」と誤解させないため）。

## 注意点

- `pyyaml` のような外部ライブラリはインストール不要。`scripts/` 配下はすべて
  Python 標準ライブラリのみで動く。
- `resolve` は同一の `(repoUrl, chart)` の組み合わせを1回だけフェッチする
  （`monitoring/index.ts` のように複数チャートが同じリポジトリを参照していても
  重複アクセスしない）。
- 1ファイルに複数の `createHelmApplication` 呼び出しがあっても（例:
  `monitoring/index.ts` の4箇所）、`apply` は絶対文字オフセットに基づいて全編集を
  1回のパスで適用するため、行ズレで壊れることはない。
- `--versions-from <json>` を `resolve` に渡すと、ネットワークアクセス無しで
  固定のバージョン情報から動作確認できる（`evals/fixtures/` にオフラインテスト
  用の例がある）。
