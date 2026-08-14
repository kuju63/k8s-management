# Git / PR コミュニケーション規約

## 概要

このリポジトリは private リポジトリであり、変更履歴の主な読者は将来の
自分と Coding Agent である。

コミットメッセージと PR は、変更内容だけでなく「なぜその変更をしたのか」を
後から追跡できるように書く。特に Kubernetes リソースの変更は、
`packages/` 側の定義と `manifests/` 側の生成物が対応するため、変更対象と
背景を明示する。

## Git コミットメッセージ

コミットメッセージは Conventional Commits に準拠し、英語で記載する。

```text
<type>: <description>

<body>
```

scope は使用しない。`feat(monitoring): ...` のような形式ではなく、
`feat: ...` のように書く。

既存履歴には scope 付きのコミットが含まれているが、今後のコミットでは
scope なしに統一する。

### type の使い分け

- `feat` — 新しい機能、リソース、Application、namespace の追加
- `fix` — バグ修正、誤った設定の修正
- `docs` — ドキュメントのみの変更
- `refactor` — 振る舞いを変えない構造整理
- `chore` — 依存関係更新、生成物更新、設定変更など
- `test` — テストの追加・修正
- `build` — ビルド、パッケージ、生成処理に関する変更
- `ci` — CI / GitHub Actions に関する変更

### description

`description` は命令形で簡潔に書く。

```text
docs: add Git and PR communication conventions
feat: add monitoring HTTPRoute
fix: correct Grafana service backend name
chore: update generated manifests
```

### body

body には、変更の背景と理由を記載する。何を変えたかだけでなく、なぜその
変更が必要だったのかを書く。

最低限、次の観点を含める。

- 変更前にどのような問題・不足があったか
- なぜこの変更方法を選んだか
- Kubernetes リソースに影響する場合、どの namespace / Application / manifest
  に影響するか

良い例は次のとおり。

```text
docs: add Git and PR communication conventions

Document the commit and PR rules for coding agents so future changes keep
consistent context in the repository history.

This repository is private and mostly maintained through coding agents, so the
body must explain why the change exists rather than only restating the diff.
```

悪い例は次のとおり。

```text
docs: update docs

Update docs.
```

この例は、何を更新したかも、なぜ必要だったかも後から判断できない。

## PR タイトル

PR タイトルは Conventional Commits に準拠する。コミットメッセージと同じく
英語で記載し、scope は使用しない。

```text
<type>: <description>
```

Issue と関連している場合でも、PR タイトルには Issue 番号を書かない。
Issue の関連付けは PR 本文に `Close` キーワードで記載する。

良い例は次のとおり。

```text
feat: add Loki log collection
```

悪い例は次のとおり。

```text
feat(monitoring): add Loki log collection (#123)
```

## PR 本文

PR 本文は日本語で記載する。PR タイトルのみ英語にする。

本文には次の内容を含める。

- 変更のサマリー
- 変更対象のリソース
- 変更理由・背景
- Issue と関連している場合は `Close #123` などの Close キーワード

GitHub の PR 本文テンプレートは
[`.github/pull_request_template.md`](../.github/pull_request_template.md) に置く。
PR 作成時はこのテンプレートに沿って本文を埋める。

Issue と関連しない場合は、`## 関連Issue` セクションの `Close #` 行を削除する。

## 参考

- Conventional Commits: <https://www.conventionalcommits.org/>
