# CronJob / Job の作成方法

## 概要

`packages/lib/batch-job.ts` の `createCronJob` / `createJob` ヘルパーで
CronJob / Job リソースを生成する。

cdk8s の型付き import（`cdk8s-plus-*` や `cdk8s import` による
`imports/`）はこのリポジトリに導入されていない。
コンテナ仕様として`args`や`command`等を定義する場合がある。

ArgoCD の root Application（`app-of-apps`）は
`manifests/` を directory source・`recurse: true` で直接 watch している。
`packages/ns/<namespace>/index.ts` にヘルパーを呼び出すように追記すれば、
synth 時に `manifests/<namespace>.k8s.yaml` が更新される。
ArgoCD が自動的に sync を実行する。
`packages/ns/metallb-system/index.ts` のように生 `ApiObject` を Chart 内で
混在させて書くこともできる。

作成した CronJob / Job を削除する場合の手順は
[resource-deletion.md](./resource-deletion.md) を参照。

## CronJob のサンプル

新規 namespace の Chart 全体の例。Pod テンプレートは可読性のため
コンストラクタの外で `const` に切り出すスタイルを基本とする。

```ts
import { type App, Chart } from "cdk8s";
import { createNamespace } from "../../lib/namespace.js";
import { createCronJob } from "../../lib/batch-job.js";

const NAMESPACE = "example-batch";

const cleanupPodSpec = [
    {
        name: "cleanup",
        image: "example.registry/cleanup:1.0.0",
        command: ["/bin/sh", "-c", "echo cleanup"],
    },
];

export class ExampleBatchChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        createCronJob(this, "cronjob-example", {
            namespace: NAMESPACE,
            schedule: "0 3 * * *",
            successfulJobsHistoryLimit: 3,
            failedJobsHistoryLimit: 1,
            containers: cleanupPodSpec,
        });
    }
}
```

`app-config` の中身の作り方や `envFrom` の詳細、`app-secret` を事前に
作成する手順は [config-and-secrets.md](./config-and-secrets.md) を参照。

## Job のサンプル

単発実行のバッチ処理。上記と同じ Chart 内に追記する形。

```ts
const migratePodSpec = [
    {
        name: "migrate",
        image: "example.registry/migrate:1.0.0",
        args: ["migrate", "up"],
    },
];

createJob(this, "job-example", {
    namespace: NAMESPACE,
    backoffLimit: 3,
    containers: migratePodSpec,
});
```

## 主要フィールドの補足

- `schedule` — 標準の cron 書式（`分 時 日 月 曜日`）。既定では UTC 基準で
  評価される。ローカルタイムゾーンで動かしたい場合は `spec.timeZone` を
  追加で指定する
- `concurrencyPolicy` — `Allow`（既定・並行実行を許可）/ `Forbid`
  （前回の実行が残っていればスキップ）/ `Replace`（前回の実行を止めて
  新しい実行を開始）
- `successfulJobsHistoryLimit` / `failedJobsHistoryLimit` — 保持する
  Job 履歴の件数。省略時の既定値はそれぞれ 3 / 1
- `backoffLimit` — 失敗時の再試行回数の上限
- `activeDeadlineSeconds` — Job 全体のタイムアウト（秒）。長時間化を
  防ぎたい場合に指定する
- CronJob / Job いずれも `template.spec.restartPolicy` に `Always` は
  指定できない（`OnFailure` か `Never` のみ）

## デプロイまでの手順

1. 既存 namespace への追加であれば、対象 `packages/ns/<namespace>/index.ts`
   にリソースを追記する。新規 namespace の場合は Chart を新規作成する
2. 新規 namespace の場合のみ、`packages/main.ts` の `buildApp()` に
   `new XxxChart(app);` を追加する
3. `pnpm run synth` を実行し、`manifests/` に生成された YAML の差分を確認する
4. 差分を commit し、リモートへ push する
5. ArgoCD の root Application が変更を検知し、自動的に sync する

## 動作確認のヒント

```sh
kubectl get cronjob -n example-batch
kubectl create job --from=cronjob/nightly-cleanup manual-test -n example-batch
```

`create job --from=cronjob/...` は schedule を待たずにその場で1回だけ
実行させたい場合に使える。
