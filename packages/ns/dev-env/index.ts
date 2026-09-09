import { type App, Chart } from "cdk8s";
import { createAppProject } from "../../lib/argocd-project.js";
import { IN_CLUSTER_SERVER } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "dev-env";
const PROJECT_NAME = "dev-env";

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

    // Docker registoryのHTTPでの公開
    // createHTTPRoute( this, {
    //   name: "registory-route",
    //   namespace: NAMESPACE,
    //   hostnames: [ REGISTORY_HOST ],
    //   backendRefs: [ { name: "registory", port: 5000 } ],
    // } );
  }
}
