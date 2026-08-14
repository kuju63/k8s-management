# CronJob / Job の作成方法

## 概要

CronJob / Job には Application 用のような専用ヘルパーは無く、生の
`ApiObject` で直接記述する。cdk8s の型付き import（`cdk8s-plus-*` や
`cdk8s import` による `imports/`）はこのリポジトリに導入されていない。
そのため `apiVersion` / `kind` / `spec` をそのまま渡す形になる。

ArgoCD の root Application（`app-of-apps`）は `manifests/` を directory
source・`recurse: true` で直接 watch している。そのため CronJob / Job の
ような素の Kubernetes リソースを、個別の ArgoCD Application でラップする
必要はない。`packages/ns/metallb-system/index.ts` は Helm Application と
生の CRD（`IPAddressPool` 等）を同じ Chart 内に混在させている。これと
同じ要領で、対象 namespace の Chart に直接追加すればよい。

## CronJob のサンプル

新規 namespace の Chart 全体の例。Pod テンプレートは可読性のため
コンストラクタの外で `const` に切り出すスタイルを基本とする。

```ts
import { type App, ApiObject, Chart } from "cdk8s";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "example-batch";

const cleanupPodSpec = {
    restartPolicy: "OnFailure",
    containers: [
        {
            name: "cleanup",
            image: "example.registry/cleanup:1.0.0",
            command: ["/bin/sh", "-c", "echo cleanup"],
            envFrom: [
                { configMapRef: { name: "app-config" } },
                // app-secret はコードで作らず、事前に kubectl 等で作成し
                // ておく（詳細は config-and-secrets.md を参照）。
                { secretRef: { name: "app-secret" } },
            ],
        },
    ],
};

export class ExampleBatchChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        // CronJob/Job から envFrom で参照する ConfigMap
        // （詳細は config-and-secrets.md を参照）。
        new ApiObject(this, "configmap-example", {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: { name: "app-config", namespace: NAMESPACE },
            data: {
                LOG_LEVEL: "info",
                FEATURE_FLAG_X: "true",
            },
        });

        new ApiObject(this, "cronjob-example", {
            apiVersion: "batch/v1",
            kind: "CronJob",
            metadata: { name: "nightly-cleanup", namespace: NAMESPACE },
            spec: {
                schedule: "0 3 * * *",
                concurrencyPolicy: "Forbid",
                successfulJobsHistoryLimit: 3,
                failedJobsHistoryLimit: 1,
                jobTemplate: {
                    spec: {
                        backoffLimit: 2,
                        template: { spec: cleanupPodSpec },
                    },
                },
            },
        });
    }
}
```

`app-config` の中身の作り方や `envFrom` の詳細、`app-secret` を事前に
作成する手順は [config-and-secrets.md](./config-and-secrets.md) を参照。

## Job のサンプル

単発実行のバッチ処理。上記と同じ Chart 内に追記する形。

```ts
const migratePodSpec = {
    restartPolicy: "Never",
    containers: [
        {
            name: "migrate",
            image: "example.registry/migrate:1.0.0",
            args: ["migrate", "up"],
        },
    ],
};

new ApiObject(this, "job-example", {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "migrate-db", namespace: NAMESPACE },
    spec: {
        backoffLimit: 3,
        template: { spec: migratePodSpec },
    },
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
