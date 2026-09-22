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
    } );
  }
}
