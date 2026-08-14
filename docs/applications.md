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

HTTPRoute（Gateway API）は ArgoCD Application とは別のリソース。公開したい
Service を持つ namespace の Chart 内に、生の `ApiObject` として追加する。

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
