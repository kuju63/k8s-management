<!-- markdownlint-disable MD013 -->

# Tekton Pipeline Helm Chart の設定パラメーター

## 調査対象

指定された `cncf/tekton-helm-chart` という GitHub リポジトリは存在しない。
そこで、CDF（Continuous Delivery Foundation）が管理する公式リポジトリを対象とした。

- リポジトリ: <https://github.com/cdfoundation/tekton-helm-chart>
- Chart: `charts/tekton-pipeline`
- Chart バージョン: `1.14.0`
- App バージョン: `1.14.0`
- 調査したコミット: `cd7fe9582ac842b0d3b59c7afc00772f81035514`
- `values.yaml`: <https://github.com/cdfoundation/tekton-helm-chart/blob/cd7fe9582ac842b0d3b59c7afc00772f81035514/charts/tekton-pipeline/values.yaml>

以下は、このコミットの `values.yaml` と Helm テンプレートを照合した結果である。
イメージのタグや digest などのデフォルト値は、Chart のバージョンによって変化する。

## RBAC

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `createClusterRoles` | boolean | `true` | Tekton が利用する `ClusterRole` と `ClusterRoleBinding` を作成する。クラスタ管理者が RBAC を別管理する場合は `false` にする。 |
| `createAggregateRoles` | boolean | `true` | Kubernetes の既存ロールへ権限を集約する `view`、`edit` 用の集約 `ClusterRole` を作成する。`createClusterRoles` が `true` の場合だけ有効。 |

## Namespace

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `namespace.name` | string | `tekton-pipelines` | Chart が作成する Namespace の名前。 |
| `namespace.create` | boolean | `true` | Namespace リソースを Chart で作成するかを指定する。既存 Namespace を使う場合は `false` にする。 |
| `namespace.labels` | map | 下記参照 | 作成する Namespace に付与するラベル。Helm の `tpl` 関数で評価される。 |

デフォルトの Namespace ラベルは次のとおり。

```yaml
namespace:
  labels:
    pod-security.kubernetes.io/enforce: restricted
    app.kubernetes.io/part-of: tekton-pipelines
```

> [!IMPORTANT]
> `namespace.name` が指定するのは、Chart が作成する Namespace リソースの名前だけである。
> 各 namespaced リソースの配置先は Helm リリースの Namespace で決まるため、通常は
> `helm upgrade --install ... --namespace tekton-pipelines --create-namespace` のように
> Helm 側の Namespace も一致させる必要がある。

## 認証

### Git 認証

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `auth.git.username` | string | `admin` | Git の Basic 認証ユーザー名。`auth.git.password` が空でない場合に Secret へ格納される。 |
| `auth.git.password` | string | `""` | Git の Basic 認証パスワードまたはトークン。空でなければ `tekton-git` Secret を作成し、`tekton-bot` ServiceAccount に関連付ける。 |
| `auth.git.url` | string | `https://github.com` | 認証情報を適用する Git サーバー URL。Secret の `tekton.dev/git-0` annotation に設定される。 |

### コンテナーレジストリ認証

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `auth.docker.configJson` | string | `""` | Docker `config.json` の内容。空でなければ `kubernetes.io/dockerconfigjson` 型の `tekton-container-registry-auth` Secret を作成し、`tekton-bot` ServiceAccount に関連付ける。 |
| `auth.docker.url` | string | 未定義 | Secret の `tekton.dev/docker-0` annotation に使われるが、`values.yaml` には宣言されていない。利用時は明示的に追加する必要がある。 |

```yaml
auth:
  docker:
    configJson: '{"auths":{"registry.example.com":{"auth":"..."}}}'
    url: https://registry.example.com
```

> [!CAUTION]
> これらの値は Kubernetes Secret へ変換されるだけであり、Helm values 自体を暗号化しない。
> Git 管理する values ファイルへパスワード、トークン、`config.json` を平文で保存してはならない。

## ServiceAccount

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `serviceaccount.enabled` | boolean | `true` | `values.yaml` には存在するが、テンプレートから参照されていない。値を `false` にしても `tekton-bot` ServiceAccount は作成される。 |
| `serviceaccount.annotations` | map | `{}` | `tekton-bot` ServiceAccount に追加する annotation。Workload Identity などに利用できる。 |

## Pipelines Controller

