import { type App, ApiObject, Chart } from "cdk8s";
import { createDirectoryApplication, createHelmApplication } from "../../lib/argocd-application.js";
import { ARGOCD_NAMESPACE, CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE, MANIFESTS_PATH } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = ARGOCD_NAMESPACE;

/**
 * ns: argocd（運用系: GitOps）
 * App-of-Apps の起点。root Application が `manifests/` を再帰的に watch することで、
 * 他の namespace が生成する Helm-source Application 群・config CRD 群を ArgoCD が拾って継続的に reconcile する。
 *
 * ブートストラップ順序の制約（チキン&エッグ問題）:
 *   1. ArgoCD 自体はまだクラスタに存在しないため、初回インストールは手動（`helm install` 等）で行う必要がある。
 *   2. ArgoCD が動いた後、この Chart が生成する root Application を最初の一回だけ手動 `kubectl apply` する。
 *   3. 以降は root Application 経由で、ArgoCD 自身の Helm Application（下記 argocd-self）を含め
 *      すべてが GitOps で自己管理される。
 * このコード単体では 1. 2. を自動化できない（ノート内「初回ブートストラップは手動」の記述どおり）。
 */
export class ArgocdChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        createDirectoryApplication(this, "app-of-apps", {
            name: "app-of-apps",
            namespace: NAMESPACE,
            path: MANIFESTS_PATH,
            recurse: true,
        });

        // ArgoCD 自身の以後のアップグレードを ArgoCD 自身に管理させる（self-managing）。
        // targetRevision: 2026-08-13 時点の argo-helm/argo-cd チャート最新版。
        createHelmApplication(this, "argocd-self", {
            name: "argocd",
            namespace: NAMESPACE,
            repoUrl: "https://argoproj.github.io/argo-helm",
            chart: "argo-cd",
            targetRevision: "10.3.3",
        });

        // 運用系UIへの経路（ノートでは点線＝要認証として明示）。
        // 認証（BasicAuth/OAuth2 Proxy等）の付与は Envoy Gateway の SecurityPolicy 等で別途行う想定で、今回はスコープ外。
        new ApiObject(this, "httproute", {
            apiVersion: "gateway.networking.k8s.io/v1",
            kind: "HTTPRoute",
            metadata: { name: "argocd", namespace: NAMESPACE },
            spec: {
                parentRefs: [{ name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE }],
                hostnames: [`argocd.${CLUSTER_DOMAIN}`],
                rules: [
                    {
                        backendRefs: [{ name: "argocd-server", port: 80 }],
                    },
                ],
            },
        });
    }
}
