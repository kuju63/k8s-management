<!-- markdownlint-disable MD013 -->

# Tekton Pipeline の使い方とカスタマイズ

## このドキュメントの対象

このドキュメントは、Forgejo リポジトリの開発者が Tekton Pipeline で CI を
実行・カスタマイズするための利用者向けガイドである。Tekton Pipelines 本体や
Pipelines as Code（PAC）をクラスタへ導入する運用者向けの手順ではない。
クラスタ側は次のディレクトリで管理している。

- `packages/ns/tekton-pipelines/`
- `packages/ns/pipelines-as-code/`
- `packages/ns/tekton-ci/`

対象クラスタでは、次の3つがすでに稼働している前提とする。

- Tekton Pipelines 本体（`tekton-pipelines` namespace）
- Pipelines as Code（`pipelines-as-code` namespace）
- Forgejo の `kurihara/sharp-plugin` を監視する Repository CR（`tekton-ci` namespace）

Repository CR の実体は `packages/ns/tekton-ci/index.ts` で宣言している。
別のリポジトリを CI 対象へ追加する場合は、Repository CR を対象ごとに作成する。

## 全体像

このクラスタの CI は Pipelines as Code 方式で動く。パイプラインの定義は
Kubernetes 側ではなく、**対象リポジトリの `.tekton/` ディレクトリに置いた
YAML** が単一の情報源になる。

```text
Forgejo で push / PR
  → Webhook が pipelines-as-code コントローラへ届く
  → コントローラが対象コミットの .tekton/ を読む
  → イベントに一致する PipelineRun を tekton-ci namespace で実行
  → 結果を Forgejo の commit status へ返す
```

重要なのは、**パイプラインを変えたいときは対象リポジトリの `.tekton/` を編集して
push する**という点である。この k8s-management リポジトリの変更は不要である
（Repository CR や PAC の設定を変える場合を除く）。

このクラスタの Repository CR は `pipelinerun_provenance: default_branch` を
設定している。そのため PAC は、PR で持ち込まれた `.tekton/` ではなく、
**デフォルトブランチ（`main` など）の `.tekton/` を読む**。パイプライン定義自体を
変更・レビューするには、デフォルトブランチへマージする必要がある。これは、PR で
任意のパイプラインを実行させない安全策である。

## 最小の PipelineRun を作る

対象リポジトリ（`sharp-plugin`）のルートに `.tekton/` ディレクトリを作り、
`.tekton/pull-request.yaml` を置く。次の例は、PR とデフォルトブランチへの push で
リポジトリを clone し、コミットの SHA を表示するだけの最小構成である。

```yaml
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  name: sharp-plugin-ci
  annotations:
    # イベント一致条件。両方必須（CEL やコメント条件を使う場合を除く）。
    pipelinesascode.tekton.dev/on-event: "[pull_request, push]"
    pipelinesascode.tekton.dev/on-target-branch: "[main]"
    # Artifact Hub から git-clone Task を取得してインライン化する。
    pipelinesascode.tekton.dev/task: "git-clone"
spec:
  params:
    - name: repo_url
      value: "{{ repo_url }}"
    - name: revision
      value: "{{ revision }}"
  pipelineSpec:
    params:
      - name: repo_url
      - name: revision
    workspaces:
      - name: source
    tasks:
      - name: fetch-repository
        taskRef:
          name: git-clone
        params:
          - name: url
            value: "$(params.repo_url)"
          - name: revision
            value: "$(params.revision)"
        workspaces:
          - name: output
            workspace: source
      - name: show-revision
        runAfter:
          - fetch-repository
        workspaces:
          - name: source
            workspace: source
        taskSpec:
          workspaces:
            - name: source
          steps:
            - name: show
              image: alpine
              script: |
                #!/bin/sh
                echo "checked out $(params.revision)"
                ls -la $(workspaces.source.path)
  workspaces:
    - name: source
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 1Gi
```

これをデフォルトブランチへマージすると、以降の PR と `main` への push で
PipelineRun が実行され、結果が Forgejo のコミットに表示される。

### 動的変数

`{{ ... }}` は PAC がイベントごとに実際の値へ置き換える動的変数である。
よく使うものは次のとおり。

| 変数 | 内容 |
| --- | --- |
| `{{ repo_url }}` | リポジトリの URL |
| `{{ revision }}` | イベント対象コミットの完全な SHA |
| `{{ source_branch }}` | イベント元のブランチ名 |
| `{{ target_branch }}` | イベント対象のブランチ名。push では `source_branch` と同じ |
| `{{ pull_request_number }}` | PR 番号（`pull_request` イベント時） |
| `{{ sender }}` | イベントを起こしたユーザー名 |
| `{{ git_auth_secret }}` | private リポジトリ clone 用に自動生成される Secret 名 |

## イベント一致の条件

どのイベントで PipelineRun を動かすかは、`metadata.annotations` で指定する。
`on-event` と `on-target-branch` は原則として両方必須である。

