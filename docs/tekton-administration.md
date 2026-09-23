<!-- markdownlint-disable MD013 -->

# Tekton 管理者ガイド

## 概要

このドキュメントは、クラスタ管理者向けのガイドである。
Tekton の共通 Task・Pipeline の管理と、Tekton Pipelines・Pipelines as Code（PAC）の
保守方法を説明する。
パイプラインを利用する開発者は
[tekton-pipeline-usage.md](./tekton-pipeline-usage.md) を参照する。

このリポジトリでは、Tekton 関連リソースを次の3つの Chart に分けて管理する。

| Chart | namespace | 責務 |
| --- | --- | --- |
| `packages/ns/tekton-pipelines/` | `tekton-pipelines` | Tekton Pipelines 本体と Remote Resolver、Tekton Dashboard と HTTPRoute |
| `packages/ns/pipelines-as-code/` | `pipelines-as-code` | PAC 本体と Forgejo webhook の HTTPRoute |
| `packages/ns/tekton-ci/` | `tekton-ci` | Repository CR、共通 Task、共通 Pipeline、実行先リソース |

`pnpm run synth` はこれらを `manifests/*.k8s.yaml` に出力する。ArgoCD の root
Application が `manifests/` を監視するため、`packages/` と生成 manifest の両方を
commit・push する必要がある。

## 共通リソースの管理方針

複数リポジトリで共有する Task と Pipeline は、`tekton-ci` namespace の Kubernetes
リソースとして管理する。利用者は Tekton の Cluster Resolver で参照する。

```text
k8s-management の packages/ns/tekton-ci/
  → cdk8s synth
  → manifests/tekton-ci.k8s.yaml
  → ArgoCD
  → tekton-ci namespace の Task / Pipeline
  → 各リポジトリの PipelineRun が Cluster Resolver で参照
```

この方式では、共通定義の変更権限を k8s-management のレビューに集約できる。
各アプリケーションリポジトリへの定義コピーも不要になる。一方、共通リソースは
Git の commit SHA ではなく Kubernetes 上の可変リソースである。互換性を壊す変更は
既存名を上書きせず、名前に含めるバージョンを上げて追加する。

```text
node-test-v1  → 既存利用者向けに維持
node-test-v2  → 新しい仕様として追加
```

利用者が移行した後に古いリソースを削除する。削除方法は
[resource-deletion.md](./resource-deletion.md) を参照する。

## 共通 Task を定義する

### 設計原則

- `apiVersion` は `tekton.dev/v1` を使う。
- 名前には互換性の世代を含める（例: `node-test-v1`）。
- イメージタグは `latest` を避け、可能なら digest で固定する。
- 入力は `params` と `workspaces`、出力は `results` で明示する。
- Task が利用者の ServiceAccount や Secret 名を固定しないようにする。
- `computeResources` と `timeout` に安全な既定値を持たせる。
- Step は原則として非 root で実行し、必要以上の権限を要求しない。
- shell script には shebang と `set -eu` を指定する。

### cdk8s で Task を追加する

専用ヘルパーはないため、`packages/ns/tekton-ci/index.ts` で `ApiObject` を直接作る。
大きな定義は、コンストラクタ外の定数またはファクトリー関数へ切り出す。

```ts
import { ApiObject, type App, Chart } from "cdk8s";

const NAMESPACE = "tekton-ci";

const nodeTestSpec = {
  description: "Node.js プロジェクトのテストを実行する。",
  params: [
    {
      name: "node-image",
      type: "string",
      default: "node:22-alpine",
    },
    {
      name: "test-command",
      type: "string",
      default: "npm test",
    },
  ],
  workspaces: [ { name: "source" } ],
  steps: [
    {
      name: "test",
      image: "$(params.node-image)",
      workingDir: "$(workspaces.source.path)",
      timeout: "15m",
      computeResources: {
        requests: { cpu: "100m", memory: "256Mi" },
        limits: { cpu: "1", memory: "1Gi" },
      },
      script: [
        "#!/bin/sh",
        "set -eu",
        'sh -c "$(params.test-command)"',
      ].join("\n"),
    },
  ],
};

export class TektonCiChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    new ApiObject( this, "node-test-v1", {
      apiVersion: "tekton.dev/v1",
      kind: "Task",
      metadata: {
        name: "node-test-v1",
        namespace: NAMESPACE,
        labels: {
          "app.kubernetes.io/part-of": "tekton-ci",
          "app.kubernetes.io/managed-by": "cdk8s",
        },
      },
      spec: nodeTestSpec,
    } );
  }
}
```

