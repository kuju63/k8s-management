# Kubernetes RBAC リソースの作成方法

## 概要

`packages/lib/rbac.ts` のヘルパーで、Kubernetes 1.37 の次のリソースを生成する。

- `ServiceAccount`（`v1`）
- `Role` / `RoleBinding`（`rbac.authorization.k8s.io/v1`）
- `ClusterRole` / `ClusterRoleBinding`（`rbac.authorization.k8s.io/v1`）

namespace 内だけで権限を付与する場合は、原則として `Role` と
`RoleBinding` を使用する。
複数 namespace で再利用する権限セットや、Node、Namespace、PersistentVolume
などのクラスタスコープリソースを扱う場合は `ClusterRole` を使用する。
API の非リソース URL を扱う場合も `ClusterRole` が必要となる。

`RoleBinding` から `ClusterRole` を参照しても、権限が有効になる範囲は
`RoleBinding` の namespace 内に限定される。クラスタ全体へ権限を付与する
`ClusterRoleBinding` は影響範囲が広いため、必要な場合に限って使用する。

## ServiceAccount、Role、RoleBinding の例

次の例では、`example` namespace の Pod を読み取れる ServiceAccount を作成する。

```ts
import { type App, Chart } from "cdk8s";
import { createNamespace } from "../../lib/namespace.js";
import {
  createRole,
  createRoleBinding,
  createServiceAccount,
} from "../../lib/rbac.js";

const NAMESPACE = "example";

export class ExampleChart extends Chart {
  constructor(scope: App) {
    super(scope, NAMESPACE);

    createNamespace(this, NAMESPACE);

    createServiceAccount(this, "pod-reader-service-account", {
      name: "pod-reader",
      namespace: NAMESPACE,
      automountServiceAccountToken: false,
    });

    createRole(this, "pod-reader-role", {
      name: "pod-reader",
      namespace: NAMESPACE,
      rules: [
        {
          apiGroups: [""],
          resources: ["pods", "pods/log"],
          verbs: ["get", "list", "watch"],
        },
      ],
    });

    createRoleBinding(this, "pod-reader-role-binding", {
      name: "pod-reader",
      namespace: NAMESPACE,
      subjects: [
        {
          kind: "ServiceAccount",
          name: "pod-reader",
          namespace: NAMESPACE,
        },
      ],
      roleRef: { kind: "Role", name: "pod-reader" },
    });
  }
}
```

`automountServiceAccountToken: false` は、ServiceAccount 自体へのトークンの
自動マウント設定である。Pod から Kubernetes API へアクセスする場合は、Pod
テンプレート側で必要性を判断して明示的に有効化する。

## ClusterRole と ClusterRoleBinding の例

次の例では Node の読み取り権限をグループへ付与する。

```ts
import {
  createClusterRole,
  createClusterRoleBinding,
} from "../../lib/rbac.js";

createClusterRole(this, "node-reader-cluster-role", {
  name: "node-reader",
  rules: [
    {
      apiGroups: [""],
      resources: ["nodes"],
      verbs: ["get", "list", "watch"],
    },
  ],
});

createClusterRoleBinding(this, "node-reader-cluster-role-binding", {
  name: "node-reader",
  subjects: [
    {
      kind: "Group",
      name: "infrastructure-readers",
    },
  ],
  roleRef: { kind: "ClusterRole", name: "node-reader" },
});
```

`ClusterRoleBinding.roleRef.kind` は型定義で `ClusterRole` に限定している。
`Role` は namespace スコープのリソースであり、`ClusterRoleBinding` からは
参照できない。

## ClusterRole を namespace 内で再利用する例

共通の `ClusterRole` を複数 namespace の `RoleBinding` から参照すると、権限
セットを再利用しつつ、付与範囲を各 namespace 内に限定できる。

```ts
createRoleBinding(this, "shared-reader-role-binding", {
  name: "shared-reader",
  namespace: NAMESPACE,
  subjects: [
    {
      kind: "ServiceAccount",
      name: "reader",
      namespace: NAMESPACE,
    },
  ],
  roleRef: { kind: "ClusterRole", name: "shared-reader" },
});
```

