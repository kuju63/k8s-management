import { type App, ApiObject, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "monitoring";
const PROMETHEUS_STACK_RELEASE = "kube-prometheus-stack";
const GRAFANA_POSTGRESQL_RELEASE = "grafana-postgresql";
const GRAFANA_CREDENTIALS_SECRET = "grafana-credentials";
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

    // Grafana の状態（ユーザー・パスワード・UI設定など）を保持する PostgreSQL。
    // 認証情報は git に含めず、事前作成済みの Secret を参照する。
    new ApiObject( this, "service-grafana-postgresql", {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: GRAFANA_POSTGRESQL_RELEASE, namespace: NAMESPACE },
      spec: {
        clusterIP: "None",
        selector: { app: GRAFANA_POSTGRESQL_RELEASE },
        ports: [ { name: "postgresql", port: 5432, targetPort: 5432 } ],
      },
    } );

    new ApiObject( this, "statefulset-grafana-postgresql", {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: { name: GRAFANA_POSTGRESQL_RELEASE, namespace: NAMESPACE },
      spec: {
        serviceName: GRAFANA_POSTGRESQL_RELEASE,
        replicas: 1,
        selector: { matchLabels: { app: GRAFANA_POSTGRESQL_RELEASE } },
        persistentVolumeClaimRetentionPolicy: {
          whenDeleted: "Retain",
          whenScaled: "Retain",
        },
        template: {
          metadata: { labels: { app: GRAFANA_POSTGRESQL_RELEASE } },
          spec: {
            securityContext: { fsGroup: 999, fsGroupChangePolicy: "OnRootMismatch" },
            containers: [
              {
                name: "postgresql",
                image:
                  "docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941",
                imagePullPolicy: "IfNotPresent",
                ports: [ { name: "postgresql", containerPort: 5432 } ],
                env: [
                  { name: "POSTGRES_USER", value: "grafana" },
                  { name: "POSTGRES_DB", value: "grafana" },
                  {
                    name: "POSTGRES_PASSWORD",
                    valueFrom: {
                      secretKeyRef: {
                        name: GRAFANA_CREDENTIALS_SECRET,
                        key: "postgres-password",
                      },
                    },
                  },
                  { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
                ],
                readinessProbe: {
                  exec: { command: [ "pg_isready", "-U", "grafana", "-d", "grafana" ] },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  exec: { command: [ "pg_isready", "-U", "grafana", "-d", "grafana" ] },
                  initialDelaySeconds: 30,
                  periodSeconds: 10,
                },
                volumeMounts: [ { name: "data", mountPath: "/var/lib/postgresql/data" } ],
              },
            ],
          },
        },
        volumeClaimTemplates: [
          {
            metadata: { name: "data" },
            spec: {
              accessModes: [ "ReadWriteOnce" ],
              storageClassName: "local-path",
              resources: { requests: { storage: "10Gi" } },
            },
          },
        ],
      },
    } );

    // Prometheus + Grafana + Alertmanager。Grafana の内部DBには上記 PostgreSQL を使う。
    createHelmApplication( this, "argocd-application-prometheus", {
      name: PROMETHEUS_STACK_RELEASE,
      namespace: NAMESPACE,
      repoUrl: "https://prometheus-community.github.io/helm-charts",
      chart: "kube-prometheus-stack",
      targetRevision: "88.3.0",
      valuesObject: {
        grafana: {
          admin: {
            existingSecret: GRAFANA_CREDENTIALS_SECRET,
            userKey: "admin-user",
            passwordKey: "admin-password",
          },
          envValueFrom: {
            GF_DATABASE_PASSWORD: {
              secretKeyRef: {
                name: GRAFANA_CREDENTIALS_SECRET,
                key: "postgres-password",
              },
            },
          },
          "grafana.ini": {
            database: {
              type: "postgres",
              host: `${ GRAFANA_POSTGRESQL_RELEASE }.${ NAMESPACE }.svc.cluster.local:5432`,
              name: "grafana",
              user: "grafana",
              password: "$__env{GF_DATABASE_PASSWORD}",
              ssl_mode: "disable",
            },
          },
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
