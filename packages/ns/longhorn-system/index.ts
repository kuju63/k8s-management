import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "longhorn-system";

/**
 * ns: longhorn-system（ストレージ基盤）
 * worker ノード間で複製する分散ブロックストレージを提供する。
 */
export class LonghornSystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );

    // ArgoCD で Helm chart を管理する場合、pre-upgrade hook Job は無効化する。
    // RWO ボリュームを worker 3台へ分散するため、デフォルトのレプリカ数は3とする。
    createHelmApplication( this, "argocd-application", {
      name: "longhorn",
      namespace: NAMESPACE,
      repoUrl: "https://charts.longhorn.io",
      chart: "longhorn",
      targetRevision: "1.12.1",
      valuesObject: {
        persistence: {
          createStorageClass: true,
          defaultClass: true,
          defaultFsType: "ext4",
          defaultClassReplicaCount: 3,
          reclaimPolicy: "Retain",
          volumeBindingMode: "Immediate",
        },
        preUpgradeChecker: {
          jobEnabled: false,
        },
        defaultSettings: {
          defaultReplicaCount: JSON.stringify( { v1: 3, v2: 3 } ),
          defaultDataPath: "/var/lib/longhorn/",
          storageOverProvisioningPercentage: 100,
          storageMinimalAvailablePercentage: 25,
        },
      },
    } );
  }
}
