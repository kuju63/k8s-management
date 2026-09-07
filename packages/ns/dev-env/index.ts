import { type App, Chart } from "cdk8s";
import { createContainerApplication } from "../../lib/argocd-application.js";
import { createAppProject } from "../../lib/argocd-project.js";
import { CLUSTER_DOMAIN, IN_CLUSTER_SERVER } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";
import { createConfigMap } from "../../lib/k8s-configuration.js";
import { createNamespace } from "../../lib/namespace.js";
import { nfsPersistence } from "../../lib/storage.js";

const NAMESPACE = "dev-env";
const REGISTORY_ROOT_DIR = "/registory/data";
const PROJECT_NAME = "dev-env";
const REGISTORY_HOST = `registory.${ CLUSTER_DOMAIN }`;

/**
 * 開発環境基盤のChart
 *
 * 現在整備されているもの
 *
 * - Container Registory
 */
export class DevEnvChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );
    createAppProject( this, "dev-env", {
      name: PROJECT_NAME,
      sourceNamespaces: [ NAMESPACE ],
      sourceRepos: [ "ghcr.io/bjw-s-labs/helm" ],
      destinations: [
        {
          server: IN_CLUSTER_SERVER,
          namespace: NAMESPACE,
        },
      ],
    } );

    const registoryPersistance = nfsPersistence( {
      accessMode: "ReadWriteOnce",
      size: "300Gi",
      globalMounts: [
        {
          path: REGISTORY_ROOT_DIR,
        },
      ],
    } );

    createConfigMap( this, "registory-config", NAMESPACE, {
      REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY: REGISTORY_ROOT_DIR,
      REGISTRY_HTTP_HOST: `http://${ REGISTORY_HOST }`,
    } );

    // Docker registory
    createContainerApplication( this, "container-registory", {
      name: "registory",
      namespace: NAMESPACE,
      project: PROJECT_NAME,
      image: {
        repository: "docker.io/registry",
        tag: "3.1",
      },
      persistence: {
        "registory-vol": registoryPersistance,
      },
      replicas: 3,
      resources: {
        requests: {
          cpu: "100m",
          memory: "256Mi",
        },
        limits: {
          cpu: "500m",
          memory: "1024Mi",
        },
      },
    } );
    // Docker registoryのHTTPでの公開
    createHTTPRoute( this, {
      name: "registory-route",
      namespace: NAMESPACE,
      hostnames: [ REGISTORY_HOST ],
      backendRefs: [ { name: "registory" } ],
    } );
  }
}
