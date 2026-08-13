# k8s-management

自宅k8sクラスタの運用系・サービス系リソースを [cdk8s](https://cdk8s.io/) で
宣言的に生成する。

`packages/main.ts` が cdk8s App を組み立て、`manifests/` 配下に namespace
ごとの YAML を synth する。生成物は Namespace と ArgoCD `Application`
（App-of-Apps方式）、および MetalLB/Gateway API 等の設定用 CRD となる。
各コンポーネント本体（Prometheus/Grafana等）は ArgoCD が Helm チャートを
sync して導入する。

## 前提

- `direnv`（`.envrc` で `flake.nix` の devShell を自動読み込み）。
  手動なら `nix develop` でも可
- devShell には `kubectl` が含まれるが、対象クラスタの kubeconfig
  context は別途用意する必要がある

## ブートストラップ手順（手動・初回のみ）

ArgoCD 自体はこのリポジトリのコードだけでは導入できない。ArgoCDがまだ
存在しないクラスタに `Application` リソースだけを投入しても、解釈する
コントローラが存在しないためだ。そのため、以下の手順だけは手動で
行う。

1. kubectl で対象クラスタへアクセスできる状態にする
   （`kubectl config current-context` で確認）
2. ArgoCD 本体を手動でインストールする（例）

   ```sh
   kubectl create namespace argocd
   helm install argocd argo-cd \
     --repo https://argoproj.github.io/argo-helm \
     --namespace argocd
   ```

3. ArgoCD の Pod が起動するまで待つ

   ```sh
   kubectl -n argocd rollout status deploy/argocd-server
   ```

4. `packages/lib/config.ts` の `GIT_REPO_URL` がこのリポジトリの実URLに
   なっていることを確認する
5. manifest を synth する

   ```sh
   pnpm run synth
   ```

6. root Application（App-of-Apps）だけを手動 apply し、以降の管理を
   ArgoCD に引き渡す

   ```sh
   kubectl apply -f manifests/argocd.k8s.yaml
   ```

   このファイルには `argocd` namespace・root Application を含む。
   ArgoCD自身を管理する Application と、ArgoCD UI 用 HTTPRoute も含む。
   root Application が Synced になれば、以降は ArgoCD が自動的に
   反映する。対象は `manifests/` 配下の残り全ファイル（MetalLB・
   Envoy Gateway・ARC・Prometheus/Grafana/Loki/Jaeger・apps 等）である。

7. （任意）残りの namespace を先に反映させたい場合は `pnpm run apply` で
   `manifests/` 全体を一括 kubectl apply してもよい。ただし MetalLB の
   `IPAddressPool` や Gateway API の `Gateway` など CRD インスタンスは、
   対応する CRD（各コンポーネントのHelmチャート由来）がまだ無い
   1回目は適用に失敗しうる。ArgoCD が該当Helmチャートを sync した後に
   再度 `pnpm run apply` すれば解消する

## 日常運用

```sh
pnpm run synth   # manifests/ を再生成するだけ
pnpm run apply   # 再生成してから kubectl apply -R -f manifests/ まで行う
```

`packages/ns/<namespace>/index.ts` を編集し、`pnpm run synth` の差分を
確認してからコミット・pushすれば、あとは ArgoCD が検知して自動同期する。

## 未解決の TODO（初回反映前に埋める必要がある）

- 各 `createHelmApplication` の `repoUrl`/`chart`/`targetRevision` は
  要検証（upstream の最新値を確認する）
- `packages/ns/arc-runners/index.ts`: `githubConfigUrl`/
  `githubConfigSecret`（対象GitHubリポジトリ・事前作成するSecret名）
- `packages/ns/apps/index.ts`: 自作レビューサービスの実リポジトリURL
- Grafana/ArgoCD UI への認証（BasicAuth/OAuth2 Proxy等）はスコープ外。
  Envoy Gateway の `SecurityPolicy` 等で別途設定する