### Deployment と Pod

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `controller.deployment.image` | string | `ghcr.io/tektoncd/pipeline/controller-...:v1.14.0@sha256:5209...ea75` | Pipelines Controller コンテナーのイメージ。デフォルトは digest で固定されている。 |
| `controller.deployment.labels` | map | `{}` | Controller の Deployment に追加するラベル。 |
| `controller.pod.labels` | map | `{}` | Controller Pod に追加するラベル。 |
| `controller.pod.annotations` | map | `{}` | Controller Pod に追加する annotation。 |
| `controller.envFromSecret` | string | `tekton-env` | Controller の環境変数を読み込む Secret 名。Secret 参照は optional であり、Chart 自身はこの Secret を作成しない。HTTP proxy などの設定に利用できる。 |
| `controller.affinity` | object | Windows を除外する node affinity | Controller Pod の affinity。テンプレート既定の pod anti-affinity と併用される。 |
| `controller.tolerations` | array | `[]` | Controller Pod の toleration。 |
| `controller.nodeSelector` | map | `{}` | Controller Pod の node selector。 |
| `controller.resources` | object | `{}` | Controller コンテナーの CPU・メモリー requests/limits。 |
| `controller.imagePullSecrets` | array | `[]` | Controller イメージを private registry から取得するための Secret 参照。各要素は `name` を持つ。 |

デフォルトの affinity は Windows ノードを除外する。

```yaml
controller:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: kubernetes.io/os
                operator: NotIn
                values:
                  - windows
```

### TaskRun へ注入するイメージ

これらは Controller 自身ではなく、Controller が TaskRun Pod などへ注入する内部イメージを
指定する。

| パラメーター | デフォルトのイメージ | 詳細 |
| --- | --- | --- |
| `controller.images.entrypoint` | `ghcr.io/tektoncd/pipeline/entrypoint-...:v1.14.0@sha256:e3e7...a522` | Step の実行順序、終了状態、結果を管理する entrypoint イメージ。 |
| `controller.images.nop` | `ghcr.io/tektoncd/pipeline/nop-...:v1.14.0@sha256:4768...649f` | Step や sidecar の置換などに使う no-op イメージ。 |
| `controller.images.sidecarlogresults` | `ghcr.io/tektoncd/pipeline/sidecarlogresults-...:v1.14.0@sha256:db61...26f4` | sidecar log から Task result を収集するイメージ。 |
| `controller.images.workingdirinit` | `ghcr.io/tektoncd/pipeline/workingdirinit-...:v1.14.0@sha256:7f93...762d` | Step の working directory を初期化するイメージ。 |
| `controller.images.shellImage` | `cgr.dev/chainguard/busybox@sha256:19f0...791` | Linux 用の shell イメージ。 |
| `controller.images.shellImageWin` | `mcr.microsoft.com/powershell:nanoserver@sha256:b6d5...54d6` | Windows 用の PowerShell イメージ。 |

`...` で省略した完全なイメージ名と digest は、調査対象の `values.yaml` を参照すること。
Tekton の構成イメージには互換性が必要なため、通常は Chart と同じリリースの組み合わせを維持する。

## Webhook

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `webhook.deployment.image` | string | `ghcr.io/tektoncd/pipeline/webhook-...:v1.14.0@sha256:dab2...a867` | Admission Webhook コンテナーのイメージ。デフォルトは digest で固定されている。 |
| `webhook.deployment.labels` | map | `{}` | Webhook の Deployment に追加するラベル。 |
| `webhook.pod.labels` | map | `{}` | Webhook Pod に追加するラベル。 |
| `webhook.envFromSecret` | string | `tekton-env` | Webhook の環境変数を読み込む Secret 名。Secret 参照は optional。 |
| `webhook.affinity` | object | Windows を除外する node affinity | Webhook Pod の affinity。テンプレート既定の pod anti-affinity と併用される。 |
| `webhook.tolerations` | array | `[]` | Webhook Pod の toleration。 |
| `webhook.nodeSelector` | map | `{}` | Webhook Pod の node selector。 |
| `webhook.imagePullSecrets` | array | `[]` | Webhook イメージ用の image pull Secret 参照。 |

`webhook.resources` と `webhook.pod.annotations` はパラメーター化されていない。
Webhook の resources はテンプレート内で requests が `100m` / `100Mi`、limits が
`500m` / `500Mi` に固定されている。

