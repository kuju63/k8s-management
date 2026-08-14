<!-- markdownlint-disable -->
# CLAUDE.md / AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) and other coding agents when working with code in this repository.

## What this repo is

自宅 k8s クラスタの運用系・サービス系リソースを [cdk8s](https://cdk8s.io/) で宣言的に生成するリポジトリ。
`packages/main.ts` が cdk8s App を組み立て、`manifests/` 配下に namespace ごとの YAML を synth する。
生成物は Namespace・ArgoCD `Application`（App-of-Apps 方式）・MetalLB/Gateway API 等の設定用 CRD。
各コンポーネント本体（Prometheus/Grafana 等）はコードでは書かず、ArgoCD が Helm チャートを sync して導入する。

`manifests/` は git 管理対象で、ArgoCD の root Application（`packages/ns/argocd/index.ts` の`app-of-apps`）がこのディレクトリを再帰的に watch している。**つまり `pnpm run synth` の出力をcommit・push するところまでが一連の変更作業であり、`packages/ns/**` を編集しただけではクラスタに反映されない。**

## Commands

```sh
pnpm run synth   # packages/ を compile し、manifests/ を再生成するだけ
pnpm run apply   # synth した上で kubectl apply -R -f manifests/ まで行う
pnpm compile     # tsc --build のみ
```

テストは未整備（`pnpm test` はプレースホルダで常に失敗する）。lint/format は `lint-staged` 経由でpre-commit hook（husky）が実行し、package.json に個別の lint スクリプトは無い。手動で走らせる場合:

```sh
pnpm exec biome check --write packages/   # format + lint
```

devShell（`direnv` 経由で `flake.nix` を自動読み込み。手動なら `nix develop`）に `kubectl`・`pnpm`・`gh`・`betterleaks` を含む。対象クラスタの kubeconfig context は devShell が用意するものではなく、別途セットアップが必要。

## Architecture

### namespace 単位の Chart

`packages/ns/<namespace>/index.ts` が1ファイル1 `Chart` サブクラス（cdk8s の `Chart`）に対応し、synth 時に `manifests/<namespace>.k8s.yaml` を1ファイル生成する。新規 namespace を追加する際は`packages/main.ts` の `buildApp()` に `new XxxChart(app);` の追加が必須（登録しないと synth 対象にならない）。

#### 既存 Chart 一覧と役割:

- `argocd`
  App-of-Apps の root`createDirectoryApplication` で `manifests/` 自身を watch する
  Application と、ArgoCD 自身を self-managing する Helm Application を持つ
- `metallb-system` / `envoy-gateway-system`
  クラスタの入口（LoadBalancer IP 払い出し・Gateway API のリクエストルーティング）
- `actions-runner-system` / `arc-runners`
  GitHub Actions self-hosted runner。GitHub 公式推奨に沿い、常駐 Controller（前者）と ephemeral な Runner 本体（後者）を namespace 分離している
- `monitoring`
  Prometheus/Grafana/Loki/Alloy/Jaeger
  運用・監視系のサービス

### `packages/lib/` のヘルパー

`packages/lib/argocd-application.ts` が ArgoCD `Application` リソースを生成する4つの関数を提供する
（詳細と使い分けは [docs/applications.md](docs/applications.md)）。

- `createHelmApplication`
  upstream Helm チャートを source にする。最も基本的なパターン
- `createGitApplication`
  任意の git リポジトリのディレクトリを source にする
- `createDirectoryApplication`
  このリポジトリ自身のディレクトリを source にする
  （`createGitApplication` を `GIT_REPO_URL`/`GIT_TARGET_REVISION` 固定で呼ぶラッパー）。
  App-of-Apps root 専用で、通常の namespace 追加では使わない
- `createContainerApplication`
  コンテナイメージから直接 Deployment/Service を作る。内部でbjw-s-labs/app-template という汎用 Helm チャートを `createHelmApplication` 経由でラップしており、呼び出し側は Helm チャートの存在を意識しなくてよい。`targetRevision` はこのラッパーの中ではapp-template チャート自体のバージョンを指す点に注意（アプリのバージョンは `image.tag` 側）

これら4関数が生成する Application はすべて `syncPolicy.automated.prune: true` /
`selfHeal: true` が固定。**コード上の定義を削除して push することが、リソース削除の唯一の正規手順**（`kubectl delete` を単体で行っても selfHeal で復活する）。詳細は[docs/resource-deletion.md](docs/resource-deletion.md)。

`packages/lib/namespace.ts` の `createNamespace` は Namespace リソースを1個作るだけの薄いヘルパー。
CronJob/Job/ConfigMap/HTTPRoute 等、専用ヘルパーの無いリソースは cdk8s の生の `ApiObject` で直接記述する（各 Chart の実装例を参照）。

`packages/lib/config.ts` に、`GATEWAY_NAME`/`GATEWAY_NAMESPACE`/`CLUSTER_DOMAIN`（HTTPRoute の`parentRefs`/`hostnames` 共通値）や `METALLB_ADDRESS_RANGE` など、複数 Chart にまたがる共有定数を集約している。

### cdk8s synth の制約

`App.synth()` はその時点で App に登録されている Chart についてのみファイルを書き込み、`outdir`（`manifests/`）内の古いファイルを削除するクリーンアップは行わない。namespace を丸ごと削除する際は`packages/main.ts` からの登録解除に加え、対応する`manifests/<namespace>.k8s.yaml` を明示的に`git rm` する必要がある。

### Secret の扱い

SOPS/sealed-secrets/external-secrets のような暗号化・外部連携の仕組みは導入していない。`manifests/`は git 管理対象のため、**Secret の実体（`stringData`/`data`）をコードに書いてはいけない**。コード側は事前に `kubectl` 等で作成済みの Secret 名のみを参照する（`packages/ns/arc-runners/index.ts` が実例）。
詳細は [docs/config-and-secrets.md](docs/config-and-secrets.md)。

### ブートストラップ順序の制約

ArgoCD 自体はこのリポジトリのコードだけでは導入できない（Application を解釈するコントローラが存在しないクラスタに Application だけ投入しても効果が無いため）。ArgoCD 本体の初回インストールとroot Application の初回 apply だけは手動作業になる。手順は [README.md](README.md) を参照。

## ドキュメント

リソース種別ごとの作成・削除手順は `docs/` 配下に分かれている。新しい種類のリソースを追加する前に該当ドキュメントを確認すること。

- [docs/applications.md](docs/applications.md)
  ArgoCD Application の4パターンの使い分けとHTTPRoute の追加方法
- [docs/jobs.md](docs/jobs.md)
  CronJob/Job を生の `ApiObject` で書く方法
- [docs/config-and-secrets.md](docs/config-and-secrets.md)
  ConfigMap/Secret の運用方針
- [docs/resource-deletion.md](docs/resource-deletion.md)
  namespace 丸ごと削除・個別リソース削除・緊急時の手動削除の注意点

## Skills

`.claude/skills/helm-chart-version-check/`
  `packages/ns/**/index.ts` 内の `createHelmApplication(...)`呼び出しの `targetRevision` を実際の Helm リポジトリ/OCI レジストリの最新版と比較し、パッチ/マイナー更新は自動反映、メジャー更新は警告コメント挿入に留めるプロジェクトスキル。`createContainerApplication`経由の呼び出しは文字列マッチの都合で検出対象外。