### イベントとブランチで一致させる

```yaml
annotations:
  pipelinesascode.tekton.dev/on-event: "[pull_request]"
  pipelinesascode.tekton.dev/on-target-branch: "[main]"
```

複数ブランチはカンマ区切りで指定する。

```yaml
  pipelinesascode.tekton.dev/on-target-branch: "[main, release-nightly]"
```

### push・タグ push で一致させる

`refs/heads/`、`refs/tags/` の完全な ref か、短縮形を指定できる。glob も使える。

```yaml
# main への push
annotations:
  pipelinesascode.tekton.dev/on-event: "[push]"
  pipelinesascode.tekton.dev/on-target-branch: "[refs/heads/main]"
```

```yaml
# 1. で始まるすべてのタグ push
annotations:
  pipelinesascode.tekton.dev/on-event: "[push]"
  pipelinesascode.tekton.dev/on-target-branch: "[refs/tags/1.*]"
```

複数の PipelineRun が同じイベントに一致した場合、PAC はそれらを並列に実行し、
それぞれの結果を Forgejo へ個別に返す。用途ごとにファイルを分けてよい
（例: `.tekton/pull-request.yaml` と `.tekton/push.yaml`）。

## パイプラインをカスタマイズする

### Task を追加する

一般的な処理は Artifact Hub 上に公開された Task を再利用できる。取得したい Task を
`pipelinesascode.tekton.dev/task` annotation に列挙すると、PAC が解決時に
PipelineRun へインライン展開する。

```yaml
annotations:
  # 複数指定は配列で。
  pipelinesascode.tekton.dev/task: "[git-clone, golang-test]"
```

バージョンを固定する場合はコロンで指定する。

```yaml
  pipelinesascode.tekton.dev/task: "git-clone:0.9.0"
```

annotation で取得した Task は、`taskRef.name` で名前参照するだけでよい。
`resolver: hub` は付けないこと（PAC のインライン展開とは別方式であり、併用すると
名前を URI と解釈して失敗する）。

```yaml
tasks:
  - name: fetch-repository
    taskRef:
      name: git-clone
```

### 管理者が提供する共通 Task を使う

管理者が複数リポジトリ向けに用意した共通 Task は、`tekton-ci` namespace にある。
Tekton の Cluster Resolver を使い、`kind`、`name`、`namespace` を指定して参照する。
PAC の `pipelinesascode.tekton.dev/task` annotation は不要である。

```yaml
spec:
  pipelineSpec:
    workspaces:
      - name: source
    tasks:
      - name: test
        taskRef:
          resolver: cluster
          params:
            - name: kind
              value: task
            - name: name
              value: node-test-v1
            - name: namespace
              value: tekton-ci
        params:
          - name: node-image
            value: node:22-alpine
          - name: test-command
            value: npm test
        workspaces:
          - name: source
            workspace: source
```

共通 Task の名前には互換性の世代が付く（例: `node-test-v1`）。管理者が `v2` を
追加しても `v1` の利用者は自動では切り替わらない。移行内容を確認してから、
`taskRef.params` の `name` を新しい名前へ変更する。

利用可能な共通 Task、各パラメーター、Workspace、Result は、管理者が提供する一覧を
確認する。共通 Task が見つからない場合は、Task 名と namespace が正しいかを確認する。
管理者向けの定義方法は [tekton-administration.md](./tekton-administration.md) を参照する。

### 管理者が提供する共通 Pipeline を使う

ビルド手順全体が共通化されている場合は、PipelineRun の `pipelineRef` から
共通 Pipeline を Cluster Resolver で参照する。

```yaml
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  name: sharp-plugin-ci
  annotations:
    pipelinesascode.tekton.dev/on-event: "[pull_request, push]"
    pipelinesascode.tekton.dev/on-target-branch: "[main]"
spec:
  pipelineRef:
    resolver: cluster
    params:
      - name: kind
        value: pipeline
      - name: name
        value: node-ci-v1
      - name: namespace
        value: tekton-ci
  params:
    - name: repo-url
      value: "{{ repo_url }}"
    - name: revision
      value: "{{ revision }}"
    - name: node-image
      value: node:22-alpine
  workspaces:
    - name: source
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 1Gi
    - name: basic-auth
      secret:
        secretName: "{{ git_auth_secret }}"
```

共通 Pipeline が宣言するパラメーターと Workspace 名は契約である。利用側の
PipelineRun は、その必須項目をすべて渡す。Pipeline の内部 Task や実行順は
管理者側で管理するため、利用者が個別に複製しない。

### Task を自分で書く

`.tekton/` 配下に置いた `Task` は PAC が解決対象にする。Pipeline から
`taskRef` で名前参照できる。ただし、パイプライン定義と同じく、変更を反映するには
デフォルトブランチへマージする必要がある。

