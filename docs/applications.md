# ArgoCD Application の作成方法

## 概要

このリポジトリは cdk8s + ArgoCD の App-of-Apps パターンで構成されている。
`packages/lib/argocd-application.ts` に、ArgoCD の `Application` リソースを
生成するヘルパー関数が4つ用意されている。

- `createHelmApplication` — upstream の Helm チャートを source にする
- `createGitApplication` — 任意の git リポジトリのディレクトリを source にする
- `createDirectoryApplication` — このリポジトリ自身のディレクトリを source
  にする。`packages/ns/argocd/index.ts` の App-of-Apps root
  （`app-of-apps` Application）専用のヘルパー。通常の namespace 追加作業
  では使わない
- `createContainerApplication` — コンテナイメージから直接 Deployment または
  StatefulSet と Service を作る。内部で bjw-s-labs/app-template という汎用 Helm
  チャートをラップしており、Helm チャートを自作せずに単一コンテナのアプリを
  追加できる

`packages/lib/argocd-applicationset.ts` には、`ApplicationSet` 用の
ヘルパー関数が2つ用意されている。これらは複数の Application を自動生成・管理する。

- `createHelmApplicationSet` — 複数の Helm Application を List generator で管理する
- `createApplicationSet` — 任意の generator と Application template を指定する

HTTPRoute（Gateway API）は ArgoCD Application とは別のリソース。公開したい
Service を持つ namespace の Chart 内に、生の `ApiObject` として追加する。

`packages/lib/batch-job.ts` のヘルパー（`createCronJob` / `createJob`）で
`CronJob` / `Job` リソースも作成できる。この2つには ArgoCD Application
でラップする必要なく、直接 `ApiObject` として生成される。`createHelmApplication`
等のヘルパーが作成する `Application` リソースは別のリソース。`createCronJob`
`createJob` は `CronJob` / `Job` リソースを生成するものにすぎない。

作成した Application を削除する場合の手順は
[resource-deletion.md](./resource-deletion.md) を参照。

## ArgoCD プロジェクトを設定する

ArgoCD の `AppProject` は、Application を論理的にグループ化し、次の項目を
プロジェクト単位で制限する。

- 利用できる Git/Helm source リポジトリ
- デプロイ先クラスタと namespace
- デプロイできるクラスタスコープ・namespace スコープのリソース種別
- OIDC group などに紐づけるプロジェクト role と Application RBAC

`packages/lib/argocd-project.ts` の `createAppProject` で `AppProject` を
作成する。Application ヘルパーの `project` には同じ名前を指定する。

```ts
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createAppProject } from "../../lib/argocd-project.js";

const PROJECT = "monitoring";

createAppProject(this, "argocd-project", {
    name: PROJECT,
    description: "監視系スタック用プロジェクト",
    sourceRepos: [
        "https://prometheus-community.github.io/helm-charts",
        "https://grafana.github.io/helm-charts",
    ],
    destinations: [
        {
            server: "https://kubernetes.default.svc",
            namespace: "monitoring",
        },
    ],
    clusterResourceWhitelist: [{ group: "*", kind: "*" }],
    namespaceResourceWhitelist: [{ group: "*", kind: "*" }],
});

createHelmApplication(this, "argocd-application", {
    name: "kube-prometheus-stack",
    namespace: "monitoring",
    project: PROJECT,
    repoUrl: "https://prometheus-community.github.io/helm-charts",
    chart: "kube-prometheus-stack",
    targetRevision: "88.3.0",
});
```

`AppProject` と `Application` は ArgoCD の namespace に置く必要がある。
`createAppProject` と各 Application ヘルパーは、`metadata.namespace` を
`ARGOCD_NAMESPACE` に固定している。

`project` は次の Application ヘルパーで指定できる。

- `createHelmApplication`
- `createGitApplication`
- `createDirectoryApplication`
- `createContainerApplication`
- `createHelmApplicationSet`

省略時は後方互換のため `default` になる。

**既存リソースは `project` を指定しておらず、引き続きすべて `default` に
所属する。** 新しい AppProject を定義しただけでは既存の Application は
移動しない。

