import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "tekton-pipelines";

/** Tekton Pipelines 本体を管理する Chart。 */
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
  }
}
