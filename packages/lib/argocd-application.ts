import { ApiObject, type Chart } from "cdk8s";
import {
  APP_TEMPLATE_REPO_URL,
  ARGOCD_NAMESPACE,
  GIT_REPO_URL,
  GIT_TARGET_REVISION,
  IN_CLUSTER_SERVER,
} from "./config.js";

/** ArgoCD の Helm source で使用する正規化済みリポジトリ情報。 */
export interface NormalizedHelmSource {
  readonly repoURL: string;
  readonly chart?: string;
}

/**
 * Helm リポジトリURLを ArgoCD の Helm source 形式へ正規化する。
 * OCI URL は `oci://` を除去し、URL 末尾のチャート名を `chart` に切り出す。
 */
export function normalizeHelmSource( repoUrl: string, chart?: string ): NormalizedHelmSource {
  let repoURL = repoUrl;
  let chartName = chart;

  // ArgoCD の Helm OCI ソースは、oci:// を除いた repoURL(レジストリのパス) と
  // chart(チャート名) の両方を要求する（chart 未指定だと "spec.source.repoURL and
  // either spec.source.path or spec.source.chart are required" となり InvalidSpecError になる）。
  // 呼び出し側では OCI URL にチャート名まで含めるため、末尾セグメントを chart へ切り出す。
  if ( repoURL.startsWith( "oci://" ) ) {
    repoURL = repoURL.slice( "oci://".length );
    if ( chartName === undefined ) {
      const lastSlashIndex = repoURL.lastIndexOf( "/" );
      chartName = repoURL.slice( lastSlashIndex + 1 );
      repoURL = repoURL.slice( 0, lastSlashIndex );
    }
  }

  if ( chartName === undefined ) {
    return { repoURL };
  }
  return { repoURL, chart: chartName };
}

/** `createHelmApplication` のプロパティ。 */
export interface HelmApplicationProps {
  /** ArgoCD Application 名（= リソース名）。 */
  readonly name: string;
  /** インストール先 namespace。 */
  readonly namespace: string;
  /** Application を所属させる AppProject 名。省略時は `default`。 */
  readonly project?: string;
  /** Helm リポジトリURL、または OCI レジストリURL（`oci://...`）。 */
  readonly repoUrl: string;
  /** 通常の Helm リポジトリの場合のみ指定（OCI の場合は repoUrl にチャート名まで含まれるため省略）。 */
  readonly chart?: string;
  /** チャートのバージョン(通常の Helm リポジトリ)、または OCI タグ。 */
  readonly targetRevision: string;
  /** Helm values を上書きするオブジェクト。指定しない場合はチャートのデフォルト値を使う。 */
  readonly valuesObject?: Record< string, unknown >;
}

/** upstream の Helm チャートを source とする ArgoCD Application を生成する。 */
export function createHelmApplication( chart: Chart, id: string, props: HelmApplicationProps ): ApiObject {
  const normalizedSource = normalizeHelmSource( props.repoUrl, props.chart );
  const source: Record< string, unknown > = {
    repoURL: normalizedSource.repoURL,
    targetRevision: props.targetRevision,
  };
  if ( normalizedSource.chart !== undefined ) {
    source.chart = normalizedSource.chart;
  }
  if ( props.valuesObject !== undefined ) {
    source.helm = { valuesObject: props.valuesObject };
  }

  return new ApiObject( chart, id, {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name: props.name, namespace: ARGOCD_NAMESPACE },
    spec: {
      project: props.project ?? "default",
      source,
      destination: {
        server: IN_CLUSTER_SERVER,
        namespace: props.namespace,
      },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
        // 大きな CRD で last-applied-configuration annotation の 256 KiB 上限を超えないようにする。
        syncOptions: [ "ServerSideApply=true" ],
      },
    },
  } );
}

