import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "local-path-storage";

/**
 * ns: local-path-storage（基盤系: 永続ボリューム）
 * ノードローカルの hostPath を使う StorageClass を提供する。
 * ノード障害には耐えないため、重要データには別途バックアップが必要。
 */
export class LocalPathStorageChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );

    createHelmApplication( this, "argocd-application", {
      name: "local-path-provisioner",
      namespace: NAMESPACE,
      repoUrl: "https://charts.containeroo.ch",
      chart: "local-path-provisioner",
      targetRevision: "0.0.38",
      valuesObject: {
        storageClass: {
          defaultClass: false,
          name: "local-path",
          reclaimPolicy: "Retain",
          volumeBindingMode: "WaitForFirstConsumer",
        },
      },
    } );
  }
}
