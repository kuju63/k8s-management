import { type App, Chart } from "cdk8s";
import { createDirectoryApplication, createHelmApplication } from "../../lib/argocd-application.js";
import { CLUSTER_DOMAIN } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "tekton-pipelines";

/**
 * Tekton Pipelines 本体と Tekton Dashboard を管理する Chart。
 *
 * Dashboard は Pipelines as Code と同じく upstream が `ko` ビルド前提のため、リリース済みの
 * 解決済み manifest (`release-full0.72.0.yaml`, v0.72.0 固定) を `vendor/dashboard/` に
 * コミットし、`createDirectoryApplication` で参照している。manifest 内のワークロードは
 * すべて `tekton-pipelines` namespace に配置されるため、この Chart で管理する
 * （先頭の `tekton-dashboard` Namespace は upstream のまま残しており、中身は空）。
 *
 * release-full は `--read-only=false` の read-write 版で、Dashboard 自体に認証は無い。
 * 到達できれば全 namespace の Tekton リソースを作成・削除できるが、自宅内ネットワーク
 * 限定の前提でそのまま Gateway に公開している。
 */
export class TektonPipelinesChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );

    createHelmApplication( this, "tekton-pipelines", {
      name: "tekton-pipelines",
      namespace: NAMESPACE,
      repoUrl: "https://cdfoundation.github.io/tekton-helm-chart",
      chart: "tekton-pipeline",
      targetRevision: "1.14.0",
      valuesObject: {
        namespace: {
          create: false,
          name: NAMESPACE,
        },
      },
      // chart の CRD は `preserveUnknownFields: false` を明示しているが、apiextensions.k8s.io/v1 では
      // デフォルト値の false は保存時に省略され live に現れない。恒常的な OutOfSync になるため比較から外す。
      ignoreDifferences: [
        {
          group: "apiextensions.k8s.io",
          kind: "CustomResourceDefinition",
          jsonPointers: [ "/spec/preserveUnknownFields" ],
        },
      ],
    } );

    createDirectoryApplication( this, "tekton-dashboard", {
      name: "tekton-dashboard",
      namespace: NAMESPACE,
      path: "packages/ns/tekton-pipelines/vendor/dashboard",
      serverSideApply: true,
    } );

    createHTTPRoute( this, {
      name: "tekton-dashboard-route",
      namespace: NAMESPACE,
      hostnames: [ `tekton-dashboard.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: "tekton-dashboard", port: 9097 } ],
    } );
  }
}
