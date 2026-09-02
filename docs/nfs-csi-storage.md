# NFS CSI Driver / StorageClass `nfs` の運用方法

## 概要

このリポジトリは、NAS（`192.168.1.116`）が公開する NFS4.1 を共有ストレージとして使い、
`ReadWriteMany`（複数 Pod が同時に読み書き可能な PVC）を提供する。NAS 側は全 PVC で
共通の1つの共有フォルダ（`/k8s-shared`）しか公開していない。そのため StorageClass の
`subDir` テンプレート機能を使い、PVC ごとに NAS 上のサブディレクトリを自動的に分離している。
これにより、複数のアプリが同じ NFS エクスポートをデータの混在なく共有できる。

csi-driver-nfs（`nfs.csi.k8s.io`）は NFSv4（デフォルト）を未対応のため、
`mountOptions`（`nfsvers=4.1`）指定することで対応する。
認証 NAS を使っているので UID/GID（`1001`）マッピングでマウントしている。

## アーキテクチャ

- **Namespace**: `kube-system`（[packages/ns/kube-system](../../packages/ns/kube-system/index.ts)）
- **csi-driver-nfs**: ArgoCD Application（[manifests/kube-system.k8s.yaml](../../manifests/kube-system.k8s.yaml)）
- **StorageClass `nfs`**: 同じ manifest に出力される（`provisioner: nfs.csi.k8s.io`）

`packages/lib/storage.ts` の `createNfsStorageClass` が StorageClass `nfs` を生成する。
csi-driver-nfs と StorageClass `nfs` は、いずれも `kube-system` namespace を持つ Chart
（`KubeSystemChart`）から生成される。StorageClass 自体は cluster-scoped のため、
namespace に依存せずクラスタ全体で使える。

## StorageClass `nfs` の設定

StorageClass `nfs` の主要な指定（`packages/lib/storage.ts` の `createNfsStorageClass`）:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs
provisioner: nfs.csi.k8s.io
parameters:
  server: 192.168.1.116
  share: /k8s-shared
  subDir: "${pvc.metadata.namespace}/${pvc.metadata.name}"
  uid: "1001"
  gid: "1001"
mountOptions:
  - nfsvers=4.1
reclaimPolicy: Retain
volumeBindingMode: Immediate
allowVolumeExpansion: true
```

| 項目 | 値 | 意味 |
| ---- | -- | ---- |
| `provisioner` | `nfs.csi.k8s.io` | csi-driver-nfs が PVC をプロビジョンする |
| `server` | `192.168.1.116` | NAS の NFS 共有サーバーのアドレス（`NFS_SERVER_ADDRESS`） |
| `share` | `/k8s-shared` | NAS が公開する NFS 共有の共有パス（`NFS_SHARE_PATH`） |
| `subDir` | `${pvc.metadata.namespace}/${pvc.metadata.name}` | PVC ごとに NAS 上のサブディレクトリを自動分離するテンプレート |
| `uid` / `gid` | `1001` | NAS の NFS エクスポートにマッピングされる UID/GID（`NFS_UID`） |
| `mountOptions` | `nfsvers=4.1` | NFSv4 は未対応のため v4.1 を指定（csi-driver-nfs の制約） |
| `volumeBindingMode` | `Immediate` | PVC の要求時点でプロビジョンする（Pod のスケジュールを待たない） |
| `reclaimPolicy` | `Retain` | PVC を削除しても NFS 上のデータは保持する |
| `allowVolumeExpansion` | `true` | PVC の容量を後から拡大できる |

`subDir` で指定したサブディレクトリは、NAS 上に存在しなければ csi-driver-nfs が再帰的に作成する。

## PVC の使い方（cdk8s ヘルパー経由、推奨）

アプリは `createContainerApplication`（`packages/lib/argocd-application.ts`）で定義する。
永続化には `packages/lib/storage.ts` の `nfsPersistence` を使い、`persistence` エントリを組み立てる。
NAS 上のディレクトリ名は `subDir` テンプレートにより PVC の namespace/name から自動的に決まる。
呼び出し側でディレクトリ名を指定する必要はない。

```ts
import { createContainerApplication } from "../../lib/argocd-application.js";
import { nfsPersistence } from "../../lib/storage.js";

createContainerApplication( this, "argocd-application", {
  name: "example-app",
  namespace: NAMESPACE,
  targetRevision: "5.1.0",
  image: { repository: "ghcr.io/example-org/example-app", tag: "1.0.0" },
  persistence: {
    data: nfsPersistence( {
      accessMode: "ReadWriteMany",
      size: "1Gi",
      globalMounts: [ { path: "/data" } ],
    } ),
  },
} );
```

## PVC の使い方（生の PVC、app-template を使わない場合）

`storageClassName` に `nfs` を指定する。`NFS_UID` でマウントするため、
PVC を使う workload は `fsGroup` に `NFS_UID` を指定する。

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
  namespace: app-ns
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: nfs
  resources:
    requests:
      storage: 1Gi
```

workload の Pod に `fsGroup` を指定する。

```yaml
spec:
  securityContext:
    fsGroup: 1001
```

`NFS_UID` マッピングの UID に一致しないユーザーが PVC をマウントして書き込むと、
NAS 側の NFS の所有権の制約により書き込みに失敗する（`EPERM`）。
`fsGroup` で `NFS_UID` マッピングの UID に合わせる。

## 確認コマンド

StorageClass `nfs` が登録されているか確認する。

```sh
kubectl get storageclass nfs
```

csi-driver-nfs が `kube-system` namespace に展開されているか確認する。

```sh
kubectl get pods -n kube-system -l app=csi-driver-nfs
```

## 検証と反映

1. `manifests/kube-system.k8s.yaml` を確認する（`git diff`）。
2. commit、push する。
3. ArgoCD の root Application が変更を検知し、自動的に同期する。
4. csi-driver-nfs と StorageClass `nfs` が `kube-system` namespace / クラスタにロールアウトされる。
5. StorageClass `nfs` が使えるようになる。

## 関連ドキュメント

- [packages/lib/storage.ts](../../packages/lib/storage.ts) - `createNfsStorageClass` / `nfsPersistence` ヘルパー
- [packages/ns/kube-system](../../packages/ns/kube-system/index.ts) - `kube-system` namespace の Chart
- [manifests/kube-system.k8s.yaml](../../manifests/kube-system.k8s.yaml) - synth された manifest
