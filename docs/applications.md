# ArgoCD Application の作成方法

## 概要

このリポジトリは cdk8s + ArgoCD の App-of-Apps パターンで構成されている。
`packages/lib/argocd-application.ts` に、ArgoCD の `Application` リソースを
生成するヘルパー関数が3つ用意されている。

- `createHelmApplication` — upstream の Helm チャートを source にする
- `createGitApplication` — 任意の git リポジトリのディレクトリを source にする
- `createDirectoryApplication` — このリポジトリ自身のディレクトリを source
  にする。`packages/ns/argocd/index.ts` の App-of-Apps root
  （`app-of-apps` Application）専用のヘルパー。通常の namespace 追加作業
  では使わない
- `createContainerApplication` — コンテナイメージから直接 Deployment/Service
  を作る。内部で bjw-s-labs/app-template という汎用 Helm チャートをラップ
  しており、Helm チャートを自作せずに単一コンテナのアプリを追加できる

HTTPRoute（Gateway API）は ArgoCD Application とは別のリソース。公開したい
Service を持つ namespace の Chart 内に、生の `ApiObject` として追加する。

`packages/lib/batch-job.ts` のヘルパー（`createCronJob` / `createJob`）で
`CronJob` / `Job` リソースも作成できる。この2つには ArgoCD Application
でラップする必要なく、直接 `ApiObject` として生成される。`createHelmApplication`
等のヘルパーが作成する `Application` リソースは別のリソース。`createCronJob`
`createJob` は `CronJob` / `Job` リソースを生成するものにすぎない。

作成した Application を削除する場合の手順は
[resource-deletion.md](./resource-deletion.md) を参照。

## `createHelmApplication` で Helm チャートを追加する

`packages/ns/metallb-system/index.ts` のように、Helm チャートをそのまま
インストールするだけで外部公開が不要な namespace の典型形。

```ts
import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "example-helm-app";

export class ExampleHelmAppChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        createHelmApplication(this, "argocd-application", {
            name: "example-helm-app",
            namespace: NAMESPACE,
            repoUrl: "https://example.github.io/helm-charts",
            chart: "example-chart",
            targetRevision: "1.2.3",
            valuesObject: {
                replicaCount: 2,
            },
        });
    }
}
```

`repoUrl` が `oci://...` の OCI レジストリの場合は `chart` を省略する
（`repoUrl` 自体にチャート名まで含まれるため）。`valuesObject` を省略すると
チャートのデフォルト値がそのまま使われる。

生成される Application は `ServerSideApply=true` を使用する。
これにより、大きな CRD が client-side apply の
`last-applied-configuration` annotation サイズ上限を超える問題を回避する。

HTTPRoute を持たないこのパターンは、MetalLB のようにクラスタ内部の
インフラ機能を提供するだけで、外部からのルーティングが不要な場合に使う。

## `createGitApplication` で Git リポジトリを追加する

自前でホストしているアプリケーションのマニフェストを追従させる場合の形。
`packages/ns/argocd/index.ts` の `argocd-self` 部分ではなく、外部リポジトリを
source にするパターンを一般化したもの。

```ts
import { createGitApplication } from "../../lib/argocd-application.js";

createGitApplication(this, "argocd-application", {
    name: "example-web-app",
    namespace: NAMESPACE,
    repoUrl: "https://github.com/example-org/example-web-app.git",
    targetRevision: "main",
    path: "manifests",
});
```

`recurse` を指定しない場合は `false` 扱いになり、`path` 直下のみを watch
する。サブディレクトリも含めて watch したい場合は `recurse: true` を渡す。

## `createContainerApplication` でコンテナイメージから直接追加する

