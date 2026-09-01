# NFS CSI Driver / StorageClass `nfs` の運用方法

## 概要

このリポジトリは、NAS（`192.168.1.116`）が公開する NFS4.1 を共有ストレージとして使い、
`ReadWriteMany`（複数 Pod が同時に読み書き可能な PVC）を提供する。PVC ごとに
NAS 上のサブディレクトリを分けることで、複数のアプリが共有の NFS エクスポートを
共有できる。

csi-driver-nfs（`nfs.csi.k8s.io`）は、NFSv4 を未対応のため、
`mountOptions`（`nfsvers=4.1`）指定することで対応する。
認証 NAS を使っているので UID（`1001`）認証でマウントしている。

## アーキテクチャ

- **Namespace**: `nfs-csi`（[packages/ns/nfs-csi](../../packages/ns/nfs-csi/index.ts)）
- **csi-driver-nfs**: ArgoCD Application（[nfs-csi-driver](../../manifests/nfs-csi.k8s.yaml)）
- **StorageClass `nfs`**: [nfs StorageClass](../../manifests/nfs-csi.k8s.yaml)
  （`provisioner: nfs.csi.k8s.io`）

csi-driver-nfs は `nfs-csi` namespace に展開される。StorageClass `nfs` は
クラスタ全体（名前空間に依存しない）で使える。

## StorageClass `nfs` の設定

StorageClass `nfs` の主要な指定（[manifests/nfs-csi.k8s.yaml](../../manifests/nfs-csi.k8s.yaml)）:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs
spec:
  allowVolumeExpansion: true
  mountOptions:
    - nfsvers=4.1
  parameters:
    gid: "1001"
    server: 192.168.1.116
    share: /k8s-shared
    uid: "1001"
  provisioner: nfs.csi.k8s.io
  reclaimPolicy: Retain
  volumeBindingMode: Immediate
```

| 項目 | 値 | 意味 |
| ---- | -- | ---- |
| `provisioner` | `nfs.csi.k8s.io` | csi-driver-nfs が PVC をプロビジョンドする |
| `server` | `192.168.1.116` | NAS の NFS 共有サーバーのアドレス（`NFS_SERVER_ADDRESS`） |
| `share` | `/k8s-shared` | NAS が公開する NFS 共有の共有パス（`NFS_SHARE_PATH`） |
| `uid` / `gid` | `1001` | NAS の NFS エクスポートにマッピングされる UID/GID（`NFS_UID`） |
| `mountOptions` | `nfsvers=4.1` | NFSv4 は未対応のため v4.1 を指定（csi-driver-nfs の制約） |
| `volumeBindingMode` | `Immediate` | PVC の要求時点でプロビジョンド（待たずに割り当てる） |
| `reclaimPolicy` | `Retain` | PVC を削除しても NFS 上のデータは保持する |
| `allowVolumeExpansion` | `true` | PVC の容量を後から拡大できる |

## PVC の使い方

PVC の `storageClassName` に nfs を指定する。`NFS_UID` でマウントするため、
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

csi-driver-nfs が `nfs-csi` namespace に展開されているか確認する。

```sh
kubectl get pods -n nfs-csi
```

## 検証と反映

1. `manifests/nfs-csi.k8s.yaml` を確認する（`git diff`）。
2. commit、push する。
3. ArgoCD の root Application が変更を検知し、ArgoCD that synchronizes automatically。
4. csi-driver-nfs が `nfs-csi` namespace にロールアウトされる。
5. StorageClass `nfs` が使えるようになる。

## 関連ドキュメント

- [packages/ns/nfs-csi](../../packages/ns/nfs-csi/index.ts) - `nfs-csi` namespace の Chart
- [manifests/nfs-csi.k8s.yaml](../../manifests/nfs-csi.k8s.yaml) - synth された manifest
