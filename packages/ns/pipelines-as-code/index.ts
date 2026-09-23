import { type App, Chart } from "cdk8s";
import { createDirectoryApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";

const NAMESPACE = "pipelines-as-code";

/**
 * Pipelines as Code 本体と Forgejo webhook の公開経路を管理する Chart。
 *
 * upstream (`tektoncd/pipelines-as-code`) の `config/` ディレクトリは `ko` でビルド
 * されることを前提にした未解決ソースで、Deployment の image が `ko://...` という
 * プレースホルダのままになっている。そのためリリース済みの解決済み manifest
 * (`release.k8s.yaml`, v0.51.0 固定) を `vendor/` にコミットし、このリポジトリ自身を
 * source とする `createDirectoryApplication` で参照している。
 */
export class PipelinesAsCodeChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createDirectoryApplication( this, "pipelines-as-code", {
      name: "pipelines-as-code",
      namespace: NAMESPACE,
      path: "packages/ns/pipelines-as-code/vendor",
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