文字列のコマンドを `sh -c` で実行できる Task は便利だが、利用者が任意コードを実行する
性質は変わらない。Task にクラスタ管理権限を持つ ServiceAccount を割り当てないこと。
機密値をパラメーターへ直接渡さず、利用者側の Workspace や Secret 参照を使う。

### Task のパラメーター設計

Task の入力・出力は API として扱う。

- 必須パラメーターは少なくする。
- 安全な既定値を設定する。
- パラメーター名と意味を削除・変更しない。
- 新しい任意パラメーターの追加は後方互換とする。
- 必須パラメーターの追加や Workspace 名の変更は新バージョンにする。
- Result は小さい値（digest、URL、commit SHA など）だけに使う。

Result を返す場合は、宣言した Result のパスへ改行なしで書き込む。

```yaml
spec:
  results:
    - name: artifact-url
      type: string
  steps:
    - name: publish
      image: example/publisher:1.0.0
      script: |
        #!/bin/sh
        set -eu
        printf %s "https://registry.example/artifact" > "$(results.artifact-url.path)"
```

## 共通 Pipeline を定義する

共通 Pipeline は複数の Task の順序、パラメーター、Workspace の受け渡しを標準化する。
アプリケーション固有の値は PipelineRun からパラメーターとして渡す。

```ts
new ApiObject( this, "node-ci-v1", {
  apiVersion: "tekton.dev/v1",
  kind: "Pipeline",
  metadata: {
    name: "node-ci-v1",
    namespace: NAMESPACE,
    labels: {
      "app.kubernetes.io/part-of": "tekton-ci",
      "app.kubernetes.io/managed-by": "cdk8s",
    },
  },
  spec: {
    params: [
      { name: "repo-url", type: "string" },
      { name: "revision", type: "string" },
      { name: "node-image", type: "string", default: "node:22-alpine" },
    ],
    workspaces: [
      { name: "source" },
      { name: "basic-auth", optional: true },
    ],
    tasks: [
      {
        name: "clone",
        taskRef: {
          resolver: "cluster",
          params: [
            { name: "kind", value: "task" },
            { name: "name", value: "git-clone-v1" },
            { name: "namespace", value: NAMESPACE },
          ],
        },
        params: [
          { name: "url", value: "$(params.repo-url)" },
          { name: "revision", value: "$(params.revision)" },
        ],
        workspaces: [
          { name: "output", workspace: "source" },
          { name: "basic-auth", workspace: "basic-auth" },
        ],
      },
      {
        name: "test",
        runAfter: [ "clone" ],
        taskRef: {
          resolver: "cluster",
          params: [
            { name: "kind", value: "task" },
            { name: "name", value: "node-test-v1" },
            { name: "namespace", value: NAMESPACE },
          ],
        },
        params: [
          { name: "node-image", value: "$(params.node-image)" },
        ],
        workspaces: [
          { name: "source", workspace: "source" },
        ],
      },
    ],
  },
} );
```

共通 Pipeline 自身も Cluster Resolver 経由で利用する。Pipeline の中から共通 Task を
参照する場合も、名前参照ではなく Cluster Resolver を明示する。これにより、
PipelineRun の実行 namespace が変わっても `tekton-ci` の Task を解決できる。

## Cluster Resolver の管理

CDF の `tekton-pipeline` Chart 1.14.0 は Remote Resolver と
`resolvers-feature-flags` ConfigMap をインストールする。現在の Chart では
`enable-cluster-resolver: "true"` が既定値である。

次のコマンドで稼働状況を確認する。

```sh
kubectl -n tekton-pipelines get deploy tekton-pipelines-remote-resolvers
kubectl -n tekton-pipelines get configmap resolvers-feature-flags -o yaml
```

Cluster Resolver には namespace の許可・拒否設定がある。共通リソースを
`tekton-ci` だけに限定する場合は、`cluster-resolver-config` ConfigMap を設定する。
`allowed-namespaces` と `blocked-namespaces` を利用する。Chart のアップグレードで
上書きされない管理方法を確認してから、cdk8s の `ApiObject` として宣言する。

```yaml
data:
  allowed-namespaces: tekton-ci
  blocked-namespaces: "*"
```

## 変更・検証手順

共通 Task または Pipeline を変更するときは、次の順序で確認する。

1. `packages/ns/tekton-ci/index.ts` を編集する。
2. `pnpm exec biome check --write packages/` を実行する。
3. `pnpm run synth` を実行する。
4. `manifests/tekton-ci.k8s.yaml` の差分を確認する。
5. 互換性を壊す場合はリソース名のバージョンを上げる。
6. 既存 PipelineRun と新 PipelineRun の両方で動作を確認する。
7. `packages/` と `manifests/` を同じ変更として commit・push する。
8. ArgoCD の sync と Tekton リソースの Ready 状態を確認する。

