# LonghornとGrafana PostgreSQLの運用

## 構成

Grafanaの設定データは、`monitoring` namespaceのPostgreSQL 18.6に保存する。
PostgreSQLの10Gi PVCはLonghorn StorageClassを使用し、worker 3台に3レプリカで
複製する。

- Longhorn Helm chart: `1.12.1`
- PostgreSQL image: `postgres:18.6-bookworm`
- PostgreSQL Service: `grafana-postgresql.monitoring.svc.cluster.local:5432`
- StorageClass: `longhorn`
- PVC ReclaimPolicy: `Retain`

`local-path` StorageClassと`data-grafana-postgresql-0` PVCは、以前の構成の残骸で
あり、この構成では使用しない。

## Longhornのホスト要件

Longhornの反映前に、公式CLIでworkerノードの要件を確認する。

```sh
curl -fsSL -o /tmp/longhornctl \
  https://github.com/longhorn/cli/releases/download/v1.12.1/longhornctl-linux-amd64
chmod +x /tmp/longhornctl
kubectl create namespace longhorn-system \
  --dry-run=client -o yaml | kubectl apply -f -
/tmp/longhornctl check preflight
```

`longhorn-system` namespaceはLonghorn本体が使用するため、preflight後に削除しては
いけない。初回導入前に作成したnamespaceは、そのままcdk8s/ArgoCD管理へ引き継ぐ。

このクラスタではRWO・非暗号化ボリュームのみを使用する。必須となる
`iscsi-initiator-utils`、`iscsi_tcp`、device-mapper、および`iscsid`のsocket
activationをworker全台で確認すること。

NFS clientはLonghornのRWXボリュームに必要だが、今回のPostgreSQLはRWOのため
使用しない。`dm_crypt`も暗号化ボリュームを使用する場合のみ必要になる。

## Grafana認証情報Secret

Secretの実体はgitへ保存せず、次のキーを持つ`grafana-credentials`を事前に
作成する。

- `admin-user`
- `admin-password`
- `database-password`

既存Grafanaのadmin認証情報を引き継ぎ、DBパスワードだけ新規生成する場合は
次のように作成する。コマンドは秘密値を標準出力へ表示しない。

```sh
current="$(kubectl -n monitoring get secret kube-prometheus-stack-grafana -o json)"
admin_user="$(jq -r '.data["admin-user"]' <<<"${current}")"
admin_password="$(jq -r '.data["admin-password"]' <<<"${current}")"
database_password="$(openssl rand -base64 48 | tr -d '\n' | base64 -w0)"

jq -n \
  --arg admin_user "${admin_user}" \
  --arg admin_password "${admin_password}" \
  --arg database_password "${database_password}" \
  '{
    apiVersion: "v1",
    kind: "Secret",
    metadata: {name: "grafana-credentials", namespace: "monitoring"},
    type: "Opaque",
    data: {
      "admin-user": $admin_user,
      "admin-password": $admin_password,
      "database-password": $database_password
    }
  }' | kubectl apply -f -
```

SecretはPostgreSQLの初回起動より前に存在する必要がある。DB初期化後に
`database-password`だけを変更するとPostgreSQL内のパスワードと不一致になるため、
ローテーション時はSQLの`ALTER ROLE`とSecret更新を同時に行う。

## 反映後の確認

```sh
kubectl -n longhorn-system get pods
kubectl get storageclass longhorn
kubectl -n monitoring get pvc grafana-postgresql
kubectl -n monitoring rollout status statefulset/grafana-postgresql
kubectl -n monitoring rollout status deployment/kube-prometheus-stack-grafana
```

Longhorn UIは外部公開しない。必要な場合は一時的なport-forwardを使う。

```sh
kubectl -n longhorn-system port-forward service/longhorn-frontend 8080:80
```

Grafana Podを再作成した後もログインでき、ユーザーやUI上の設定が保持されることを
確認する。

```sh
kubectl -n monitoring rollout restart deployment/kube-prometheus-stack-grafana
kubectl -n monitoring rollout status deployment/kube-prometheus-stack-grafana
```

## 旧local-pathリソースの削除

Longhornへの切り替えが完了し、参照がないことを確認してから残骸を削除する。

```sh
kubectl -n monitoring delete pvc data-grafana-postgresql-0
kubectl delete storageclass local-path
```

`local-path`を参照する別のPVCがある場合は削除してはいけない。事前に次のコマンドで
全namespaceを確認する。

```sh
kubectl get pvc -A -o custom-columns=\
'NAMESPACE:.metadata.namespace,NAME:.metadata.name,STORAGECLASS:.spec.storageClassName'
```
