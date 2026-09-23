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

/**
 * ArgoCD の差分比較から除外するフィールドの指定（`spec.ignoreDifferences` の1要素）。
 * API サーバーが正規化して live に残らない値など、実害のない恒常的な差分を抑えるために使う。
 */
export interface IgnoreDifference {
  /** 対象リソースの API グループ。core グループは空文字列。 */
  readonly group: string;
  /** 対象リソースの kind。 */
  readonly kind: string;
  /** 対象リソース名。省略時は同じ group/kind のすべてのリソース。 */
  readonly name?: string;
  /** 対象リソースの namespace。省略時は namespace を問わない。 */
  readonly namespace?: string;
  /** 除外するフィールドの JSON Pointer（例: `/spec/preserveUnknownFields`）。 */
  readonly jsonPointers?: readonly string[];
  /** 除外するフィールドの JQ パス式。 */
  readonly jqPathExpressions?: readonly string[];
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
  /** 差分比較から除外するフィールド。省略時は除外しない。 */
  readonly ignoreDifferences?: readonly IgnoreDifference[];
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
      ...( props.ignoreDifferences !== undefined ? { ignoreDifferences: props.ignoreDifferences } : {} ),
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
  /** Server-Side Apply を使うか。大きな CRD を含む配布物では `true` を指定する。 */
  readonly serverSideApply?: boolean;
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
        ...( props.serverSideApply === true ? { syncOptions: [ "ServerSideApply=true" ] } : {} ),
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
  /** Server-Side Apply を使うか。大きな CRD を含む配布物では `true` を指定する。 */
  readonly serverSideApply?: boolean;
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
    ...( props.serverSideApply !== undefined ? { serverSideApply: props.serverSideApply } : {} ),
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

export type AccessMode = "ReadWriteOnce" | "ReadOnlyMany" | "ReadWriteMany" | "ReadWriteOncePod";
/**
 * `createContainerApplication` の永続化ボリューム1件分の指定。
 * `persistence` オブジェクトのキーがマウント識別子（および Volume 名）になる。
 */
export type PersistenceVolume =
  | {
      /** 新規に PersistentVolumeClaim を作成してマウントする。 */
      readonly type: "persistentVolumeClaim";
      /** PVC の AccessMode（例: `ReadWriteOnce`）。 */
      readonly accessMode: AccessMode;
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

/**
 * `createContainerApplication` の `controllers.main.pod.securityContext`。
 * workload の Pod レベル securityContext（`fsGroup` 等）を指定するための最小限のインターフェース。
 */
export interface PodSecurityContext {
  /** Pod 内の全コンテナに適用される補足グループ。`fsGroup` として PVC の所有権変更や setgid に使われる。 */
  readonly fsGroup?: number;
  /**
   * ボリュームの所有権・パーミッション変更の挙動。`OnRootMismatch` を指定すると、
   * 既存のルートの所有権と一致しない場合のみ再帰処理を行い、新規 PVC 作成時の誤リマップを抑制できる。
   */
  readonly fsGroupChangePolicy?: string;
}

/** `createContainerApplication` のコンテナprobe指定。 */
export interface ContainerProbeProps {
  /** probeを有効化する。 */
  readonly enabled: boolean;
  /** app-templateの自動生成ではなく、`spec`をKubernetes Probeとして直接使用する。 */
  readonly custom: true;
  /** KubernetesのProbe spec。 */
  readonly spec: Record< string, unknown >;
}

/** コンテナのstartup/readiness/liveness probe。 */
export interface ContainerProbes {
  readonly startup?: ContainerProbeProps;
  readonly readiness?: ContainerProbeProps;
  readonly liveness?: ContainerProbeProps;
}

/**
 * `createContainerApplication` が生成するワークロードコントローラの種別。
 *
 * @remarks
 * `"deployment"` はステートレスなアプリ向け。PostgreSQL などの stateful な
 * アプリ（DB 等）では `"statefulset"` を指定する。
 */
export type ContainerControllerType = "deployment" | "statefulset";

/** `createContainerApplication` のプロパティ。 */
export interface ContainerApplicationProps {
  /** Application名。`nameOverride` として使われ、`app-template` の fullname に反映される。 */
  readonly name: string;
  /** インストール先 namespace。ArgoCD がリソースをデプロイする場所。 */
  readonly namespace: string;
  /** Application を所属させる AppProject 名。省略時は `default`。 */
  readonly project?: string;

  /**
   * 生成するワークロードコントローラの種別。
   *
   * @remarks
   * PostgreSQL などの stateful なアプリ（DB 等）では `"statefulset"` を指定する。
   * StatefulSet 化しても永続化は自動では有効にならないため、あわせて
   * `persistence` で PVC を指定すること。また `syncPolicy.automated.prune` が
   * 常に有効なため、データを残したい PVC には `persistence` 側で `retain: true`
   * を指定する。
   *
   * @defaultValue `"deployment"`
   */
  readonly controllerType?: ContainerControllerType;

  /** 実行するコンテナイメージ。 */
  readonly image: ContainerImage;
  /** コンテナのエントリポイントを上書きする。 */
  readonly command?: readonly string[];
  /** コンテナに渡す引数。 */
  readonly args?: readonly string[];
  /** コンテナのリソース制限・要求。 */
  readonly resources?: ContainerResources;

  /** コンテナのstartup/readiness/liveness probe。 */
  readonly probes?: ContainerProbes;

  /** 環境変数。値は文字列リテラル、または Secret/ConfigMap の特定キー参照のいずれか。 */
  readonly env?: Record< string, string | EnvValueFrom >;
  /** Secret/ConfigMap をまとめて環境変数として注入する。 */
  readonly envFrom?: readonly EnvFromSource[];

  /** 永続化ボリューム。キーがマウント識別子になる。 */
  readonly persistence?: Record< string, PersistenceVolume >;
  /** 公開する Service。省略時は Service を作成しない。 */
  readonly service?: ContainerServiceProps;
  /**
   * 起動するPod数。省略時は app-template チャートのデフォルト（1）が使われる。
   * rolling update や高可用性が必要な場合は、明示的に2以上を指定すること。
   */
  readonly replicas?: number;

  /**
   * init Container。app-template チャートの `initContainers` テンプレート
   * に対応し、キー名は生成される Kubernetes リソースのマウント識別子になる。
   */
  readonly initContainers?: Record< string, InitContainerValues >;

  /**
   * workload の `controllers.main.pod.securityContext`。
   * PVC 等へ `fsGroup` を適用し、非 root コンテナから書き込みできる所有者を変更する。
   */
  readonly podSecurityContext?: PodSecurityContext;
}

/**
 * init Container の指定。app-template チャートの init container テンプレート
 * に渡す値を構造化する最小限のインターフェース。
 */
export interface InitContainerValues {
  /** コンテナイメージ。 */
  readonly image: string;
  /** コンテナのエントリポイント。省略時は初めから `command` を指定する。 */
  readonly command?: readonly string[];
  /** コンテナに渡す引数。 */
  readonly args?: readonly string[];
  /** volumeMount。PVC 等のマウント識別子は `persistence` に定義済みキーと同じものを使う。 */
  readonly volumeMounts?: ReadonlyArray< { name: string; mountPath: string; readOnly?: boolean } >;
}

/**
 * app-template チャート本体のバージョン。`createContainerApplication` や
 * `createHelmApplicationSet` の container エントリが内部で使用する固定値。
 */
export const APP_TEMPLATE_TARGET_REVISION = "5.1.0";

/**
 * `createContainerApplication` が受け取るプロパティのうち、app-template の
 * `valuesObject` を構築するために必要な部分（namespace/project を除く）。
 */
export type ContainerValuesProps = Omit< ContainerApplicationProps, "namespace" | "project" >;

/**
 * コンテナ指定を app-template チャートの `valuesObject` へ変換する。
 * `createContainerApplication` と、ApplicationSet の container エントリで共有する。
 */
export function buildContainerValuesObject( props: ContainerValuesProps ): Record< string, unknown > {
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
  if ( props.probes !== undefined ) {
    container.probes = props.probes;
  }
  if ( props.env !== undefined ) {
    container.env = buildEnv( props.env );
  }
  if ( props.envFrom !== undefined ) {
    container.envFrom = props.envFrom;
  }

  const controller: Record< string, unknown > = {
    replicas: props.replicas,
    containers: { main: container },
  };
  if ( props.controllerType !== undefined ) {
    controller.type = props.controllerType;
  }

  const valuesObject: Record< string, unknown > = {
    nameOverride: props.name,
    controllers: {
      main: controller,
    },
  };
  if ( props.persistence !== undefined ) {
    valuesObject.persistence = buildPersistence( props.persistence );
  }
  if ( props.initContainers !== undefined ) {
    valuesObject.initContainers = buildInitContainers( props.initContainers );
  }
  if ( props.podSecurityContext !== undefined ) {
    controller.pod = { securityContext: props.podSecurityContext };
  }
  if ( props.service !== undefined ) {
    valuesObject.service = {
      main: { controller: "main", ports: props.service.ports },
    };
  }
  return valuesObject;
}

function buildImage( image: ContainerImage ): Record< string, unknown > {
  const out: Record< string, unknown > = { repository: image.repository, tag: image.tag };
  if ( image.pullPolicy !== undefined ) {
    out.pullPolicy = image.pullPolicy;
  }
  return out;
}

function buildInitContainerItem( init: InitContainerValues ): Record< string, unknown > {
  const item: Record< string, unknown > = { image: init.image };
  if ( init.command !== undefined ) {
    item.command = init.command;
  }
  if ( init.args !== undefined ) {
    item.args = init.args;
  }
  if ( init.volumeMounts !== undefined ) {
    item.volumeMounts = init.volumeMounts;
  }
  return item;
}

export function buildInitContainers(
  initContainers: Record< string, InitContainerValues >,
): Record< string, unknown > {
  const out: Record< string, unknown > = {};
  for ( const [ key, init ] of Object.entries( initContainers ) ) {
    out[ key ] = buildInitContainerItem( init );
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
 * @remarks
 * `controllerType` に `"statefulset"` を指定すると、生成されるワークロードが
 * StatefulSet になる。PostgreSQL などの stateful なアプリ（DB 等）向け。
 * StatefulSet 化しても永続化は自動では有効にならないため、あわせて `persistence`
 * で PVC を指定する。`syncPolicy.automated.prune` が常に有効なため、削除時に
 * データを残したい PVC には `retain: true` を指定すること。
 *
 * @example
 * 単一コンテナのステートレスなアプリ:
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
 *
 * @example
 * PostgreSQL などの stateful なアプリ（StatefulSet + PVC）:
 * ```ts
 * createContainerApplication(this, "argocd-application", {
 *     name: "postgresql",
 *     namespace: NAMESPACE,
 *     targetRevision: "5.0.1",
 *     controllerType: "statefulset",
 *     image: { repository: "postgres", tag: "17" },
 *     env: {
 *         POSTGRES_PASSWORD: {
 *             secretKeyRef: { name: "postgresql-secret", key: "password" },
 *         },
 *     },
 *     persistence: {
 *         data: {
 *             type: "persistentVolumeClaim",
 *             accessMode: "ReadWriteOnce",
 *             size: "10Gi",
 *             retain: true,
 *             globalMounts: [{ path: "/var/lib/postgresql/data" }],
 *         },
 *     },
 *     service: {
 *         ports: { postgresql: { port: 5432 } },
 *     },
 * });
 * ```
 */
export function createContainerApplication( chart: Chart, id: string, props: ContainerApplicationProps ): ApiObject {
  return createHelmApplication( chart, id, {
    name: props.name,
    namespace: props.namespace,
    project: props.project ?? "default",
    repoUrl: APP_TEMPLATE_REPO_URL,
    targetRevision: APP_TEMPLATE_TARGET_REVISION,
    valuesObject: buildContainerValuesObject( props ),
  } );
}
