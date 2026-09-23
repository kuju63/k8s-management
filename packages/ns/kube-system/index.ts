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

    // Metrics Server。metrics.k8s.io API を提供し、HPA（tekton-pipelines-webhook 等）と kubectl top が依存する。
    // see https://github.com/kubernetes-sigs/metrics-server
    createHelmApplication( this, "metrics-server", {
      name: "metrics-server",
      namespace: NAMESPACE,
      repoUrl: "https://kubernetes-sigs.github.io/metrics-server/",
      chart: "metrics-server",
      targetRevision: "3.14.0",
      valuesObject: {
        // kubelet の serving 証明書が自己署名（serverTLSBootstrap 未設定）のため検証を省略する。
        // serverTLSBootstrap を有効化してクラスタ CA 署名に切り替えたら、このフラグは外せる。
        args: [ "--kubelet-insecure-tls" ],
      },
    } );

    // csi-driver-nfs が使う StorageClass。NAS上の共有フォルダを PVC ごとに自動でサブディレクトリ分離する。
    createNfsStorageClass( this );
  }
}