Task は `steps` の並びで処理を定義する。`script` を書くと、その内容が
コンテナ内のスクリプトとして実行される。shebang がない場合は `#!/bin/sh` が
前置される。

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: lint
spec:
  workspaces:
    - name: source
  steps:
    - name: run-lint
      image: node:22-alpine
      workingDir: $(workspaces.source.path)
      script: |
        #!/bin/sh
        set -e
        npm ci
        npm run lint
```

インライン展開を避ける場合は、`.tekton/` 内のファイルを直接参照できる。

```yaml
annotations:
  pipelinesascode.tekton.dev/task: "[.tekton/tasks/lint.yaml]"
```

### パラメーターを渡す

`Pipeline`（または `pipelineSpec`）で `params` を宣言し、`PipelineRun` の
`spec.params` で値を渡す。値には動的変数を使える。

```yaml
spec:
  params:
    - name: revision
      value: "{{ revision }}"
  pipelineSpec:
    params:
      - name: revision
        type: string
    tasks:
      - name: build
        params:
          - name: revision
            value: "$(params.revision)"
        taskSpec:
          params:
            - name: revision
              type: string
          steps:
            - name: build
              image: node:22-alpine
              script: |
                #!/bin/sh
                echo "building $(params.revision)"
```

`type` は `string`（既定）、`array`、`object` を指定できる。

### Workspace で Step 間・Task 間のデータを共有する

clone したソースを後続 Task に渡すなど、ファイルを共有するには Workspace を使う。
PipelineRun 側では `volumeClaimTemplate`（PVC を都度作成）や `emptyDir`
（Pod 内一時領域）で実体を割り当てる。

```yaml
  workspaces:
    - name: source
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 1Gi
```

PVC を使うには、動的プロビジョニング可能な StorageClass が対象クラスタに必要となる。
永続化が不要で Task 間共有だけが目的なら `emptyDir: {}` で足りる。

### private リポジトリを clone する

`sharp-plugin` が private の場合、PAC が PipelineRun ごとに Git 認証情報を
持つ Secret を自動生成する。`git-clone` Task は、その Secret を `basic-auth`
Workspace として受け取る。Secret 名は動的変数 `{{ git_auth_secret }}` で参照する。

```yaml
spec:
  workspaces:
    - name: basic-auth
      secret:
        secretName: "{{ git_auth_secret }}"
    - name: source
      volumeClaimTemplate:
        spec:
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 1Gi
  pipelineSpec:
    workspaces:
      - name: basic-auth
      - name: source
    tasks:
      - name: fetch-repository
        taskRef:
          name: git-clone
        params:
          - name: url
            value: "{{ repo_url }}"
          - name: revision
            value: "{{ revision }}"
        workspaces:
          - name: basic-auth
            workspace: basic-auth
          - name: output
            workspace: source
```

### Step ごとのリソース要求・タイムアウト

Step 単位で CPU・メモリーの要求や上限、タイムアウトを設定できる。

```yaml
steps:
  - name: build
    image: node:22-alpine
    computeResources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: "1"
        memory: 2Gi
    timeout: 10m
    script: |
      #!/bin/sh
      npm ci && npm run build
```

## 実行結果の確認とローカル検証

- 実行状況と結果は Forgejo の PR・コミットの status に表示される。
- クラスタ側で詳細を見る場合は、`tekton-ci` namespace の PipelineRun を確認する。

  ```sh
  kubectl -n tekton-ci get pipelinerun
  kubectl -n tekton-ci describe pipelinerun <name>
  ```

- push する前にパイプライン定義を検証したい場合は、`tkn pac resolve` で
  ローカル解決を試せる（`tkn` と `tkn-pac` CLI が必要）。

  ```sh
  tkn pac resolve -f .tekton/pull-request.yaml
  ```

## つまずきやすい点

- **PipelineRun が起動しない**
  `on-event` と `on-target-branch` の両方があるか、対象ブランチ名が一致して
  いるかを確認する。annotation が無いと一致しない。
- **`.tekton/` の変更が反映されない**
  このクラスタは `pipelinerun_provenance: default_branch` を使う。
  デフォルトブランチの `.tekton/` が読まれるため、PR ブランチだけの変更は反映されない。
- **PipelineRun 名の重複**
  同名の PipelineRun は一致対象から除外される。定義ごとに一意な `name` を付ける。
- **`taskRef.name` と `resolver: hub` の併用エラー**
  annotation で取得した Task は名前参照のみとし、`resolver: hub` は付けない。

## 参考

- Tekton PipelineRuns: <https://tekton.dev/docs/pipelines/pipelineruns/>
- Tekton Tasks: <https://tekton.dev/docs/pipelines/tasks/>
- PAC PipelineRun の記述: <https://pipelinesascode.com/docs/guides/creating-pipelines/>
- PAC イベント一致: <https://pipelinesascode.com/docs/guides/event-matching/>
- PAC Resolver（Task 取得）: <https://pipelinesascode.com/docs/guides/pipeline-resolution/>