Helm チャートや Deployment/Service のマニフェストを自前で書く必要はない。
コンテナイメージ・env・envFrom・永続化ボリューム・Service を指定するだけで
ArgoCD Application を作れる。内部では
[bjw-s-labs/app-template](https://github.com/bjw-s-labs/helm-charts) という
汎用 Helm チャートを `createHelmApplication` 経由でラップしている。
呼び出し側は Helm チャートの存在を意識する必要はない。

```ts
import { createContainerApplication } from "../../lib/argocd-application.js";

createContainerApplication(this, "argocd-application", {
    name: "example-app",
    namespace: NAMESPACE,
    targetRevision: "5.0.1",
    image: { repository: "ghcr.io/example-org/example-app", tag: "1.0.0" },
    env: {
        LOG_LEVEL: "info",
        DB_PASSWORD: {
            secretKeyRef: { name: "example-app-secret", key: "db-password" },
        },
    },
    envFrom: [{ configMapRef: { name: "example-app-config" } }],
    persistence: {
        data: {
            type: "persistentVolumeClaim",
            accessMode: "ReadWriteOnce",
            size: "1Gi",
            globalMounts: [{ path: "/data" }],
        },
    },
    service: {
        ports: { http: { port: 8080 } },
    },
});
```

`targetRevision` は他の3つのヘルパーと意味が異なる点に注意。これは
bjw-s-labs/app-template チャート自体のバージョンであり、デプロイしたい
アプリケーション自体のバージョンは `image.tag` 側で指定する。

`env` は「単純な文字列」または `secretKeyRef`/`configMapKeyRef` による
特定キー参照のどちらかしか指定できない。**Secret の平文値を直接書くことは
できない**設計になっている（[config-and-secrets.md](./config-and-secrets.md)
の方針どおり、Secret はキー参照のみ）。参照先の Secret/ConfigMap は
事前に対象 namespace へ作成されている必要がある。

`persistence` は `persistentVolumeClaim`・`configMap`・`secret`・`emptyDir`
の4種類をサポートする。`configMap`/`secret` タイプは、この呼び出しの外で
既に作られているリソースの `name` を参照する形のみサポートする。

**`syncPolicy.automated.prune: true` は常に有効になっている。**
`persistence` の項目をコードから削除すると、対応する PVC も自動で
削除される（データ消失）。既存3ヘルパーはこのリポジトリで PVC を作る
経路が無かったため影響しなかったが、`createContainerApplication` では
運用上の注意点になる。

`service` を指定した場合、生成される Service 名は `props.name` と同じになる。
`props.name` は Application の name であり、Helm の release 名とも一致する。
これはヘルパー内部で `nameOverride` を `props.name` に固定して実現している。
そのため、通常の `createHelmApplication` 呼び出しのように「チャートの
命名規則を確認する」必要はない。HTTPRoute の `backendRefs.name` には
この値をそのまま使える。

Ingress/HTTPRoute はこのヘルパーの対象外。外部公開が必要な場合は次項の
「HTTPRoute を追加する」の手順に従い、同じ Chart 内に生の `ApiObject` として
追加すること。

## HTTPRoute を追加する（外部公開が必要な場合）

`packages/ns/argocd/index.ts` の `argocd-self` + `httproute` の組がこの
パターンの実例。同じ Chart のコンストラクタ内で、Application 作成のあとに
生の `ApiObject` として `HTTPRoute` を追加する。

```ts
import { type App, ApiObject, Chart } from "cdk8s";
import { createGitApplication } from "../../lib/argocd-application.js";
import {
    CLUSTER_DOMAIN,
    GATEWAY_NAME,
    GATEWAY_NAMESPACE,
} from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "example-web-app";

export class ExampleWebAppChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        createGitApplication(this, "argocd-application", {
            name: "example-web-app",
            namespace: NAMESPACE,
            repoUrl: "https://github.com/example-org/example-web-app.git",
            targetRevision: "main",
            path: "manifests",
        });

        new ApiObject(this, "httproute", {
            apiVersion: "gateway.networking.k8s.io/v1",
            kind: "HTTPRoute",
            metadata: { name: "example-web-app", namespace: NAMESPACE },
            spec: {
                parentRefs: [
                    { name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE },
                ],
                hostnames: [`example.${CLUSTER_DOMAIN}`],
                rules: [
                    { backendRefs: [{ name: "example-web-app", port: 80 }] },
                ],
            },
        });
    }
}
```

`backendRefs` の `name` は、デプロイ対象が実際に作る Service 名と一致させる
必要がある。Helm チャート由来の場合は、チャートが生成する Service 名の
命名規則（例: `<release-name>-grafana`）を確認すること。
`parentRefs` / `hostnames` の共通値は `packages/lib/config.ts` にある。
`GATEWAY_NAME` / `GATEWAY_NAMESPACE` / `CLUSTER_DOMAIN` を参照する。

## デプロイまでの手順

1. `packages/ns/<namespace>/index.ts` を新規作成、または既存ファイルを編集
2. 新規 namespace の場合は `packages/main.ts` の `buildApp()` に
   `new XxxChart(app);` を追加する
3. `pnpm run synth` を実行し、`manifests/` に生成された YAML の差分を確認する
4. 差分を commit し、リモートへ push する
5. ArgoCD の root Application（`app-of-apps`、`manifests/` を再帰的に watch）
   が変更を検知し、自動的に sync する

`packages/ns/<namespace>/index.ts` を編集しただけではクラスタには反映
されない。必ず `pnpm run synth` で `manifests/` に出力し、コミットする
ところまでが一連の作業。

## 参考: 既存実装

- `packages/ns/argocd/index.ts` — `createDirectoryApplication` +
  `createHelmApplication` + HTTPRoute の組み合わせ例
- `packages/ns/apps/index.ts` — `createGitApplication` の実例
- `packages/ns/metallb-system/index.ts` — HTTPRoute なしの実例
- `packages/ns/arc-runners/index.ts` — `createHelmApplication` +
  `valuesObject` の実例