## ClusterRole の集約

`aggregationRule` を使用すると、ラベルに一致する他の `ClusterRole` を選択できる。
選択した `ClusterRole` のルールは、Kubernetes の ClusterRole Aggregation
Controller が自動的に集約する。

```ts
createClusterRole(this, "monitoring-reader-cluster-role", {
  name: "monitoring-reader",
  aggregationRule: {
    clusterRoleSelectors: [
      {
        matchLabels: {
          "rbac.example.internal/aggregate-to-monitoring-reader": "true",
        },
      },
    ],
  },
});
```

集約型の `ClusterRole` では、`rules` と `aggregationRule` を同時に指定できない。
集約後の `rules` はコントローラーが管理するため、コードで直接定義しない。

集合条件を使用する場合は `matchExpressions` を指定する。

```ts
aggregationRule: {
  clusterRoleSelectors: [
    {
      matchExpressions: [
        {
          key: "rbac.example.internal/tier",
          operator: "In",
          values: ["reader", "viewer"],
        },
      ],
    },
  ],
},
```

## 非リソース URL への権限

`/healthz` などの非リソース URL は namespace に属さないため、`ClusterRole` に
のみ定義できる。

```ts
createClusterRole(this, "health-reader-cluster-role", {
  name: "health-reader",
  rules: [
    {
      nonResourceURLs: ["/healthz", "/healthz/*"],
      verbs: ["get"],
    },
  ],
});
```

`PolicyRule` は判別可能ユニオンであり、`resources` と `nonResourceURLs` を
同じルールに指定できない。リソースへの権限と非リソース URL への権限は別々の
ルールとして定義する。

## 型と入力検証

ヘルパーは次の誤りを TypeScript の型で防止する。

- `ServiceAccount` subject への namespace 指定漏れ
- `User` / `Group` subject への namespace 指定
- `ClusterRoleBinding` から `Role` への参照
- `Role` への非リソース URL ルールの指定
- リソースルールと非リソース URL ルールのフィールド混在
- 集約型 `ClusterRole` への `rules` の同時指定
- `Exists` / `DoesNotExist` ラベル条件への `values` の指定

空の名前、空の `rules`、空の `subjects`、空の集約セレクターなどは、型だけで
防止できない。これらの値は synth 時にエラーとする。

`RoleBinding` と `ClusterRoleBinding` の `roleRef` は Kubernetes API 上で
変更不可である。参照先を変更する場合、ArgoCD がリソースを再作成できるかを
確認する。安全に切り替える必要がある場合は、新しい名前の Binding を追加し、
適用後に古い Binding を削除する。

## 最小権限の原則

- `verbs: ["*"]` や `resources: ["*"]` は避け、必要な操作とリソースを列挙する
- 読み取り専用であれば、原則として `get` / `list` / `watch` のみを付与する
- `secrets` の読み取り権限は Secret の実体を取得できるため、必要な主体だけに
  限定する
- `bind` / `escalate` / `impersonate` は権限昇格につながるため、通常のワークロード
  には付与しない
- クラスタ全体の権限が不要なら、`ClusterRoleBinding` ではなく
  `RoleBinding` を使用する

## デプロイまでの手順

1. 対象の `packages/ns/<namespace>/index.ts` からヘルパーを呼び出す
2. `pnpm run synth` を実行する
3. `manifests/<namespace>.k8s.yaml` の生成差分を確認する
4. コードと生成物を commit し、リモートへ push する
5. ArgoCD の root Application による自動 sync を確認する

削除時は ArgoCD の self-heal を考慮し、コード上の定義を削除してから synth する。
詳細は [resource-deletion.md](./resource-deletion.md) を参照する。

## 動作確認

ServiceAccount が持つ権限は `kubectl auth can-i` で確認できる。

```sh
kubectl auth can-i get pods \
  --as=system:serviceaccount:example:pod-reader \
  -n example

kubectl auth can-i delete pods \
  --as=system:serviceaccount:example:pod-reader \
  -n example
```

最初のコマンドが `yes`、付与していない削除操作が `no` になることを確認する。
