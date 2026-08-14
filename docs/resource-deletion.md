# リソースの削除方法

## 概要

`packages/lib/argocd-application.ts` には、ArgoCD `Application` を生成する
3つのヘルパー関数がある。

- `createHelmApplication`
- `createGitApplication`
- `createDirectoryApplication`

これらが生成する Application は、すべて次の syncPolicy を持つ。

- `prune: true` — Git 上に無くなったリソースをクラスタからも削除する
- `selfHeal: true` — クラスタ上の実体が Git の定義とズレたら、Git の
  状態に強制的に戻す

この2つが常に有効なため、リソース削除の正規の方法は1つに絞られる。
**コード（`packages/ns/<namespace>/index.ts`）から該当リソースを消して
push する**ことだ。`kubectl delete` を直接実行しても、コード側の定義が
残っている限り `selfHeal` が働き、ArgoCD が削除したリソースを復活
させてしまう。緊急時の手動削除については
[緊急時に手動で削除する場合の注意](#緊急時に手動で削除する場合の注意)
を参照。

リソースの作成方法そのものは、次のドキュメントを参照。このドキュメントは
それらと対になる、削除時の手順・注意点をまとめたもの。

- [applications.md](./applications.md) — ArgoCD Application
- [jobs.md](./jobs.md) — CronJob / Job
- [config-and-secrets.md](./config-and-secrets.md) — ConfigMap / Secret

## namespace を丸ごと削除する

`packages/ns/<namespace>/index.ts` 自体を削除する。あわせて
`packages/main.ts` の `buildApp()` から対応する `new XxxChart(app);` も
除去する。

例として、[jobs.md](./jobs.md) で作成した `example-batch` namespace
（`ExampleBatchChart`）を丸ごと削除する場合。

```ts
// packages/ns/example-batch/index.ts を削除する
// （ファイル自体を git rm する。コードを空にするのではない）
```

```ts
// packages/main.ts
import { App } from "cdk8s";
import { ArgocdChart } from "./ns/argocd/index.js";
// この import を削除する
import { ExampleBatchChart } from "./ns/example-batch/index.js";
// ...

function buildApp(): App {
    const app = new App();

    new ArgocdChart(app);
    new ExampleBatchChart(app); // ← この行を削除する
    // ...

    return app;
}
```

**注意**: `pnpm run synth` を実行しても `manifests/example-batch.k8s.yaml`
は自動では消えない。cdk8s の `App.synth()` は、その時点で App に
登録されている Chart についてのみ出力ファイルを書き込む。outdir 内の
古いファイルを削除するクリーンアップ処理は持たない
（`node_modules/cdk8s/lib/app.js` 参照）。Chart を丸ごと削除した場合、
対応する manifest ファイルは synth 後も残り続けるため、明示的に
`git rm` で削除する必要がある。

```sh
git rm manifests/example-batch.k8s.yaml
```

この `git rm` によって manifest の消失が git 上の差分として現れる。
差分を確認してから commit する。個別リソースの削除（Chart 自体は残す
場合）ではこの手動削除は不要。対象 Chart が引き続き synth されるたびに
manifest ファイル全体が上書きされ、削除したリソースは自然に消える。

## 個別のリソースだけを削除する

namespace 自体は残し、特定のリソースだけを削除したい場合は、対応する
Chart から該当ブロックだけを取り除く。対象は `new ApiObject(...)` や
`createHelmApplication(...)` の呼び出しブロック。

[jobs.md](./jobs.md) の `ExampleBatchChart` から、`nightly-cleanup`
CronJob だけを削除する例（Before → After）。

```ts
// Before: packages/ns/example-batch/index.ts
export class ExampleBatchChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        new ApiObject(this, "configmap-example", {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: { name: "app-config", namespace: NAMESPACE },
            data: { LOG_LEVEL: "info", FEATURE_FLAG_X: "true" },
        });

        new ApiObject(this, "cronjob-example", {
            apiVersion: "batch/v1",
            kind: "CronJob",
            metadata: { name: "nightly-cleanup", namespace: NAMESPACE },
            spec: {
                schedule: "0 3 * * *",
                concurrencyPolicy: "Forbid",
                jobTemplate: { spec: { template: { spec: cleanupPodSpec } } },
            },
        });
    }
}
```

```ts
// After: cronjob-example のブロックだけを削除する
export class ExampleBatchChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        new ApiObject(this, "configmap-example", {
            apiVersion: "v1",
            kind: "ConfigMap",
            metadata: { name: "app-config", namespace: NAMESPACE },
            data: { LOG_LEVEL: "info", FEATURE_FLAG_X: "true" },
        });
    }
}
```

Helm ベースの Application
（`createHelmApplication` / `createGitApplication` 呼び出し）を
削除する場合も、該当ブロックを取り除くだけでよい。作成方法は
[applications.md](./applications.md) を参照。

ArgoCD がその Application を prune すると、Application 配下で Helm
チャートがインストールしていたリソース群も連鎖的に削除される。

## デプロイ（削除の反映）までの手順

1. 対象 `packages/ns/<namespace>/index.ts` から該当リソースを削除する。
   namespace を丸ごと削除する場合はファイル自体を削除する
2. namespace を丸ごと削除する場合のみ、`packages/main.ts` の
   `buildApp()` から `new XxxChart(app);` と対応する import を削除する
3. `pnpm run synth` を実行する。個別リソース削除の場合はこの時点で
   `manifests/` の該当ファイルが上書きされ、削除が反映される
4. namespace を丸ごと削除する場合のみ、対応する
   `manifests/<namespace>.k8s.yaml` を `git rm` で手動削除する。
   cdk8s の `synth()` は outdir のクリーンアップを行わないため、
   Chart を削除しても古い manifest ファイルは残ってしまう
5. `git status` / `git diff` で意図した差分（リソースの消失、または
   manifest ファイル自体の削除）になっていることを確認する
6. 差分を commit し、リモートへ push する
7. ArgoCD の root Application が変更を検知し、`prune: true` により
   自動的にクラスタからリソースを削除する

## 緊急時に手動で削除する場合の注意

正規の手順（コード削除→push）を待てない緊急時でも、`kubectl delete` を
単体で使うのは避ける。`selfHeal: true` が有効な限り、コード側の定義が
残っていればすぐに再作成されてしまう。

```sh
# NG例: コードを直さずに kubectl delete だけ行うと、
# 次の selfHeal（デフォルトでは数分以内）で復活してしまう
kubectl delete cronjob nightly-cleanup -n example-batch
```

どうしても一時的に ArgoCD の自動 sync を止めて手動介入したい場合は、
対象 Application の sync policy を一時的に無効化してから作業する。

```sh
# 対象 Application の自動 sync を一時停止する
argocd app set example-batch --sync-policy none

# この間は selfHeal が働かないため、手動での kubectl delete が復活しない
kubectl delete cronjob nightly-cleanup -n example-batch

# 作業後は必ずコード側も同じ状態（削除済み）に揃えて commit・push し、
# 自動 sync を元に戻す
argocd app set example-batch --sync-policy automated --auto-prune --self-heal
```

一時停止したまま放置すると、以後の GitOps の変更がそのリソースだけ
反映されなくなるため、作業後の sync policy 復旧は必須。

## 削除後に残る可能性があるリソースの注意点

cdk8s のコードや ArgoCD の prune では消えないリソースがある。削除作業
後は次の点も確認する。

- **PersistentVolume**: StorageClass の `reclaimPolicy` が `Retain` の
  場合、PVC や Pod を削除しても紐づく PV と実データはクラスタに残る。
  完全に消したい場合は PV を個別に確認して削除する必要がある
- **Helm チャート由来の CRD**: `createHelmApplication` の Application を
  削除しても、チャートが導入した CRD 自体は消えずに残ることが多い。
  残っている間は、別の Application が同じカスタムリソース
  （`IPAddressPool` など）を参照し続けていないか確認する
- **Terminating のまま止まる namespace**: リソースに finalizer が
  残っていると、namespace の削除が `Terminating` のまま止まることが
  ある。最終手段として finalizer を取り除き、強制的に完了させる方法も
  ある。

  ```sh
  kubectl get namespace example-batch -o json \
    | jq '.spec.finalizers = []' \
    | kubectl replace --raw "/api/v1/namespaces/example-batch/finalize" -f -
  ```

  この操作は該当 finalizer が保護していたクリーンアップ処理を
  スキップすることになるため、原因（何が finalizer を残しているか）を
  `kubectl get namespace example-batch -o yaml` で確認したうえで、
  最終手段としてのみ使う。

## 動作確認のヒント

```sh
# 対象 Application が ArgoCD 上から消えたか確認する
kubectl get application -n argocd

# namespace 内にリソースが残っていないか確認する
kubectl get all,pvc -n example-batch

# namespace 自体が完全に消えたか確認する
kubectl get ns example-batch
```