## Remote Resolvers

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `remoteresolver.deployment.image` | string | `ghcr.io/tektoncd/pipeline/resolvers-...:v1.14.0@sha256:7516...dbf9` | Remote Resolution Controller のイメージ。 |
| `remoteresolver.affinity` | object | `{}` | Resolver Pod の affinity。テンプレートには Windows を除外する node affinity と pod anti-affinity も定義されている。 |
| `remoteresolver.tolerations` | array | `[]` | Resolver Pod の toleration。 |
| `remoteresolver.nodeSelector` | map | `{}` | Resolver Pod の node selector。 |
| `remoteresolver.resources.requests.cpu` | quantity | `100m` | Resolver コンテナーが要求する CPU。 |
| `remoteresolver.resources.requests.memory` | quantity | `100Mi` | Resolver コンテナーが要求するメモリー。 |
| `remoteresolver.resources.limits.cpu` | quantity | `1000m` | Resolver コンテナーの CPU 上限。 |
| `remoteresolver.resources.limits.memory` | quantity | `4Gi` | Resolver コンテナーのメモリー上限。 |
| `remoteresolver.imagePullSecrets` | array | `[]` | Resolver イメージ用の image pull Secret 参照。 |

## Events Controller

| パラメーター | 型 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| `eventscontroller.deployment.image` | string | `ghcr.io/tektoncd/pipeline/events-...:v1.14.0@sha256:7ccd...cd21` | Tekton Events Controller のイメージ。 |
| `eventscontroller.imagePullSecrets` | array | `[]` | Events Controller イメージ用の image pull Secret 参照。 |

Events Controller の affinity、node selector、toleration、resources は
`values.yaml` でパラメーター化されていない。

## `config-defaults` ConfigMap

`configDefaults` の直下に指定したキーと値は、そのまま `config-defaults` ConfigMap の
`data` に出力される。デフォルトでは説明用の `_example` だけが存在し、その文字列内に
書かれた設定は実際の設定として機能しない。利用するキーを `_example` の外へ追加する。

```yaml
configDefaults:
  default-timeout-minutes: "90"
  default-service-account: tekton-bot
```

| キー | 例・デフォルト | 詳細 |
| --- | --- | --- |
| `configDefaults._example` | 説明用の複数行文字列 | 利用可能な設定例を ConfigMap 内に残すための非機能キー。 |
| `configDefaults.default-timeout-minutes` | `"60"` | TaskRun と PipelineRun に timeout がない場合のデフォルト時間（分）。 |
| `configDefaults.default-service-account` | `default` | TaskRun と PipelineRun に ServiceAccount 指定がない場合のデフォルト名。 |
| `configDefaults.default-managed-by-label-value` | `tekton-pipelines` | TaskRun が作成する Pod の `app.kubernetes.io/managed-by` ラベルのデフォルト値。ユーザー指定が優先される。 |
| `configDefaults.default-pod-template` | 未設定 | TaskRun と PipelineRun にマージするデフォルト Pod template。ConfigMap の値として複数行 YAML を渡す。 |
| `configDefaults.default-affinity-assistant-pod-template` | 未設定 | Affinity Assistant Pod にマージするデフォルト Pod template。 |
| `configDefaults.default-cloud-events-sink` | 未設定 | TaskRun と PipelineRun のデフォルト CloudEvents sink。未設定ならイベントを送信しない。 |
| `configDefaults.default-task-run-workspace-binding` | 未設定 | TaskRun が明示しなかった Workspace に与えるデフォルト binding。例は `emptyDir: {}`。 |
| `configDefaults.default-max-matrix-combinations-count` | `"256"` | Matrix から生成できる組み合わせ数のデフォルト上限。 |
| `configDefaults.default-forbidden-env` | 未設定 | Pod template から上書きできない環境変数をカンマ区切りで指定する。 |
| `configDefaults.default-resolver-type` | 未設定 | Resolver が省略された場合に使うデフォルト Resolver 種別。 |
| `configDefaults.default-imagepullbackoff-timeout` | 未設定、例 `"5m"` | `ImagePullBackOff` 後に TaskRun を再キューイングするまでの時間。`0` は即時失敗。 |
| `configDefaults.default-maximum-resolution-timeout` | 未設定、例 `"1m"` | Resolution Controller が解決処理を打ち切るまでのデフォルト時間。 |
| `configDefaults.default-container-resource-requirements` | 未設定 | TaskRun Pod 内の init container と container に補うデフォルト resources。複数行 YAML として指定する。 |
| `configDefaults.default-sidecar-log-polling-interval` | `"100ms"` | sidecar log results コンテナーが Step 完了ファイルを確認する間隔。短いほど応答性と CPU 負荷が上がる。 |
| `configDefaults.default-step-ref-concurrency-limit` | `"5"` | `step.ref` の同時解決 goroutine 数。Git、OCI、Kubernetes API への負荷を制限する。 |