プロジェクト role を OIDC group に割り当てる場合は、`roles` を追加する。
実際の group 名は利用する IdP の設定に合わせること。

```ts
createAppProject(this, "argocd-project", {
    name: PROJECT,
    sourceRepos: ["https://prometheus-community.github.io/helm-charts"],
    destinations: [
        {
            server: "https://kubernetes.default.svc",
            namespace: "monitoring",
        },
    ],
    roles: [
        {
            name: "viewer",
            description: "監視 Application の読み取り専用 role",
            policies: [
                "p, proj:monitoring:viewer, applications, get, monitoring/*, allow",
            ],
            groups: ["your-oidc-group"],
        },
    ],
});
```

`sourceRepos` と `destinations` は必要最小限に絞る。特に `*` を指定すると
`default` プロジェクトと同様に制限が弱くなる。クラスタスコープリソースは
デフォルトでは許可されないため、CRD や ClusterRole などが必要な Helm
チャートでは `clusterResourceWhitelist` を明示する。

詳細なフィールドと制約は ArgoCD 公式の
[Projects](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/) を参照する。

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

API サーバーが正規化するため live に現れない値を chart が明示している場合、
Application が恒常的に OutOfSync になる。実害のない差分に限り、
`ignoreDifferences` で対象フィールドを比較から除外できる。
`packages/ns/tekton-pipelines/index.ts` では、CRD の
`/spec/preserveUnknownFields` を除外している。
このフィールドのデフォルト値 `false` は、保存時に省略される。除外する理由は呼び出し側のコメントに残す。

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

`ko`（Knative/Tekton 系プロジェクトに多いビルド・デプロイツール）でビルドされる
upstream の場合、注意が必要。`config/` のような生ディレクトリには、Deployment
の image が `ko://<import path>` という未解決プレースホルダのまま含まれている
ことがある。これをそのまま source にすると `InvalidImageName` で Pod が起動でき
ない。ArgoCD 上は `Synced` のまま `Degraded` になる。この場合は GitHub Release
で公開される解決済み manifest（`release.yaml`/`release.k8s.yaml` 等）を使う。
それをバージョン固定でこのリポジトリに vendor し、`createDirectoryApplication`
で参照するパターンを
使う。実例: `packages/ns/pipelines-as-code/`（`vendor/release.k8s.yaml` +
`index.ts`）。

## `createContainerApplication` でコンテナイメージから直接追加する

Helm チャートや Deployment/StatefulSet/Service のマニフェストを自前で書く
必要はない。コンテナイメージ・controller 種別・env・envFrom・永続化ボリューム・
Service を指定するだけで ArgoCD Application を作れる。内部では
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

### StatefulSet を作成する

`controllerType` の省略時は Deployment を生成する。PostgreSQL などの stateful な
アプリ（DB 等）には `"statefulset"` を指定し、`persistence` でデータ用の PVC も
設定する。

```ts
createContainerApplication(this, "argocd-application", {
    name: "postgresql",
    namespace: NAMESPACE,
    targetRevision: "5.0.1",
    controllerType: "statefulset",
    image: { repository: "postgres", tag: "17" },
    env: {
        POSTGRES_PASSWORD: {
            secretKeyRef: { name: "postgresql-secret", key: "password" },
        },
    },
    persistence: {
        data: {
            type: "persistentVolumeClaim",
            accessMode: "ReadWriteOnce",
            size: "10Gi",
            retain: true,
            globalMounts: [{ path: "/var/lib/postgresql/data" }],
        },
    },
    service: {
        ports: { postgresql: { port: 5432 } },
    },
});
```

このヘルパーの `persistentVolumeClaim` は、StatefulSet の
`volumeClaimTemplates` ではなく、独立した単一の PVC を作成する。
したがって、StatefulSet と PVC の組み合わせは単一レプリカを前提とする。
Pod ごとに個別の PVC が必要な複数レプリカ構成では、`volumeClaimTemplates` を
定義できる方法を使うこと。たとえば `createHelmApplication` で専用の Helm
チャートを導入する。

