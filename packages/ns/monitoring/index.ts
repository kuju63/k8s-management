import { type App, ApiObject, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "monitoring";
const PROMETHEUS_STACK_RELEASE = "kube-prometheus-stack";

/**
 * ns: monitoring（運用系: 可観測性）
 * メトリクス(Prometheus)・可視化(Grafana)・ログ(Loki)・トレース(Jaeger)をまとめて配置する。
 */
export class MonitoringChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        // repoURL/chart/targetRevision はいずれも要検証（upstream の最新値を確認すること）。

        // Prometheus + Grafana + Alertmanager。
        createHelmApplication(this, "argocd-application-prometheus", {
            name: PROMETHEUS_STACK_RELEASE,
            namespace: NAMESPACE,
            repoUrl: "https://prometheus-community.github.io/helm-charts",
            chart: "kube-prometheus-stack",
            targetRevision: "65.5.1",
        });

        // Loki + Promtail（各ノードの DaemonSet からログを収集）。
        createHelmApplication(this, "argocd-application-loki", {
            name: "loki-stack",
            namespace: NAMESPACE,
            repoUrl: "https://grafana.github.io/helm-charts",
            chart: "loki-stack",
            targetRevision: "2.10.2",
            valuesObject: {
                promtail: { enabled: true },
            },
        });

        // Jaeger（all-in-one。常時稼働のリソース消費を抑える構成。サンプリング率は今後の調整余地あり）。
        createHelmApplication(this, "argocd-application-jaeger", {
            name: "jaeger",
            namespace: NAMESPACE,
            repoUrl: "https://jaegertracing.github.io/helm-charts",
            chart: "jaeger",
            targetRevision: "3.4.1",
            valuesObject: {
                allInOne: { enabled: true },
                collector: { enabled: false },
                query: { enabled: false },
                storage: { type: "memory" },
            },
        });

        // 運用系UIへの経路（ノートでは点線＝要認証として明示）。認証付与は今回スコープ外。
        new ApiObject(this, "httproute-grafana", {
            apiVersion: "gateway.networking.k8s.io/v1",
            kind: "HTTPRoute",
            metadata: { name: "grafana", namespace: NAMESPACE },
            spec: {
                parentRefs: [{ name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE }],
                hostnames: [`grafana.${CLUSTER_DOMAIN}`],
                rules: [
                    {
                        backendRefs: [{ name: `${PROMETHEUS_STACK_RELEASE}-grafana`, port: 80 }],
                    },
                ],
            },
        });
    }
}
