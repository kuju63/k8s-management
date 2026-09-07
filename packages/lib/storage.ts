import { ApiObject, type Chart } from "cdk8s";
import type { AccessMode, PersistenceMount, PersistenceVolume } from "./argocd-application.js";
import { NFS_SERVER_ADDRESS, NFS_SHARE_PATH } from "./config.js";

/** csi-driver-nfs (`nfs.csi.k8s.io`) が動的プロビジョニングに使う StorageClass 名。 */
export const NFS_STORAGE_CLASS_NAME = "nfs";

/**
 * NAS が公開する単一の共有フォルダ（`NFS_SHARE_PATH`）を csi-driver-nfs で動的プロビジョニングする
 * `StorageClass` を生成する。
 *
 * NAS 側は全 PVC で共通の1つの共有フォルダしか公開していないため、`parameters.subDir` に
 * `${pvc.metadata.namespace}/${pvc.metadata.name}` というテンプレートを指定し、PVC ごとに
 * NAS 上のサブディレクトリへ自動的に分離する。呼び出し側はディレクトリ名を意識する必要がなく、
 * PVC の namespace/name（実体）がそのまま NAS 上のディレクトリ構造になる。サブディレクトリが
 * 存在しない場合は csi-driver-nfs が再帰的に作成する。
 *
 * `StorageClass` は cluster-scoped リソースのため、クラスタ内で一度だけ作成すればよい。
 */
export function createNfsStorageClass( chart: Chart, id = "nfs-storage-class" ): ApiObject {
  return new ApiObject( chart, id, {
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: { name: NFS_STORAGE_CLASS_NAME },
    provisioner: "nfs.csi.k8s.io",
    parameters: {
      server: NFS_SERVER_ADDRESS,
      share: NFS_SHARE_PATH,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: csi-driver-nfs 自身のテンプレート構文であり、JS の template literal ではない
      subDir: "${pvc.metadata.namespace}/${pvc.metadata.name}",
      // 4.13.4では未対応のため、コメントアウト
      // uid: NFS_UID,
      // gid: NFS_UID,
      mountPermissions: "0777",
    },
    // csi-driver-nfs は NFSv4 (デフォルト) 未対応のため v4.1 を明示する。
    mountOptions: [ "nfsvers=4.1" ],
    reclaimPolicy: "Retain",
    volumeBindingMode: "Immediate",
    allowVolumeExpansion: true,
  } );
}

/** `nfsPersistence` のプロパティ。 */
export interface NfsPersistenceProps {
  /** PVC の AccessMode。NFS は ReadWriteMany をサポートするが、用途に応じて呼び出し側で明示する。 */
  readonly accessMode: AccessMode;
  /** 要求するストレージ容量（例: `1Gi`）。 */
  readonly size: string;
  /** `true` の場合、Application 削除後も PVC を残す。 */
  readonly retain?: boolean;
  /** このボリュームをコンテナ内にマウントする場所。 */
  readonly globalMounts: readonly PersistenceMount[];
}

/**
 * `createContainerApplication` の `persistence` にそのまま渡せる、NFS StorageClass
 * （`createNfsStorageClass` が作成するもの）向けの `PersistenceVolume` を組み立てる。
 *
 * NAS 上のディレクトリ分離は StorageClass 側の `subDir` テンプレートに任せているため、
 * 呼び出し側でディレクトリ名を指定する必要はない。
 */
export function nfsPersistence( props: NfsPersistenceProps ): PersistenceVolume {
  return {
    type: "persistentVolumeClaim",
    accessMode: props.accessMode,
    size: props.size,
    storageClass: NFS_STORAGE_CLASS_NAME,
    globalMounts: props.globalMounts,
    ...( props.retain === undefined ? {} : { retain: props.retain } ),
  };
}
