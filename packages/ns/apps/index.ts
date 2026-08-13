import { type App, ApiObject, Chart } from "cdk8s";
import { createGitApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "apps";

/**
 * ns: apps（サービス系）
 * 自作レビューサービス等、実際にユーザーへ提供するアプリケーションを配置する。
 */
export class AppsChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        // TODO: 自作レビューサービスのリポジトリが未作成のためプレースホルダ。
        // 実リポジトリ作成後に repoUrl/targetRevision/path を差し替える。
        createGitApplication(this, "argocd-application", {
            name: "review-service",
            namespace: NAMESPACE,
            repoUrl: "https://github.com/kuju63/code-review-agents.git",
            targetRevision: "main",
            path: "manifests",
        });

        // サービス公開用の経路（ノートでは実線＝運用系UIより優先度の高い正規ルート）。
        new ApiObject(this, "httproute", {
            apiVersion: "gateway.networking.k8s.io/v1",
            kind: "HTTPRoute",
            metadata: { name: "review-service", namespace: NAMESPACE },
            spec: {
                parentRefs: [{ name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE }],
                hostnames: [`review.${CLUSTER_DOMAIN}`],
                rules: [
                    {
                        backendRefs: [{ name: "review-service", port: 80 }],
                    },
                ],
            },
        });
    }
}