`default-container-resource-requirements` は、次の名前で対象を分けられる。

- `place-scripts`: `place-scripts` コンテナー
- `prepare`: `prepare` コンテナー
- `working-dir-initializer`: working directory 初期化コンテナー
- `prefix-scripts`: 名前が `scripts-` で始まるコンテナー
- `prefix-sidecar-scripts`: 名前が `sidecar-scripts-` で始まるコンテナー
- `default`: resources が空の init container と container

## Git Resolver

`gitResolverConfig` の内容は `git-resolver-config` ConfigMap の `data` に出力される。
値には Helm の `tpl` 関数が適用される。

| パラメーター | デフォルト | 詳細 |
| --- | --- | --- |
| `gitResolverConfig.fetch-timeout` | `"1m"` | 匿名 clone による 1 回の解決処理の最大時間。 |
| `gitResolverConfig.default-url` | `https://github.com/tektoncd/catalog.git` | Resolver パラメーターで URL が省略された場合の Git URL。 |
| `gitResolverConfig.default-revision` | `main` | 匿名 clone または認証 API で revision が省略された場合の revision。 |
| `gitResolverConfig.scm-type` | `github` | 認証 API で使う SCM 種別。`github`、`gitlab`、`gitea`、`bitbucketserver`、`bitbucketcloud` を指定できる。 |
| `gitResolverConfig.server-url` | `""` | SCM API サーバー URL。github.com、gitlab.com、Bitbucket Cloud では不要。 |
| `gitResolverConfig.api-token-secret-name` | `""` | SCM API token を保持する Kubernetes Secret 名。認証 API を使う場合は必須。 |
| `gitResolverConfig.api-token-secret-key` | `""` | Secret 内で SCM API token を保持するキー。認証 API を使う場合は必須。 |
| `gitResolverConfig.api-token-secret-namespace` | `default` | SCM API token Secret が存在する Namespace。 |
| `gitResolverConfig.default-org` | `""` | 認証 API で organization が省略された場合のデフォルト organization。 |
| `gitResolverConfig.default-cache-mode` | 未設定、既定動作は `auto` | Resolver の cache 方針。`always`、`never`、`auto` を指定でき、`auto` は revision が commit hash の場合だけ cache する。 |

## Feature flags

`featureFlags` の内容は、そのまま `feature-flags` ConfigMap の `data` に出力される。
ConfigMap の制約に合わせ、boolean に見える値も文字列で指定する。

