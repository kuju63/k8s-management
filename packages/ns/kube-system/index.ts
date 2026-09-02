import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNfsStorageClass } from "../../lib/storage.js";

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
      targetRevision: "2.19.3",
      valuesObject: {
        fullnameOverride: "sealed-secrets-controller",
      },
    } );

    createHelmApplication( this, "nfs-csi-driver", {
      name: "nfs-csi-driver",
      namespace: NAMESPACE,
      repoUrl: "https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts",
      chart: "csi-driver-nfs",
      targetRevision: "v4.13.4",
      valuesObject: {
        driver: {
          image: {
            repository: "registry.k8s.io/k8s-sig-storage/nfsplugin",
            tag: "v4.13.4",
          },
          mountPermissions: "0",
        },
        fsGroupPolicy: "File",
        node: {
          tolerations: [
            {
              effect: "NoSchedule",
              key: "node-role.kubernetes.io/control-plane",
              operator: "Exists",
            },
          ],
        },
      },
    } );

    // csi-driver-nfs が使う StorageClass。NAS上の共有フォルダを PVC ごとに自動でサブディレクトリ分離する。
    createNfsStorageClass( this );
  }
}