/** `createGitApplication` のプロパティ。 */
export interface GitApplicationProps {
  /** ArgoCD Application 名（= リソース名）。 */
  readonly name: string;
  /** インストール先 namespace。 */
  readonly namespace: string;
  /** 監視対象の git リポジトリURL。 */
  readonly repoUrl: string;
  /** Application を所属させる AppProject 名。省略時は `default`。 */
  readonly project?: string;
  /** 監視対象のブランチ・タグ・コミットSHA。 */
  readonly targetRevision: string;
  /** リポジトリ内での監視対象パス。 */
  readonly path: string;
  /** `path` 配下のサブディレクトリも再帰的に監視するか。省略時は `false`。 */
  readonly recurse?: boolean;
}

/** 任意の git リポジトリのディレクトリを source とする ArgoCD Application を生成する。 */
export function createGitApplication( chart: Chart, id: string, props: GitApplicationProps ): ApiObject {
  return new ApiObject( chart, id, {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name: props.name, namespace: ARGOCD_NAMESPACE },
    spec: {
      project: props.project ?? "default",
      source: {
        repoURL: props.repoUrl,
        targetRevision: props.targetRevision,
        path: props.path,
        directory: { recurse: props.recurse ?? false },
      },
      destination: {
        server: IN_CLUSTER_SERVER,
        namespace: props.namespace,
      },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
      },
    },
  } );
}

/** `createDirectoryApplication` のプロパティ。 */
export interface DirectoryApplicationProps {
  /** ArgoCD Application 名（= リソース名）。 */
  readonly name: string;
  /** インストール先 namespace。 */
  readonly namespace: string;
  /** このリポジトリ内での監視対象パス。 */
  readonly path: string;
  /** Application を所属させる AppProject 名。省略時は `default`。 */
  readonly project?: string;
  /** `path` 配下のサブディレクトリも再帰的に監視するか。省略時は `false`。 */
  readonly recurse?: boolean;
}

/** このリポジトリ自身の git ディレクトリを source とする ArgoCD Application を生成する（App-of-Apps の root 用）。 */
export function createDirectoryApplication( chart: Chart, id: string, props: DirectoryApplicationProps ): ApiObject {
  return createGitApplication( chart, id, {
    name: props.name,
    namespace: props.namespace,
    project: props.project ?? "default",
    repoUrl: GIT_REPO_URL,
    targetRevision: GIT_TARGET_REVISION,
    path: props.path,
    recurse: props.recurse ?? false,
  } );
}

/** `createContainerApplication` のコンテナイメージ指定。 */
export interface ContainerImage {
  /** イメージリポジトリ（例: `ghcr.io/example-org/example-app`）。 */
  readonly repository: string;
  /** イメージタグ。デプロイ対象アプリ自体のバージョンはここで指定する。 */
  readonly tag: string;
  /** イメージプルポリシー。省略時はチャート側のデフォルト（`IfNotPresent` 相当）に従う。 */
  readonly pullPolicy?: string;
}

/** `createContainerApplication` のコンテナリソース制限・要求。 */
export interface ContainerResources {
  /** 最大リソース量（例: `{ cpu: "500m", memory: "256Mi" }`）。 */
  readonly limits?: Record< string, string >;
  /** 要求リソース量（例: `{ cpu: "100m", memory: "128Mi" }`）。 */
  readonly requests?: Record< string, string >;
}

/** Secret/ConfigMap の特定キーを参照する。平文の値を直接指定する経路は存在しない。 */
export type EnvValueFrom =
  | { readonly secretKeyRef: { readonly name: string; readonly key: string } }
  | { readonly configMapKeyRef: { readonly name: string; readonly key: string } };

/** Secret/ConfigMap をまとめて環境変数として注入する1エントリ。 */
export interface EnvFromSource {
  /** この ConfigMap の全キーを環境変数として注入する。 */
  readonly configMapRef?: { readonly name: string };
  /** この Secret の全キーを環境変数として注入する。 */
  readonly secretRef?: { readonly name: string };
  /** 注入する環境変数名に付与するプレフィックス。 */
  readonly prefix?: string;
}