| パラメーター | デフォルト | 詳細 |
| --- | --- | --- |
| `featureFlags.coschedule` | `workspaces` | Affinity Assistant のスケジューリング方針。`workspaces`、`pipelineruns`、`isolate-pipelinerun`、`disabled` を指定できる。 |
| `featureFlags.disable-creds-init` | `"false"` | `true` にすると ServiceAccount の認証 Secret を探索して Step へ注入する処理を停止する。PipelineResources は動作しなくなる。 |
| `featureFlags.await-sidecar-readiness` | `"true"` | 最初の Step を開始する前に、TaskRun の sidecar が Running になるまで待つ。 |
| `featureFlags.running-in-environment-with-injected-sidecars` | `"true"` | Istio などによる sidecar injection がある環境向けの動作を有効にする。注入がないクラスタでは `false` にすると TaskRun の起動時間を短縮できる。 |
| `featureFlags.require-git-ssh-secret-known-hosts` | `"false"` | Git SSH Secret に `known_hosts` を必須とする。 |
| `featureFlags.enable-tekton-oci-bundles` | `"false"` | Tekton OCI bundle を有効にする。`values.yaml` では experimental と記載されている。 |
| `featureFlags.enable-api-fields` | `beta` | 利用可能な gated API fields のレベル。`stable`、`beta`、`alpha` を指定できる。 |
| `featureFlags.send-cloudevents-for-runs` | `"true"` | CustomRun の CloudEvents 送信を制御する非推奨フラグ。TaskRun と PipelineRun には影響せず、将来削除予定。 |
| `featureFlags.trusted-resources-verification-no-match-policy` | `ignore` | VerificationPolicy が一致しない場合の処理。`fail`、`warn`、`ignore` を指定できる。 |
| `featureFlags.enable-provenance-in-status` | `"true"` | TaskRun と PipelineRun の status に、解決元などの provenance 情報を格納する。 |
| `featureFlags.enforce-nonfalsifiability` | `none` | 改ざん困難な provenance の方式。`spire` または `none`。`spire` は SPIRE を利用する experimental 機能。 |
| `featureFlags.results-from` | `termination-message` | Task result の抽出元。`termination-message` または `sidecar-logs`。 |
| `featureFlags.max-result-size` | 未設定、例 `"4096"` | `results-from: sidecar-logs` の場合の Task result サイズ上限。 |
| `featureFlags.set-security-context` | `"false"` | Tekton が TaskRun へ注入するコンテナーの権限を制限し、restricted Pod Security Standards で実行しやすくする。 |
| `featureFlags.set-security-context-read-only-root-filesystem` | `"false"` | TaskRun と Affinity Assistant の全コンテナーへ `readOnlyRootFilesystem` を設定する。 |
| `featureFlags.keep-pod-on-cancel` | `"false"` | TaskRun のキャンセル時に Pod を残し、ログを確認できるようにする。 |
| `featureFlags.enable-cel-in-whenexpression` | `"false"` | `WhenExpression` で CEL 評価を有効にする。 |
| `featureFlags.enable-artifacts` | `"false"` | Step の Artifacts を有効にする。`values.yaml` では未実装の preview 機能と記載されている。 |
| `featureFlags.enable-param-enum` | `"false"` | param の `enum` による組み込み入力検証を有効にする。 |
| `featureFlags.disable-inline-spec` | `""` | inline spec を禁止するリソースをカンマ区切りで指定する。指定値は `pipeline`、`pipelinerun`、`taskrun`。 |
| `featureFlags.enable-concise-resolver-syntax` | `"false"` | 簡潔な Resolver 構文を有効にする。 |
| `featureFlags.enable-kubernetes-sidecar` | `"false"` | Kubernetes native sidecar を有効にする。 |
| `featureFlags.enable-step-actions` | `"true"` | StepActions を有効にする。コメント上は stable 機能のため `false` にしても効果がない。 |
| `featureFlags.enable-wait-exponential-backoff` | `"false"` | TaskRun または CustomRun の作成失敗時に指数 backoff で再試行する。詳細値は `wait-exponential-backoff` ConfigMap 側で調整する。 |
| `featureFlags.enable-termination-message-compression` | `"false"` | `results-from: termination-message` の場合に終了メッセージを flate 圧縮し、Kubernetes の 4 KiB 制限内へより多くの result を格納する alpha 機能。 |

### `coschedule` の値

| 値 | 動作 |
| --- | --- |
| `workspaces` | 同じ PipelineRun で PVC Workspace を共有する TaskRun を同一ノードへ配置する。 |
| `pipelineruns` | 同じ PipelineRun の全 TaskRun を同一ノードへ配置する。 |
| `isolate-pipelinerun` | 同じ PipelineRun の全 TaskRun を同一ノードへ配置し、1 ノードで同時に 1 PipelineRun だけを実行する。 |
| `disabled` | coschedule policy を適用しない。 |

## 実装上の注意点

### `values.yaml` に存在するが機能しない値

- `serviceaccount.enabled` はどのテンプレートからも参照されない。
- `false` に変更しても `tekton-bot` ServiceAccount の生成を停止できない。

### テンプレートが参照するが `values.yaml` に存在しない値

- `auth.docker.url` はコンテナーレジストリ認証 Secret の annotation で参照されるが、
  `values.yaml` にはデフォルト値がない。
- Registry 認証を利用する場合は、`auth.docker.configJson` とともに明示する必要がある。

### README の設定表は現行実装と一致しない

Chart の README には、現行 `values.yaml` に存在しない古いパラメーターが掲載されている。

- `auth.docker.username`
- `auth.docker.password`
- `image.tag`
- `image.kubeconfigwriter`
- `image.credsinit`
- `image.gitinit`
- `image.nop`
- `image.bash`
- `image.gsutil`
- `image.controller`
- `image.webhook`

現行実装では Docker 認証に `auth.docker.configJson` を使う。
各コンポーネントのイメージは `controller.deployment.image` や
`webhook.deployment.image` などで指定する。
README だけでなく、必ず対象バージョンの `values.yaml` とテンプレートを確認する必要がある。

### CRD の更新

CRD は Chart の `crds/` から初回インストールされるが、Helm 3 は `helm upgrade` で
既存 CRD を更新しない。Chart 更新時に CRD が変更されている場合は、CRD を別途
`kubectl apply` する必要がある。
