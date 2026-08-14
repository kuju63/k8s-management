# ConfigMap / Secret の作成方法

## 概要

ConfigMap / Secret にも専用ヘルパーは無く、CronJob / Job と同様に生の
`ApiObject` で直接記述する。ArgoCD の root Application は `manifests/` を
directory source・`recurse: true` で直接 watch している。そのため、これら
も個別の ArgoCD Application でラップせず、対象 namespace の Chart に直接
追加すればよい（詳細は [jobs.md](./jobs.md) の概要を参照）。

## ConfigMap のサンプル

[jobs.md](./jobs.md) の `ExampleBatchChart` に含まれている例（再掲）。
CronJob/Job から `envFrom` で参照する値をまとめている。

```ts
new ApiObject(this, "configmap-example", {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "app-config", namespace: NAMESPACE },
    data: {
        LOG_LEVEL: "info",
        FEATURE_FLAG_X: "true",
    },
});
```

コンテナ側からは `envFrom` で丸ごと環境変数として取り込める。

```ts
containers: [
    {
        name: "worker",
        image: "example.registry/worker:1.0.0",
        envFrom: [
            { configMapRef: { name: "app-config" } },
            { secretRef: { name: "app-secret" } },
        ],
    },
],
```

## Secret の運用方針（このリポジトリでの正式な方法）

このリポジトリには SOPS / sealed-secrets / external-secrets のような
Secret 暗号化・外部連携の仕組みは**導入されていない**。

`pnpm run synth` の出力先である `manifests/` は git 管理対象。ArgoCD の
root Application はこの `manifests/` を直接 source にしている。つまり
`ApiObject` で Secret の実データ（`stringData` / `data`）を書くと、その
平文が synth 後の YAML ごと git 履歴に残ってしまう。

そのため、このリポジトリでの正式な運用は次のパターンに統一する
（`packages/ns/arc-runners/index.ts` が実例）。

- Secret の**実体はコードに書かない**。コード側は Secret の**名前
  （文字列）だけ**を参照する
- Secret の実体は、事前に `kubectl` 等でクラスタに直接作成しておく

```ts
// packages/ns/arc-runners/index.ts より抜粋（一部省略）
createHelmApplication(this, "argocd-application", {
    name: "arc-runners",
    namespace: NAMESPACE,
    repoUrl: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
    targetRevision: "0.14.2",
    valuesObject: {
        githubConfigUrl: "https://github.com/TODO-org/TODO-repo",
        // 実体ではなく、事前に作成済みの Secret 名だけを渡す。
        // "TODO-..." は対象リポジトリ未確定のための仮値であり、
        // 値そのものが推奨パターンというわけではない。
        githubConfigSecret: "TODO-github-config-secret",
        controllerServiceAccount: {
            namespace: "actions-runner-system",
            name: "arc-controller-gha-rs-controller",
        },
    },
});
```

手動で Secret を作成する例を示す。

```sh
kubectl create secret generic app-secret \
  --from-literal=API_KEY=xxxxx \
  -n example-batch
```

ArgoCD の `syncPolicy.automated.selfHeal` は有効。参照先の Secret を作成
する前に Pod だけが sync されると、`CreateContainerConfigError` などで
起動に失敗する。新しい Secret 名を参照するリソースを追加するときは、
sync が走る前に Secret の実体を作成しておくこと。

## 参考: Secret リソースを cdk8s で直接書く場合の構文

構文として成立することを示す参考例。**このリポジトリでは実運用として
使わない**（前節のとおり、`manifests/` がコミットされることで平文が
git 履歴に残るため）。

```ts
// 参考: 構文として成立することを示すのみ。
// このリポジトリでは実際の秘密値をここに書かない
// （manifests/ がgit管理対象のため、コミットに平文が残る）。
new ApiObject(this, "secret-example", {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "app-secret-managed-by-cdk8s", namespace: NAMESPACE },
    type: "Opaque",
    stringData: {
        EXAMPLE_KEY: "placeholder-not-a-real-secret",
    },
});
```

## デプロイまでの手順

1. 既存 namespace への追加であれば、対象 `packages/ns/<namespace>/index.ts`
   にリソースを追記する。新規 namespace の場合は Chart を新規作成する
2. 新規 namespace の場合のみ、`packages/main.ts` の `buildApp()` に
   `new XxxChart(app);` を追加する
3. `pnpm run synth` を実行し、`manifests/` に生成された YAML の差分を確認する
4. 差分を commit し、リモートへ push する
5. ArgoCD の root Application が変更を検知し、自動的に sync する
6. Secret を参照するリソースを追加する場合は、sync が走る前に
   `kubectl create secret` 等で Secret の実体を作成しておく

## 動作確認のヒント

```sh
kubectl get configmap,secret -n example-batch
kubectl describe secret app-secret -n example-batch
```

`describe secret` は値そのものを表示しない（キー名とデータサイズのみ）。
中身を確認したい場合は、次のように取り出す。

```sh
kubectl get secret app-secret -n example-batch \
  -o jsonpath='{.data.API_KEY}' | base64 -d
```