ローカルで API 構造を検証する場合は、対象 CRD が存在するクラスタに対して
server-side dry run を使う。

```sh
kubectl apply --server-side --dry-run=server -f manifests/tekton-ci.k8s.yaml
```

実行テストでは、共通 Task の TaskRun と共通 Pipeline の PipelineRun を一時的に作成する。
テスト用リソースは GitOps 管理対象にせず、検証後に削除する。

## Tekton Pipelines のアップグレード

Tekton Pipelines の望ましい状態は
`packages/ns/tekton-pipelines/index.ts` で宣言する。バージョンは
`createHelmApplication` に渡す `targetRevision` で固定している。

`createHelmApplication` は、上流 Chart をmanifest生成元とする ArgoCD Application を
cdk8s で生成するヘルパーである。リソースのライフサイクルはArgoCDが管理する。
管理者は `helm install` や `helm upgrade` を実行しない。

### アップグレード前

1. 上流 Chart と Tekton Pipelines のrelease noteを確認する。
2. deprecated API、Feature Flags、Resolver の変更を確認する。
3. 上流 Chart の `values.yaml` を現行値と比較する。
4. `docs/tekton-helm-values.md` の実装上の注意点を確認する。
5. 上流リポジトリの `charts/tekton-pipeline/crds/` でCRDの差分を確認する。
6. PAC の対応 Tekton バージョンを確認する。

パッチ・マイナー更新でも、イメージ名、Feature Flags、CRD は変わる可能性がある。
Chart 名が同じであることを互換性の根拠にしない。

### CRD の更新

この構成はHelm releaseではない。ArgoCDがChartをmanifestへ展開し、通常の
KubernetesリソースとしてCRDを同期する。`createHelmApplication` は
`ServerSideApply=true` を設定しているため、大きなCRDもserver-side applyで更新する。

CRDを手動で `kubectl apply` すると、cdk8sとArgoCDが管理する望ましい状態から外れる。
更新時は手動applyを行わず、次のIaCフローを使う。

1. `packages/ns/tekton-pipelines/index.ts` の `targetRevision` を更新する。
2. 必要な `valuesObject` の変更を同じファイルへ追加する。
3. `pnpm run synth` を実行する。
4. `manifests/tekton-pipelines.k8s.yaml` のApplication差分を確認する。
5. `packages/` と `manifests/` を同じ変更としてcommit・pushする。
6. ArgoCDが表示するrender済みリソースの差分を確認してsyncする。

CRDからserved versionが削除される場合やschemaが狭くなる場合は、既存リソースとの
互換性を先に確認する。必要なデータ移行もcdk8sで宣言可能なJobなどとして管理する。
一時的な手動処理が避けられない場合は、理由と実行結果を変更履歴へ残す。

### アップグレード後

```sh
kubectl -n tekton-pipelines get deploy
kubectl -n tekton-pipelines get pods
kubectl -n tekton-pipelines get configmap feature-flags -o yaml
kubectl -n tekton-pipelines get configmap resolvers-feature-flags -o yaml
kubectl get crd | grep tekton.dev
```

次の smoke test を行う。

- 単純な TaskRun が成功する。
- Cluster Resolver で共通 Task を解決できる。
- 共通 Pipeline を参照する PipelineRun が成功する。
- Forgejo の push / PR から PAC が PipelineRun を作成する。
- PAC が Forgejo へ commit status を返す。

問題があれば、`targetRevision` を古い値へ戻して synth・push する前に、CRD の
互換性を確認する。新しい CRD へ保存されたリソースは、古い controller が解釈できない
場合がある。ロールバックも手動 apply ではなく、同じ IaC フローで行う。

## Pipelines as Code のアップグレード

PAC のバージョンは `packages/ns/pipelines-as-code/index.ts` の
`targetRevision` で固定している。上流リポジトリの `config/` ディレクトリを
ArgoCD の Git Application で同期する。

アップグレード時は次を確認する。

1. Forgejo provider の変更と Technology Preview の状態
2. Repository CRD schema の変更
3. webhook event と署名検証の変更
4. PAC が要求する Tekton Pipelines の最小バージョン
5. controller・watcher・webhook の RBAC 差分
6. 削除または追加されたリソース

更新後は、3つの Deployment と Repository CR を確認する。

```sh
kubectl -n pipelines-as-code get deploy
kubectl -n tekton-ci get repository.pipelinesascode.tekton.dev sharp-plugin -o yaml
```