/**
 * `createContainerApplication` の永続化ボリューム1件分の指定。
 * `persistence` オブジェクトのキーがマウント識別子（および Volume 名）になる。
 */
export type PersistenceVolume =
  | {
      /** 新規に PersistentVolumeClaim を作成してマウントする。 */
      readonly type: "persistentVolumeClaim";
      /** PVC の AccessMode（例: `ReadWriteOnce`）。 */
      readonly accessMode: string;
      /** 要求するストレージ容量（例: `1Gi`）。 */
      readonly size: string;
      /** StorageClass。省略時はクラスタのデフォルトプロビジョナーが使われる。 */
      readonly storageClass?: string;
      /** `true` の場合、Application 削除後も PVC を残す。 */
      readonly retain?: boolean;
      /** このボリュームをコンテナ内にマウントする場所。 */
      readonly globalMounts: readonly PersistenceMount[];
    }
  | {
      /** 既存の ConfigMap/Secret を参照する。名前のみ指定可能（チャート管理リソースの identifier 参照は非対応）。 */
      readonly type: "configMap" | "secret";
      /** 参照する ConfigMap/Secret の名前。あらかじめ対象 namespace に作成されている必要がある。 */
      readonly name: string;
      /** このボリュームをコンテナ内にマウントする場所。 */
      readonly globalMounts: readonly PersistenceMount[];
    }
  | {
      /** ノードのディスク上に確保される一時ボリューム。Pod 削除時にデータは失われる。 */
      readonly type: "emptyDir";
      /** このボリュームをコンテナ内にマウントする場所。 */
      readonly globalMounts: readonly PersistenceMount[];
    };

/** ボリュームのマウント先1件分の指定。 */
export interface PersistenceMount {
  /** マウント先のパス。 */
  readonly path: string;
  /** 読み取り専用でマウントするか。 */
  readonly readOnly?: boolean;
  /** ボリューム内の特定パスのみをマウントする場合に指定。 */
  readonly subPath?: string;
}

/** `createContainerApplication` が作成する Service の指定。 */
export interface ContainerServiceProps {
  /** ポート名をキーとした公開ポート一覧。 */
  readonly ports: Record< string, { readonly port: number } >;
}

/** `createContainerApplication` のプロパティ。 */
export interface ContainerApplicationProps {
  /** ArgoCD Application 名（= リソース名）。生成される Deployment/Service/PVC 等の名前にもなる。 */
  readonly name: string;
  /** インストール先 namespace。 */
  readonly namespace: string;
  /** bjw-s-labs/app-template チャート自体のバージョン。デプロイ対象アプリのバージョンは image.tag 側で指定する。 */
  readonly targetRevision: string;
  /** Application を所属させる AppProject 名。省略時は `default`。 */
  readonly project?: string;

  /** 実行するコンテナイメージ。 */
  readonly image: ContainerImage;
  /** コンテナのエントリポイントを上書きする。 */
  readonly command?: readonly string[];
  /** コンテナに渡す引数。 */
  readonly args?: readonly string[];
  /** コンテナのリソース制限・要求。 */
  readonly resources?: ContainerResources;

  /** 環境変数。値は文字列リテラル、または Secret/ConfigMap の特定キー参照のいずれか。 */
  readonly env?: Record< string, string | EnvValueFrom >;
  /** Secret/ConfigMap をまとめて環境変数として注入する。 */
  readonly envFrom?: readonly EnvFromSource[];

  /** 永続化ボリューム。キーがマウント識別子になる。 */
  readonly persistence?: Record< string, PersistenceVolume >;
  /** 公開する Service。省略時は Service を作成しない。 */
  readonly service?: ContainerServiceProps;
}

function buildImage( image: ContainerImage ): Record< string, unknown > {
  const out: Record< string, unknown > = { repository: image.repository, tag: image.tag };
  if ( image.pullPolicy !== undefined ) {
    out.pullPolicy = image.pullPolicy;
  }
  return out;
}

