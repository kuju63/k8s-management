import { App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";

const NAMESPACE = "kube-system";

// KubeSystem namespaceの管理
export class KubeSystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    // Sealed Secrets
    // see https://github.com/bitnami/sealed-secrets
    createHelmApplication( this, "sealed-secrets", {
      name: "sealed-secrets-controller",
      namespace: NAMESPACE,
      repoUrl: "https://bitnami.github.io/sealed-secrets",
      chart: "sealed-secrets",
      targetRevision: "helm-v2.19.3",
      valuesObject: {
        fullnameOverride: "sealed-secrets-controller",
      },
    } );
  }
}