Forgejo 対応は現時点で Technology Preview である。本番相当の用途に広げる場合は、
アップグレードごとに webhook の配信履歴、PR コメント、commit status を実測する。

## Tekton Dashboard のアップグレード

Dashboard は upstream の GitHub Release で公開される `release-full.yaml` を使う。
これを `packages/ns/tekton-pipelines/vendor/dashboard/` に vendor し、
`createDirectoryApplication` で同期する。ファイル名にバージョンを含めているため、
アップグレード時は新しいファイルを配置し、旧ファイルを削除する。旧ファイルを
残すと、両方の manifest が同時に適用される。

`release-full` は `--read-only=false` の read-write 版である。Dashboard 自体に
認証は無い。`tekton-dashboard.<CLUSTER_DOMAIN>` に到達できれば、全 namespace の
Tekton リソースを作成・削除できる。自宅内ネットワーク限定の前提で公開している。

アップグレード時は次を確認する。

1. Dashboard が要求する Tekton Pipelines の最小バージョン
2. ClusterRole・ClusterRoleBinding の差分（`tekton-aggregate-view`・`tekton-aggregate-edit` への依存）
3. `extensions.dashboard.tekton.dev` CRD の変更
4. Deployment の args と配置 namespace の変更

更新後は、Deployment と HTTPRoute を確認する。

```sh
kubectl -n tekton-pipelines get deploy tekton-dashboard
kubectl -n tekton-pipelines get httproute tekton-dashboard-route
```

## 定期メンテナンス

### PipelineRun・TaskRun の整理

完了した PipelineRun と TaskRun は蓄積する。PAC または別の pruner を導入するまでは、
保持期間を決めて定期削除する。調査中の実行を削除しないよう、対象を先に一覧表示する。

```sh
kubectl -n tekton-ci get pipelinerun
kubectl -n tekton-ci get taskrun
```

手動削除を自動化する場合は、実行中リソースを除外し、保持件数または保持日数を明示する。
ArgoCD 管理下の共通 Task・Pipeline・Repository CR は削除対象に含めない。

### 認証情報のローテーション

Forgejo の token と webhook secret は `tekton-ci` namespace の
`forgejo-webhook-config` Secret で参照する。平文をこのリポジトリへ保存せず、
[config-and-secrets.md](./config-and-secrets.md) の手順で SealedSecret を更新する。

- `provider.token`: Forgejo PAT。Repository Write と Issue Write が必要
- `webhook.secret`: Forgejo と PAC が共有する HMAC secret

`webhook.secret` を変更するときは、Forgejo の Webhook 設定と Kubernetes Secret を
同じ保守時間帯で更新する。片方だけを変更すると webhook が拒否される。

### 監視項目

最低限、次の状態を監視する。

- `tekton-pipelines-controller` と webhook の Ready 状態
- `tekton-pipelines-remote-resolvers` の Ready 状態
- PAC の controller、watcher、webhook の Ready 状態
- PipelineRun の失敗率と滞留数
- TaskRun Pod の ImagePullBackOff、OOMKilled、Pending
- Forgejo Webhook の配信失敗
- PAC controller の署名検証・API 認証エラー

## 障害調査

### 共通 Task・Pipelineを解決できない

```sh
kubectl -n tekton-pipelines logs deploy/tekton-pipelines-remote-resolvers
kubectl -n tekton-ci get resolutionrequest
kubectl -n tekton-ci describe resolutionrequest <name>
```

確認項目は次のとおり。

- `enable-cluster-resolver` が `"true"` か
- `kind`、`name`、`namespace` が正しいか
- 共通リソースが `tekton-ci` に存在するか
- Resolver の ServiceAccount に読み取り権限があるか
- `allowed-namespaces` / `blocked-namespaces` で拒否されていないか

### Forgejoイベントから実行されない

```sh
kubectl -n pipelines-as-code logs deploy/pipelines-as-code-controller
kubectl -n pipelines-as-code logs deploy/pipelines-as-code-watcher
kubectl -n tekton-ci describe repository sharp-plugin
```

Forgejo 側では Webhook の Recent Deliveries を確認する。Target URL、HTTP status、
`X-Forgejo-Signature`、選択イベント、共有 secret の一致を確認する。

## 参考

- Tekton Task: <https://tekton.dev/docs/pipelines/tasks/>
- Tekton Pipeline: <https://tekton.dev/docs/pipelines/pipelines/>
- Cluster Resolver: <https://tekton.dev/docs/pipelines/cluster-resolver/>
- PAC Resolver: <https://pipelinesascode.com/docs/guides/pipeline-resolution/>
- PAC Remote Pipeline: <https://pipelinesascode.com/docs/guides/pipeline-resolution/remote-pipelines/>
