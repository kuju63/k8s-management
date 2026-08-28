# ConfigMap / Secret の作成方法

## 概要

ConfigMap と Secret は扱いが異なる。ConfigMap は専用ヘルパーが無く、
CronJob / Job と同じく生の `ApiObject` で直接記述する。一方 Secret は、
sealed-secrets を GitOps の正式経路として使う。

ArgoCD の root Application は `manifests/` を directory source・
`recurse: true` で直接 watch している。そのため、いずれも個別の
ArgoCD Application でラップせず、対象 namespace の Chart に直接追加すればよい。
詳細は [jobs.md](./jobs.md) の概要を参照。

`SealedSecret` を生成する専用ヘルパー
[`createSealedSecret`](../packages/lib/sealed-secret.ts) を使う方法は、
[SealedSecret の運用](#sealedsecret-の運用このリポジトリでの正式な方法)で述べる。
作成済みの ConfigMap / Secret を削除する手順は
[resource-deletion.md](./resource-deletion.md) を参照。

## ConfigMap のサンプル

[jobs.md](./jobs.md) の `ExampleBatchChart` に含まれている例（再掲）。
CronJob / Job から `envFrom` で参照する値をまとめている。

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

## SealedSecret の運用（このリポジトリでの正式な方法）

このリポジトリでは sealed-secrets を GitOps の正式経路として導入している。
sealed-secrets コントローラは
[`kube-system`](../manifests/kube-system.k8s.yaml) に sync される。
このコントローラが `bitnami.com/v1alpha1` の `SealedSecret` を
クラスタで unseal し、通常の `Secret` に展開する。

`pnpm run synth` の出力先である `manifests/` は git 管理対象である。
ArgoCD の root Application は、この `manifests/` を直接 source にしている。
そのため、Secret の実データ（平文）を `ApiObject` の `stringData` に書くと、
平文が synth 後の YAML ごと git 履歴に残ってしまう。

この制約を回避するため、Secret の実体をコードに含めない。代わりに、
`kubeseal` で暗号化した `SealedSecret` を git にコミットする。
暗号化済みの値は、コントローラの秘密鍵が保護されている限り、
安全にコミットできる。値の更新も GitOps 経由で完結する点が主な利点だ。

`SealedSecret` を生成する専用ヘルパーとして
[`createSealedSecret`](../packages/lib/sealed-secret.ts) が用意されている。
このヘルパーを使うと `encryptedData` をコード内で宣言できる。
また、生成した `SealedSecret` の名前などを後続の処理から参照できる。

### SealedSecret の通常のフロー（推奨）

Secret の値を更新・追加するときは、次の手順で行う。この方法なら、
クラスタへ直接 `kubectl create secret` する手作業は不要になる。

1. 操作対象のクラスタとコントローラを確認する。

   `kubeseal` は通常、現在の kubeconfig context を使ってコントローラから
   公開証明書を取得する。別クラスタの証明書で暗号化すると、対象クラスタでは
   unseal できない。実行前に context とコントローラの稼働状態を確認する。

   ```sh
   kubectl config current-context
   kubectl get deployment sealed-secrets-controller -n kube-system
   ```

1. 更新・追加したい平文を `kubeseal` で暗号化する。

   ```sh
   # 平文の Secret はクラスタに作らず（--dry-run=client）、
   # kubeseal で SealedSecret の YAML を生成する
   kubectl create secret generic app-secret \
     --from-literal=API_KEY=new-value \
     -n example-batch \
     --dry-run=client -o json \
   | kubeseal --format yaml > sealed-app-secret.yaml
   ```

   実際の秘密値をコマンドラインへ直接記述すると、シェル履歴などに残る
   可能性がある。運用時は、標準入力や履歴に残らない入力方法を利用する。

   `spec.encryptedData` の値は、`kubeseal` が非対称暗号化した
   base64 エンコード文字列である。コントローラの秘密鍵が保護されていれば、
   **コミットしても安全**だ。

   `kubeseal` は対象 Secret の `name` / `namespace` を暗号化に反映する。
   既定の `strict` スコープでは、コードで指定する `name` / `namespace` と
   厳密に一致しなければならない。一致しない場合、コントローラは復号に失敗する。
   `--scope namespace-wide` または `--scope cluster-wide` を指定すると、
   この一致要件が緩和される。本リポジトリでは原則として既定値を使用する。

1. `spec.encryptedData` の値を `createSealedSecret(...)` の
   `encryptedData` に指定し、`pnpm run synth` する。

   ```ts
   // packages/ns/example-batch/index.ts
   createSealedSecret(this, {
     name: "app-secret",
     namespace: NAMESPACE,
     encryptedData: {
       // sealed-app-secret.yaml の spec.encryptedData から抽出した値
       API_KEY: "AgBy7wIA...encrypted-by-kubeseal...",
     },
   });
   ```

1. `manifests/` の差分を確認して commit・push する。

   ArgoCD の root Application が変更を検知する。その後、sealed-secrets
   コントローラが unseal して `Secret` を生成する。

   `Secret` を参照する Pod と同時に sync すると、Secret が生成されるまで
   Pod が一時的に `CreateContainerConfigError` になる可能性がある。
   Pod は Secret の生成後に起動できるが、エラーを避けたい場合は変更を分ける。
   先に `SealedSecret` を反映し、Secret の生成を確認してから Pod を反映する。

### SealedSecret への値追加・改名

- **キーを1つ追加する**: 追加分を `kubeseal` で暗号化し、その値を
  `encryptedData` に追記して synth・commit する。既存のキーは変わらない。
- **SealedSecret を改名・移動する**: `strict` スコープでは、`name` と
  `namespace` が暗号化に含まれる。別名や別 namespace へそのまま移動しても
  unseal できない。移動先の値を指定して `kubeseal` し直す必要がある。

### シーリング鍵のバックアップと漏えい時の注意

コントローラの秘密鍵を失うと、既存の `SealedSecret` を新しいクラスタで
unseal できない。クラスタの復旧を想定し、シーリング鍵を安全な場所へ
バックアップする。バックアップには秘密鍵が含まれるため、
**このリポジトリにはコミットしない**。

シーリング鍵が漏えいした場合、git 履歴にある過去の `SealedSecret` も
復号される可能性がある。新しいシーリング鍵を用意するだけでは不十分である。
各サービス側で実際のパスワードやトークンを失効・再発行し、
新しい値を改めて seal する。

### 素の Secret を `kubectl` で手動作成する場合（代替手段）

通常は sealed-secrets を使う。以下は、素の Secret を手動で作成する
**例外的な代替手段**の説明だ。SOPS / external-secrets のような、
他の暗号化・外部連携の仕組みは未導入である。この代替経路も推奨されない。

素の Secret を手動で作成しても、その実体は git には残らない。
一方で GitOps の管理外となり、再現性を失う。クラスタ再構築時には
作り直す必要があり、変更履歴も追えない。そのため、通常は
sealed-secrets のみを使う。手動作成は、次の場合に限る。

- sealed-secrets コントローラをまだ導入していない環境の
  初回ブートストラップ
- コントローラが壊れて unseal できない場合のトラブルシューティング

手動で作成する場合は `kubectl create secret` を使う。

```sh
kubectl create secret generic app-secret \
  --from-literal=API_KEY=new-value \
  -n example-batch
```

この場合、コード側は Secret の実体ではなく名前だけを参照する。
例として、このリポジトリの
[`arc-runners`](../packages/ns/arc-runners/index.ts) は、事前に作成済みの
Secret 名を `githubConfigSecret` に渡している。

```ts
// packages/ns/arc-runners/index.ts より抜粋（一部省略）
createHelmApplication(this, "argocd-application", {
    name: "arc-runners",
    namespace: NAMESPACE,
    repoUrl: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
    targetRevision: "0.14.2",
    valuesObject: {
        githubConfigUrl: "https://github.com/kuju63",
        // 実体ではなく、事前作成済みの Secret 名だけを渡す。
        githubConfigSecret: "github-config-secret",
        controllerServiceAccount: {
            namespace: "actions-runner-system",
            name: "arc-controller-gha-rs-controller",
        },
    },
});
```

ArgoCD の `syncPolicy.automated.selfHeal` は有効である。参照先の Secret を
作る前に Pod だけが先に sync されると、`CreateContainerConfigError` 等で
起動に失敗する可能性がある。新しい Secret 名を参照するリソースを
追加するときは、sync 前に Secret が存在することを確認する。

## 参考: Secret リソースを cdk8s で直接書く場合の構文

構文として成立することを示す参考例。**本リポジトリでは実運用に使わない**。
`manifests/` が git 管理対象のため、平文が git 履歴に残るからだ。

```ts
// 参考: 構文として成立するのみ。
// 本リポジトリでは実際の秘密値をここに書かない
// （manifests/ が git 管理対象のため、git 履歴に平文が残る）。
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

1. 既存 namespace へ追加する場合は、対象の
   `packages/ns/<namespace>/index.ts` にリソースを追記する。
   新規 namespace の場合は Chart を新規作成する。
1. 新規 namespace の場合のみ、`packages/main.ts` の `buildApp()` に
   `new XxxChart(app);` を追加する。
1. `pnpm run synth` を実行し、`manifests/` に生成された YAML の
   差分を確認する。
1. 差分を commit し、リモートへ push する。
1. ArgoCD の root Application が変更を検知し、自動的に sync する。
1. Secret を参照するリソースを追加した場合は、参照先の Secret が
   生成されたことを確認する。手動運用の場合のみ、sync 前に
   `kubectl create secret` で実体を作成する。

## 動作確認のヒント

`SealedSecret` の状態と、生成された Secret を確認する。

```sh
kubectl get sealedsecret,secret -n example-batch
kubectl describe sealedsecret app-secret -n example-batch
kubectl describe secret app-secret -n example-batch
```

`describe secret` は値そのものを表示しない。表示するのは、
キー名とデータサイズのみである。中身を確認したい場合は、次のように取り出す。
出力した値が端末のログ等に残らないよう注意する。

```sh
kubectl get secret app-secret -n example-batch \
  -o jsonpath='{.data.API_KEY}' | base64 -d
```
