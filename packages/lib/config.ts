/**
 * このリポジトリ自身の git リポジトリURL。
 */
export const GIT_REPO_URL = "https://github.com/kuju63/k8s-management.git";

/** ArgoCD が追従する対象ブランチ・タグ。 */
export const GIT_TARGET_REVISION = "main";

/** cdk8s synth の出力先。git 管理し、ArgoCD の root Application がここを watch する。 */
export const MANIFESTS_PATH = "manifests";

/** ArgoCD がインストールされる namespace。 */
export const ARGOCD_NAMESPACE = "argocd";

/** createContainerApplication が内部でラップする汎用 Helm チャート（コンテナ実行用）。 */
export const APP_TEMPLATE_REPO_URL = "oci://ghcr.io/bjw-s-labs/helm/app-template";

/** 運用系UIを公開する際の共通ドメインサフィックス。 */
export const CLUSTER_DOMAIN = "home.internal";

/** Envoy Gateway が持つ共有 Gateway の名前・namespace。各 HTTPRoute の parentRefs から参照する。 */
export const GATEWAY_NAME = "home-gateway";
export const GATEWAY_NAMESPACE = "envoy-gateway-system";

/** MetalLB が払い出す LoadBalancer IP のレンジ（クラスタ構成図ノートで確保した範囲）。 */
export const METALLB_ADDRESS_RANGE = "192.168.2.200-192.168.2.250";
