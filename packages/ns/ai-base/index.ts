import { type App, Chart } from "cdk8s";
import { createHelmApplicationSet } from "../../lib/argocd-applicationset.js";
import { createAppProject } from "../../lib/argocd-project.js";
import { CLUSTER_DOMAIN } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "ai-base";
const STACK_NAME = "langflow";
const PROJECT_NAME = "ai-base";

/**
 * ns: ai-base
 *
 * AI関連システムの基盤システム
 */
export class AIBaseSystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );
    createAppProject( this, "ai-base", {
      name: PROJECT_NAME,
      description: "AIアプリ開発基盤",
      sourceRepos: [ "ghcr.io/bjw-s-labs/helm" ],
      destinations: [
        {
          server: "https://kubernetes.default.svc",
          namespace: NAMESPACE,
        },
      ],
      clusterResourceWhitelist: [ { group: "*", kind: "*" } ],
    } );

    createHelmApplicationSet( this, "langflow-set", {
      name: "langflow-set",
      namespace: NAMESPACE,
      project: PROJECT_NAME,
      applications: [
        // LangFlow
        {
          name: STACK_NAME,
          kind: "container",
          replicas: 1,
          image: {
            repository: "docker.io/langflowai/langflow",
            tag: "1.11.5",
          },
          env: {
            LANGFLOW_AUTO_LOGIN: "true",
            LANGFLOW_SSRF_ALLOWED_HOSTS: "192.168.0.0/22,*.home.internal",
            LANGFLOW_FS_TOOL_BASE_DIR: "/data/fs",
            LANGFLOW_SAVE_DB_IN_CONFIG_DIR: "True",
            LANGFLOW_CONFIG_DIR: "/data/config",
          },
          initContainers: {
            initConfigDir: {
              image: "docker.io/library/debian:latest",
              command: [
                "sh",
                "-c",
                "mkdir -p /dats/config && mkdir -p /data/fs && chown -R 1000:0 /data/config && chown -R 1000:0 /data/fs",
              ],
              volumeMounts: [ { name: "data", mountPath: "/data" } ],
            },
          },
          persistence: {
            data: {
              type: "persistentVolumeClaim",
              accessMode: "ReadWriteOnce",
              size: "10Gi",
              storageClass: "longhorn",
              globalMounts: [
                {
                  path: "/data/fs",
                  readOnly: false,
                },
                {
                  path: "/data/config",
                  readOnly: false,
                },
              ],
            },
          },
          service: {
            ports: {
              http: { port: 7860 },
            },
          },
        },
      ],
    } );

    // LangflowをHTTPとして公開する
    createHTTPRoute( this, {
      name: "langflow-route",
      namespace: NAMESPACE,
      hostnames: [ `${ STACK_NAME }.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: STACK_NAME, port: 7860 } ],
    } );
  }
}
