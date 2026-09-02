import { ApiObject, type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { NFS_SERVER_ADDRESS, NFS_SHARE_PATH, NFS_UID } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

/** NFS CSI Driver を展開する namespace 名。 */
export const NAMESPACE = "nfs-csi";

/** cdk8s の chart に NFS CSI Driver と StorageClass `nfs` を追加します。 */
export class NfsCsiChart extends Chart {
  constructor( app: App ) {
    super( app, NAMESPACE );

    createNamespace( this, NAMESPACE );

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

    new ApiObject( this, "NfsStorageClass", {
      apiVersion: "storage.k8s.io/v1",
      kind: "StorageClass",
      metadata: { name: "nfs" },
      spec: {
        allowVolumeExpansion: true,
        mountOptions: [ "nfsvers=4.1" ],
        parameters: {
          gid: NFS_UID,
          server: NFS_SERVER_ADDRESS,
          share: NFS_SHARE_PATH,
          uid: NFS_UID,
        },
        provisioner: "nfs.csi.k8s.io",
        reclaimPolicy: "Retain",
        volumeBindingMode: "Immediate",
      },
    } );
  }
}