function buildEnv( env: Record< string, string | EnvValueFrom > ): Record< string, unknown > {
  const out: Record< string, unknown > = {};
  for ( const [ key, value ] of Object.entries( env ) ) {
    out[ key ] = typeof value === "string" ? value : { valueFrom: value };
  }
  return out;
}

function buildPersistenceItem( vol: PersistenceVolume ): Record< string, unknown > {
  const item: Record< string, unknown > = { globalMounts: vol.globalMounts };

  switch ( vol.type ) {
    case "configMap":
    case "secret":
      item.type = vol.type;
      item.name = vol.name;
      return item;
    case "emptyDir":
      item.type = "emptyDir";
      return item;
    case "persistentVolumeClaim":
      item.type = vol.type;
      item.accessMode = vol.accessMode;
      item.size = vol.size;
      if ( vol.storageClass !== undefined ) {
        item.storageClass = vol.storageClass;
      }
      if ( vol.retain !== undefined ) {
        item.retain = vol.retain;
      }
      return item;
  }
}

function buildPersistence( persistence: Record< string, PersistenceVolume > ): Record< string, unknown > {
  const out: Record< string, unknown > = {};
  for ( const [ key, vol ] of Object.entries( persistence ) ) {
    out[ key ] = buildPersistenceItem( vol );
  }
  return out;
}

/**
 * コンテナイメージから直接 ArgoCD Application を生成する。内部で bjw-s-labs/app-template
 * という汎用 Helm チャート（`createHelmApplication` 経由）をラップしており、呼び出し側は
 * Helm チャートの存在を意識する必要はない。
 *
 * `nameOverride` を明示的に `props.name` に固定している。app-template の fullname は
 * デフォルトで `<release名>-app-template` になり、release名（= Application名 = props.name）
 * と一致しないため、Service 名などのリソース名を props.name に揃えるための対応。
 *
 * @example
 * ```ts
 * createContainerApplication(this, "argocd-application", {
 *     name: "example-app",
 *     namespace: NAMESPACE,
 *     targetRevision: "5.0.1",
 *     image: { repository: "ghcr.io/example-org/example-app", tag: "1.0.0" },
 *     env: {
 *         LOG_LEVEL: "info",
 *         DB_PASSWORD: {
 *             secretKeyRef: { name: "example-app-secret", key: "db-password" },
 *         },
 *     },
 *     envFrom: [{ configMapRef: { name: "example-app-config" } }],
 *     persistence: {
 *         data: {
 *             type: "persistentVolumeClaim",
 *             accessMode: "ReadWriteOnce",
 *             size: "1Gi",
 *             globalMounts: [{ path: "/data" }],
 *         },
 *     },
 *     service: {
 *         ports: { http: { port: 8080 } },
 *     },
 * });
 * ```
 */
export function createContainerApplication( chart: Chart, id: string, props: ContainerApplicationProps ): ApiObject {
  const container: Record< string, unknown > = {
    image: buildImage( props.image ),
  };
  if ( props.command !== undefined ) {
    container.command = props.command;
  }
  if ( props.args !== undefined ) {
    container.args = props.args;
  }
  if ( props.resources !== undefined ) {
    container.resources = props.resources;
  }
  if ( props.env !== undefined ) {
    container.env = buildEnv( props.env );
  }
  if ( props.envFrom !== undefined ) {
    container.envFrom = props.envFrom;
  }

  const valuesObject: Record< string, unknown > = {
    nameOverride: props.name,
    controllers: {
      main: {
        containers: { main: container },
      },
    },
  };
  if ( props.persistence !== undefined ) {
    valuesObject.persistence = buildPersistence( props.persistence );
  }
  if ( props.service !== undefined ) {
    valuesObject.service = {
      main: { controller: "main", ports: props.service.ports },
    };
  }

  return createHelmApplication( chart, id, {
    name: props.name,
    namespace: props.namespace,
    project: props.project ?? "default",
    repoUrl: APP_TEMPLATE_REPO_URL,
    targetRevision: props.targetRevision,
    valuesObject,
  } );
}