**`syncPolicy.automated.prune: true` は常に有効になっている。**
`persistence` の項目をコードから削除すると、対応する PVC も自動で削除される
（データ消失）。データを Application 削除後も残す必要がある場合は、PVC に
`retain: true` を指定する。既存3ヘルパーはこのリポジトリで PVC を作る経路が
無かったため影響しなかったが、`createContainerApplication` では運用上の
注意点になる。

`service` を指定した場合、生成される Service 名は `props.name` と同じになる。
`props.name` は Application の name であり、Helm の release 名とも一致する。
これはヘルパー内部で `nameOverride` を `props.name` に固定して実現している。
そのため、通常の `createHelmApplication` 呼び出しのように「チャートの
命名規則を確認する」必要はない。HTTPRoute の `backendRefs.name` には
この値をそのまま使える。

Ingress/HTTPRoute はこのヘルパーの対象外。外部公開が必要な場合は次項の
「HTTPRoute を追加する」の手順に従い、同じ Chart 内に生の `ApiObject` として
追加すること。

## `createHelmApplicationSet` で複数の Application を管理する

同じ namespace に複数のアプリを導入する場合は、`createHelmApplicationSet` を
使用できる。個別の呼び出しを並べる代わりに、List generator の各要素から1つずつ
Application を生成する。Helm チャートとコンテナのどちらも扱える。

各要素は `kind` で判別する。`kind` を省略するか `"helm"` を指定すると upstream
Helm チャートになり、`createHelmApplication` と同じフィールドを受け取る。
`"container"` を指定するとコンテナイメージから app-template で生成する
ワークロードになり、`createContainerApplication` と同じフィールドを受け取る。
`kind` によって受け付けるフィールドが静的に切り替わる。このため Helm 要素に
`image` を渡すなどの誤りはコンパイル時に検出できる。

```ts
import { createHelmApplicationSet } from "../../lib/argocd-applicationset.js";

createHelmApplicationSet(this, "observability-applications", {
    name: "observability",
    namespace: NAMESPACE,
    applications: [
        {
            name: "metrics-server",
            repoUrl: "https://kubernetes-sigs.github.io/metrics-server/",
            chart: "metrics-server",
            targetRevision: "3.13.0",
        },
        {
            name: "example-oci-app",
            repoUrl: "oci://ghcr.io/example-org/charts/example-app",
            targetRevision: "1.2.3",
            valuesObject: {
                replicaCount: 2,
            },
        },
        {
            kind: "container",
            name: "example-worker",
            image: { repository: "ghcr.io/example-org/worker", tag: "1.0.0" },
            env: { LOG_LEVEL: "info" },
        },
    ],
});
```

Helm 要素の `repoUrl` と `chart` の指定方法は `createHelmApplication` と同じ。通常の
Helm リポジトリでは `chart` が必須となる。OCI URL ではチャート名を含む `repoUrl` を
渡せば `chart` を省略できる。

コンテナ要素は `createContainerApplication` と同じフィールド（`image` / `env` /
`persistence` / `service` など）を受け取る。内部で app-template チャートの
`valuesObject` へ変換する。`targetRevision` は app-template チャート自体の
バージョンで、省略時は既定値を使う。アプリのバージョンは `image.tag` 側で指定する。

ApplicationSet の通常のテンプレート置換は文字列型フィールドに限られる。
このため、オブジェクトである `valuesObject` は Go template の `templatePatch` を
使って各 Application へ反映している。入力にはコード内で定義した値だけを使用すること。
外部から受け取った未検証の値を入れてはいけない。

生成される Application では、`prune: true` と `selfHeal: true` が有効になる。
`ServerSideApply=true` も有効になる。ApplicationSet の要素を削除すると、対応する
Application とその管理リソースも削除される。変更前に対象を必ず確認すること。

List generator 以外の cluster、git、matrix などを使う場合は、低レベルヘルパーの
`createApplicationSet` を使う。`generators` と `template` を直接指定できる。
generator 固有のフィールドは `Record<string, unknown>` として渡す。ArgoCD の
[ApplicationSet ドキュメント](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/)
で、使用中の ArgoCD バージョンに対応する仕様を確認すること。

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
