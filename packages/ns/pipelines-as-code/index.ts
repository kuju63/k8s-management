import { type App, Chart } from "cdk8s";
import { createGitApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";

const NAMESPACE = "pipelines-as-code";

/** Pipelines as Code 本体と Forgejo webhook の公開経路を管理する Chart。 */
export class PipelinesAsCodeChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createGitApplication( this, "pipelines-as-code", {
      name: "pipelines-as-code",
      namespace: NAMESPACE,
      repoUrl: "https://github.com/openshift-pipelines/pipelines-as-code.git",
      targetRevision: "v0.51.0",
      path: "config",
      serverSideApply: true,
    } );

    createHTTPRoute( this, {
      name: "pipelines-as-code-route",
      namespace: NAMESPACE,
      hostnames: [ `tekton.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: "pipelines-as-code-controller", port: 8080 } ],
    } );
  }
}
