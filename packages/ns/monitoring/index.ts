import { type App, ApiObject, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "monitoring";
const PROMETHEUS_STACK_RELEASE = "kube-prometheus-stack";
const LOKI_RELEASE = "loki";

// Alloy(DaemonSet)が自ノード上の Pod ログのみを収集し、Loki の gateway へ push する最小構成。
// https://grafana.com/docs/alloy/latest/collect/logs-in-kubernetes/ の例を簡略化したもの。
const ALLOY_CONFIG = `discovery.kubernetes "pod" {
  role = "pod"
  selectors {
    role  = "pod"
    field = "spec.nodeName=" + coalesce(sys.env("HOSTNAME"), constants.hostname)
  }
}

discovery.relabel "pod_logs" {
  targets = discovery.kubernetes.pod.targets

  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label  = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label  = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_node_name"]
    target_label  = "node"
  }
  rule {
    source_labels = ["__meta_kubernetes_namespace", "__meta_kubernetes_pod_container_name"]
    separator     = "/"
    target_label  = "job"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_uid", "__meta_kubernetes_pod_container_name"]
    separator     = "/"
    target_label  = "__path__"
    replacement   = "/var/log/pods/*$1/*.log"
  }
}

loki.source.kubernetes "pod_logs" {
  targets    = discovery.relabel.pod_logs.output
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://${ LOKI_RELEASE }-gateway.${ NAMESPACE }.svc.cluster.local/loki/api/v1/push"
  }
}
`;

/**
 * ns: monitoring（運用系: 可観測性）
 * メトリクス(Prometheus)・可視化(Grafana)・ログ(Loki)・トレース(Jaeger)をまとめて配置する。
 */
export class MonitoringChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );

    // targetRevision: 2026-08-13 時点の各Helmリポジトリでの最新版。

    // Prometheus + Grafana + Alertmanager。
    createHelmApplication( this, "argocd-application-prometheus", {
      name: PROMETHEUS_STACK_RELEASE,
      namespace: NAMESPACE,
      repoUrl: "https://prometheus-community.github.io/helm-charts",
      chart: "kube-prometheus-stack",
      targetRevision: "88.3.0",
      valuesObject: {
        grafana: {
          additionalDataSources: [
            {
              name: "Loki",
              uid: "loki",
              type: "loki",
              access: "proxy",
              url: `http://${ LOKI_RELEASE }-gateway.${ NAMESPACE }.svc.cluster.local`,
              isDefault: false,
              editable: false,
            },
            {
              name: "Jaeger",
              uid: "jaeger",
              type: "jaeger",
              access: "proxy",
              url: `http://jaeger.${ NAMESPACE }.svc.cluster.local:16686`,
              isDefault: false,
              editable: false,
            },
          ],
        },
      },
    } );

    // Loki（filesystem storage・SingleBinaryモードの最小構成。`loki-stack` は
    // upstream で deprecated のため後継の `loki` チャートを使う）。
    createHelmApplication( this, "argocd-application-loki", {
      name: LOKI_RELEASE,
      namespace: NAMESPACE,
      repoUrl: "https://grafana.github.io/helm-charts",
      chart: "loki",
      targetRevision: "7.3.0",
      valuesObject: {
        deploymentMode: "SingleBinary",
        loki: {
          auth_enabled: false,
          commonConfig: { replication_factor: 1 },
          storage: { type: "filesystem" },
          useTestSchema: true,
        },
        singleBinary: {
          replicas: 1,
          persistence: { enabled: false },
          extraVolumes: [ { name: "storage", emptyDir: {} } ],
          extraVolumeMounts: [ { name: "storage", mountPath: "/var/loki" } ],
        },
        // SingleBinary と競合する SimpleScalable モードのデフォルト replica を無効化。
        backend: { replicas: 0 },
        read: { replicas: 0 },
        write: { replicas: 0 },
        // memcached ベースのキャッシュはホームラボ規模では不要なリソース消費のため無効化。
        resultsCache: { enabled: false },
        chunksCache: { enabled: false },
      },
    } );

    // Grafana Alloy（各ノードの DaemonSet として Pod ログを収集し、Loki へ push する。
    // Promtail は upstream で deprecated のため Alloy を使う）。
    createHelmApplication( this, "argocd-application-alloy", {
      name: "alloy",
      namespace: NAMESPACE,
      repoUrl: "https://grafana.github.io/helm-charts",
      chart: "alloy",
      targetRevision: "1.11.1",
      valuesObject: {
        alloy: {
          configMap: { content: ALLOY_CONFIG },
        },
      },
    } );

    // Jaeger（all-in-one。常時稼働のリソース消費を抑える構成。サンプリング率は今後の調整余地あり）。
    createHelmApplication( this, "argocd-application-jaeger", {
      name: "jaeger",
      namespace: NAMESPACE,
      repoUrl: "https://jaegertracing.github.io/helm-charts",
      chart: "jaeger",
      targetRevision: "4.12.0",
      valuesObject: {
        allInOne: { enabled: true },
        collector: { enabled: false },
        query: { enabled: false },
        storage: { type: "memory" },
      },
    } );

    // 運用系UIへの経路（ノートでは点線＝要認証として明示）。認証付与は今回スコープ外。
    new ApiObject( this, "httproute-grafana", {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: "grafana", namespace: NAMESPACE },
      spec: {
        parentRefs: [ { name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE } ],
        hostnames: [ `grafana.${ CLUSTER_DOMAIN }` ],
        rules: [
          {
            backendRefs: [ { name: `${ PROMETHEUS_STACK_RELEASE }-grafana`, port: 80 } ],
          },
        ],
      },
    } );
  }
}
