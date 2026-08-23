import { ApiObject, type Chart } from "cdk8s";
import { ARGOCD_NAMESPACE } from "./config.js";

/** AppProject が許可・禁止する Kubernetes リソース種別。 */
export interface AppProjectResource {
  /** API group。core API group は空文字、全 group は `*`。 */
  readonly group: string;
  /** Kind。全 Kind は `*`。 */
  readonly kind: string;
}

/**
 * クラスタを API server URL で指定するデプロイ先。
 * `name` は指定できない（{@link AppProjectNameDestination} と相互排他にするため）。
 */
export interface AppProjectServerDestination {
  /** デプロイ先クラスタの API server URL（例: `https://kubernetes.default.svc`）。 */
  readonly server: string;
  /** 許可する namespace。全 namespace は `*`。 */
  readonly namespace: string;
  /** このバリアントでは指定できない。 */
  readonly name?: never;
}

/**
 * クラスタを ArgoCD 登録名で指定するデプロイ先。
 * `server` は指定できない（{@link AppProjectServerDestination} と相互排他にするため）。
 */
export interface AppProjectNameDestination {
  /** デプロイ先クラスタの ArgoCD 登録名。 */
  readonly name: string;
  /** 許可する namespace。全 namespace は `*`。 */
  readonly namespace: string;
  /** このバリアントでは指定できない。 */
  readonly server?: never;
}

/** AppProject が許可するデプロイ先。server または name のどちらかでクラスタを指定する。 */
export type AppProjectDestination = AppProjectServerDestination | AppProjectNameDestination;

/** orphanedResources.ignore の1エントリ。 */
export interface AppProjectOrphanedResourceIgnore {
  readonly group?: string;
  readonly kind?: string;
  readonly name?: string;
}

/** プロジェクト配下の Application に対する ArgoCD RBAC role。 */
export interface AppProjectRole {
  /** role 名。RBAC subject は `proj:<project名>:<role名>` になる。 */
  readonly name: string;
  /** role の説明。 */
  readonly description?: string;
  /** Casbin policy（例: `p, proj:example:viewer, applications, get, example/*, allow`）。 */
  readonly policies?: readonly string[];
  /** この role に割り当てる OIDC group。 */
  readonly groups?: readonly string[];
}

/** `createAppProject` のプロパティ。 */
export interface AppProjectProps {
  /** AppProject 名（= リソース名。Application の `spec.project` から参照される）。 */
  readonly name: string;
  /** プロジェクトの説明。 */
  readonly description?: string;
  /** 許可する Git/Helm リポジトリ。`!` 前置の否定パターンと glob も指定できる。 */
  readonly sourceRepos: readonly string[];
  /** 許可するデプロイ先クラスタと namespace。 */
  readonly destinations: readonly AppProjectDestination[];
  /** Application を argocd 以外の namespace に置く場合に許可する namespace。 */
  readonly sourceNamespaces?: readonly string[];
  /** 許可するクラスタスコープリソース種別。 */
  readonly clusterResourceWhitelist?: readonly AppProjectResource[];
  /** 禁止するクラスタスコープリソース種別。 */
  readonly clusterResourceBlacklist?: readonly AppProjectResource[];
  /** 許可する namespace スコープリソース種別。 */
  readonly namespaceResourceWhitelist?: readonly AppProjectResource[];
  /** 禁止する namespace スコープリソース種別。 */
  readonly namespaceResourceBlacklist?: readonly AppProjectResource[];
  /** 孤立リソースの監視設定。 */
  readonly orphanedResources?: {
    readonly warn?: boolean;
    readonly ignore?: readonly AppProjectOrphanedResourceIgnore[];
  };
  /** プロジェクト RBAC role。OIDC group に紐づけられる。 */
  readonly roles?: readonly AppProjectRole[];
  /** project-scoped cluster だけを destination として許可する。 */
  readonly permitOnlyProjectScopedClusters?: boolean;
}

/**
 * ArgoCD AppProject を宣言的に生成する。
 *
 * AppProject は Application の論理的なグルーピングであり、許可する source リポジトリ・
 * デプロイ先クラスタ/namespace・リソース種別を制限し、プロジェクト単位の RBAC を定義できる。
 * AppProject リソースは ArgoCD がインストールされている namespace（{@link ARGOCD_NAMESPACE}）に
 * 置く必要があるため、`metadata.namespace` はここで固定する。
 *
 * @example
 * ```ts
 * createAppProject(this, "project", {
 *     name: "monitoring",
 *     description: "監視系スタック用プロジェクト",
 *     sourceRepos: [
 *         "https://prometheus-community.github.io/helm-charts",
 *         "https://grafana.github.io/helm-charts",
 *     ],
 *     destinations: [
 *         { server: "https://kubernetes.default.svc", namespace: "monitoring" },
 *     ],
 *     clusterResourceWhitelist: [{ group: "*", kind: "*" }],
 * });
 * ```
 */
export function createAppProject( chart: Chart, id: string, props: AppProjectProps ): ApiObject {
  const spec: Record< string, unknown > = {
    sourceRepos: props.sourceRepos,
    destinations: props.destinations,
  };

  if ( props.description !== undefined ) {
    spec.description = props.description;
  }
  if ( props.sourceNamespaces !== undefined ) {
    spec.sourceNamespaces = props.sourceNamespaces;
  }
  if ( props.clusterResourceWhitelist !== undefined ) {
    spec.clusterResourceWhitelist = props.clusterResourceWhitelist;
  }
  if ( props.clusterResourceBlacklist !== undefined ) {
    spec.clusterResourceBlacklist = props.clusterResourceBlacklist;
  }
  if ( props.namespaceResourceWhitelist !== undefined ) {
    spec.namespaceResourceWhitelist = props.namespaceResourceWhitelist;
  }
  if ( props.namespaceResourceBlacklist !== undefined ) {
    spec.namespaceResourceBlacklist = props.namespaceResourceBlacklist;
  }
  if ( props.orphanedResources !== undefined ) {
    spec.orphanedResources = props.orphanedResources;
  }
  if ( props.roles !== undefined ) {
    spec.roles = props.roles;
  }
  if ( props.permitOnlyProjectScopedClusters !== undefined ) {
    spec.permitOnlyProjectScopedClusters = props.permitOnlyProjectScopedClusters;
  }

  return new ApiObject( chart, id, {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "AppProject",
    metadata: { name: props.name, namespace: ARGOCD_NAMESPACE },
    spec,
  } );
}
