import { ApiObject, type Chart } from "cdk8s";

interface MutableApiObjectProps {
  apiVersion: string;
  kind: string;
  metadata: Record< string, unknown >;
  [ key: string ]: unknown;
}

const CORE_API_VERSION = "v1";
const RBAC_API_VERSION = "rbac.authorization.k8s.io/v1";
const RBAC_API_GROUP = "rbac.authorization.k8s.io";

/** Kubernetes RBAC のルールで使用できる代表的な操作。 */
export type RbacVerb =
  | "get"
  | "list"
  | "watch"
  | "create"
  | "update"
  | "patch"
  | "delete"
  | "deletecollection"
  | "post"
  | "put"
  | "head"
  | "options"
  | "impersonate"
  | "bind"
  | "escalate"
  | "approve"
  | "proxy"
  | "*";

/** Kubernetes API リソースに対する権限ルール。 */
export interface ResourcePolicyRule {
  /** 対象 API group。core API group は空文字、すべての API group は `*`。 */
  readonly apiGroups: readonly string[];
  /** 対象リソース名。サブリソースは `pods/log` のように指定する。 */
  readonly resources: readonly string[];
  /** 許可する操作。 */
  readonly verbs: readonly RbacVerb[];
  /** 権限を特定のリソースインスタンスに限定する場合の名前。 */
  readonly resourceNames?: readonly string[];
  /** リソースルールでは指定できない。 */
  readonly nonResourceURLs?: never;
}

/** Kubernetes API のリソースではない URL に対する権限ルール。 */
export interface NonResourcePolicyRule {
  /** 対象 URL。末尾の `*` による部分一致を使用できる。 */
  readonly nonResourceURLs: readonly string[];
  /** 許可する HTTP 操作。 */
  readonly verbs: readonly RbacVerb[];
  /** 非リソース URL のルールでは指定できない。 */
  readonly apiGroups?: never;
  /** 非リソース URL のルールでは指定できない。 */
  readonly resources?: never;
  /** 非リソース URL のルールでは指定できない。 */
  readonly resourceNames?: never;
}

/** Role または ClusterRole に設定できる権限ルール。 */
export type PolicyRule = ResourcePolicyRule | NonResourcePolicyRule;

/** ラベルセレクターの `In` または `NotIn` 条件。 */
export interface LabelSelectorSetRequirement {
  /** 評価するラベルキー。 */
  readonly key: string;
  /** 値集合との包含関係を評価する演算子。 */
  readonly operator: "In" | "NotIn";
  /** 比較対象となる1件以上の値。 */
  readonly values: readonly string[];
}

/** ラベルセレクターの `Exists` または `DoesNotExist` 条件。 */
export interface LabelSelectorExistenceRequirement {
  /** 評価するラベルキー。 */
  readonly key: string;
  /** ラベルキーの存在有無を評価する演算子。 */
  readonly operator: "Exists" | "DoesNotExist";
  /** 存在有無を評価する条件では指定できない。 */
  readonly values?: never;
}

/** ラベルセレクターに設定できる集合条件または存在条件。 */
export type LabelSelectorRequirement = LabelSelectorSetRequirement | LabelSelectorExistenceRequirement;

/** ClusterRole の集約対象を選択する Kubernetes ラベルセレクター。 */
export interface ClusterRoleLabelSelector {
  /** 完全一致させるラベルのキーと値。 */
  readonly matchLabels?: Readonly< Record< string, string > >;
  /** 集合演算または存在判定によるラベル条件。 */
  readonly matchExpressions?: readonly LabelSelectorRequirement[];
}

/** 複数の ClusterRole のルールを自動集約する条件。 */
export interface ClusterRoleAggregationRule {
  /** 集約対象となる ClusterRole を選択するラベルセレクター。 */
  readonly clusterRoleSelectors: readonly ClusterRoleLabelSelector[];
}

/** RoleBinding または ClusterRoleBinding が参照する ServiceAccount。 */
export interface ServiceAccountSubject {
  /** Subject の種別。 */
  readonly kind: "ServiceAccount";
  /** ServiceAccount 名。 */
  readonly name: string;
  /** ServiceAccount が属する namespace。 */
  readonly namespace: string;
  /** ServiceAccount は core API group に属するため指定できない。 */
  readonly apiGroup?: never;
}

/** RoleBinding または ClusterRoleBinding が参照する認証済みユーザー。 */
export interface UserSubject {
  /** Subject の種別。 */
  readonly kind: "User";
  /** 認証システムが認識するユーザー名。 */
  readonly name: string;
  /** RBAC API group。省略時は `rbac.authorization.k8s.io`。 */
  readonly apiGroup?: "rbac.authorization.k8s.io";
  /** User には namespace を指定できない。 */
  readonly namespace?: never;
}

/** RoleBinding または ClusterRoleBinding が参照する認証グループ。 */
export interface GroupSubject {
  /** Subject の種別。 */
  readonly kind: "Group";
  /** 認証システムが認識するグループ名。 */
  readonly name: string;
  /** RBAC API group。省略時は `rbac.authorization.k8s.io`。 */
  readonly apiGroup?: "rbac.authorization.k8s.io";
  /** Group には namespace を指定できない。 */
  readonly namespace?: never;
}

/** RoleBinding または ClusterRoleBinding に権限を付与される主体。 */
export type RbacSubject = ServiceAccountSubject | UserSubject | GroupSubject;

/** RoleBinding が参照する Role または ClusterRole。 */
export interface RoleBindingRoleRef {
  /** 参照する RBAC リソースの種別。 */
  readonly kind: "Role" | "ClusterRole";
  /** 参照する Role または ClusterRole の名前。 */
  readonly name: string;
}

/** ClusterRoleBinding が参照する ClusterRole。 */
export interface ClusterRoleBindingRoleRef {
  /** ClusterRoleBinding では `ClusterRole` のみ参照できる。 */
  readonly kind: "ClusterRole";
  /** 参照する ClusterRole の名前。 */
  readonly name: string;
}

/** ServiceAccount の Secret または image pull Secret への参照。 */
export interface ServiceAccountSecretReference {
  /** 同じ namespace に存在する Secret 名。 */
  readonly name: string;
}

/** ServiceAccount リソースを生成するためのオプション。 */
export interface ServiceAccountOptions {
  /** ServiceAccount 名。 */
  readonly name: string;
  /** ServiceAccount を配置する namespace。 */
  readonly namespace: string;
  /** ServiceAccount に付与するラベル。 */
  readonly labels?: Readonly< Record< string, string > >;
  /** ServiceAccount に付与するアノテーション。 */
  readonly annotations?: Readonly< Record< string, string > >;
  /** Pod への API アクセストークンの自動マウント可否。 */
  readonly automountServiceAccountToken?: boolean;
  /** コンテナイメージ取得時に使用する Secret。 */
  readonly imagePullSecrets?: readonly ServiceAccountSecretReference[];
  /** ServiceAccount に関連付ける Secret。 */
  readonly secrets?: readonly ServiceAccountSecretReference[];
}

/** Role リソースを生成するためのオプション。 */
export interface RoleOptions {
  /** Role 名。 */
  readonly name: string;
  /** Role を配置し、権限を適用する namespace。 */
  readonly namespace: string;
  /** Role に付与するラベル。 */
  readonly labels?: Readonly< Record< string, string > >;
  /** Role に付与するアノテーション。 */
  readonly annotations?: Readonly< Record< string, string > >;
  /** namespace 内の Kubernetes API リソースに対する権限ルール。 */
  readonly rules: readonly ResourcePolicyRule[];
}

/** ルールを直接定義する ClusterRole のオプション。 */
export interface ExplicitClusterRoleOptions {
  /** ClusterRole 名。 */
  readonly name: string;
  /** ClusterRole に付与するラベル。 */
  readonly labels?: Readonly< Record< string, string > >;
  /** ClusterRole に付与するアノテーション。 */
  readonly annotations?: Readonly< Record< string, string > >;
  /** クラスタ全体または非リソース URL に対する権限ルール。 */
  readonly rules: readonly PolicyRule[];
  /** ルールを直接定義する場合は集約条件を指定できない。 */
  readonly aggregationRule?: never;
}

/** 他の ClusterRole からルールを集約する ClusterRole のオプション。 */
export interface AggregatedClusterRoleOptions {
  /** ClusterRole 名。 */
  readonly name: string;
  /** ClusterRole に付与するラベル。 */
  readonly labels?: Readonly< Record< string, string > >;
  /** ClusterRole に付与するアノテーション。 */
  readonly annotations?: Readonly< Record< string, string > >;
  /** 他の ClusterRole を選択してルールを集約する条件。 */
  readonly aggregationRule: ClusterRoleAggregationRule;
  /** 集約コントローラーが管理するため、ルールを直接指定できない。 */
  readonly rules?: never;
}

/** ClusterRole リソースを生成するためのオプション。 */
export type ClusterRoleOptions = ExplicitClusterRoleOptions | AggregatedClusterRoleOptions;

/** RoleBinding リソースを生成するためのオプション。 */
export interface RoleBindingOptions {
  /** RoleBinding 名。 */
  readonly name: string;
  /** RoleBinding を配置し、権限を適用する namespace。 */
  readonly namespace: string;
  /** RoleBinding に付与するラベル。 */
  readonly labels?: Readonly< Record< string, string > >;
  /** RoleBinding に付与するアノテーション。 */
  readonly annotations?: Readonly< Record< string, string > >;
  /** 権限を付与する ServiceAccount、User、Group。 */
  readonly subjects: readonly RbacSubject[];
  /** 権限の参照元となる Role または ClusterRole。 */
  readonly roleRef: RoleBindingRoleRef;
}

/** ClusterRoleBinding リソースを生成するためのオプション。 */
export interface ClusterRoleBindingOptions {
  /** ClusterRoleBinding 名。 */
  readonly name: string;
  /** ClusterRoleBinding に付与するラベル。 */
  readonly labels?: Readonly< Record< string, string > >;
  /** ClusterRoleBinding に付与するアノテーション。 */
  readonly annotations?: Readonly< Record< string, string > >;
  /** クラスタ全体で権限を付与する ServiceAccount、User、Group。 */
  readonly subjects: readonly RbacSubject[];
  /** 権限の参照元となる ClusterRole。 */
  readonly roleRef: ClusterRoleBindingRoleRef;
}

/**
 * Kubernetes ServiceAccount を生成する。
 *
 * @param chart リソースを配置する `cdk8s` の Chart
 * @param id Chart 内で一意となるリソース ID
 * @param options ServiceAccount の名前、namespace、トークンおよび Secret の設定
 * @returns 生成した ServiceAccount の ApiObject
 *
 * @example
 * ```ts
 * createServiceAccount(this, "reader-service-account", {
 *   name: "reader",
 *   namespace: "example",
 *   automountServiceAccountToken: false,
 * });
 * ```
 */
export function createServiceAccount( chart: Chart, id: string, options: ServiceAccountOptions ): ApiObject {
  validateName( options.name, "ServiceAccount name" );
  validateName( options.namespace, "ServiceAccount namespace" );

  const resource: MutableApiObjectProps = {
    apiVersion: CORE_API_VERSION,
    kind: "ServiceAccount",
    metadata: createMetadata( options ),
  };

  if ( options.automountServiceAccountToken !== undefined ) {
    resource.automountServiceAccountToken = options.automountServiceAccountToken;
  }
  if ( options.imagePullSecrets !== undefined ) {
    validateSecretReferences( options.imagePullSecrets, "imagePullSecrets" );
    resource.imagePullSecrets = options.imagePullSecrets;
  }
  if ( options.secrets !== undefined ) {
    validateSecretReferences( options.secrets, "secrets" );
    resource.secrets = options.secrets;
  }

  return new ApiObject( chart, id, resource );
}

/**
 * namespace 内の Kubernetes API リソースに対する Role を生成する。
 *
 * @param chart リソースを配置する `cdk8s` の Chart
 * @param id Chart 内で一意となるリソース ID
 * @param options Role の名前、namespace、権限ルール
 * @returns 生成した Role の ApiObject
 *
 * @example
 * ```ts
 * createRole(this, "pod-reader-role", {
 *   name: "pod-reader",
 *   namespace: "example",
 *   rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
 * });
 * ```
 */
export function createRole( chart: Chart, id: string, options: RoleOptions ): ApiObject {
  validateName( options.name, "Role name" );
  validateName( options.namespace, "Role namespace" );
  validateResourceRules( options.rules, "Role rules" );

  return new ApiObject( chart, id, {
    apiVersion: RBAC_API_VERSION,
    kind: "Role",
    metadata: createMetadata( options ),
    rules: options.rules,
  } );
}

/**
 * クラスタ全体または非リソース URL に対する ClusterRole を生成する。
 *
 * `rules` による直接定義と `aggregationRule` による自動集約は相互排他である。
 *
 * @param chart リソースを配置する `cdk8s` の Chart
 * @param id Chart 内で一意となるリソース ID
 * @param options ClusterRole の名前と、権限ルールまたは集約条件
 * @returns 生成した ClusterRole の ApiObject
 *
 * @example
 * ```ts
 * createClusterRole(this, "node-reader-cluster-role", {
 *   name: "node-reader",
 *   rules: [{ apiGroups: [""], resources: ["nodes"], verbs: ["get", "list"] }],
 * });
 * ```
 */
export function createClusterRole( chart: Chart, id: string, options: ClusterRoleOptions ): ApiObject {
  validateName( options.name, "ClusterRole name" );

  const resource: MutableApiObjectProps = {
    apiVersion: RBAC_API_VERSION,
    kind: "ClusterRole",
    metadata: createMetadata( options ),
  };

  if ( options.aggregationRule !== undefined ) {
    validateAggregationRule( options.aggregationRule );
    resource.aggregationRule = options.aggregationRule;
  } else if ( options.rules !== undefined ) {
    validatePolicyRules( options.rules, "ClusterRole rules" );
    resource.rules = options.rules;
  } else {
    throw new Error( "ClusterRole requires either rules or aggregationRule." );
  }

  return new ApiObject( chart, id, resource );
}

/**
 * namespace 内で Role または ClusterRole の権限を主体へ付与する RoleBinding を生成する。
 *
 * @param chart リソースを配置する `cdk8s` の Chart
 * @param id Chart 内で一意となるリソース ID
 * @param options RoleBinding の名前、namespace、主体、参照する Role
 * @returns 生成した RoleBinding の ApiObject
 *
 * @example
 * ```ts
 * createRoleBinding(this, "pod-reader-binding", {
 *   name: "pod-reader",
 *   namespace: "example",
 *   subjects: [{ kind: "ServiceAccount", name: "reader", namespace: "example" }],
 *   roleRef: { kind: "Role", name: "pod-reader" },
 * });
 * ```
 */
export function createRoleBinding( chart: Chart, id: string, options: RoleBindingOptions ): ApiObject {
  validateName( options.name, "RoleBinding name" );
  validateName( options.namespace, "RoleBinding namespace" );
  validateSubjects( options.subjects );
  validateName( options.roleRef.name, "RoleBinding roleRef name" );

  return new ApiObject( chart, id, {
    apiVersion: RBAC_API_VERSION,
    kind: "RoleBinding",
    metadata: createMetadata( options ),
    subjects: options.subjects.map( renderSubject ),
    roleRef: {
      apiGroup: RBAC_API_GROUP,
      kind: options.roleRef.kind,
      name: options.roleRef.name,
    },
  } );
}

/**
 * クラスタ全体で ClusterRole の権限を主体へ付与する ClusterRoleBinding を生成する。
 *
 * @param chart リソースを配置する `cdk8s` の Chart
 * @param id Chart 内で一意となるリソース ID
 * @param options ClusterRoleBinding の名前、主体、参照する ClusterRole
 * @returns 生成した ClusterRoleBinding の ApiObject
 *
 * @example
 * ```ts
 * createClusterRoleBinding(this, "node-reader-binding", {
 *   name: "node-reader",
 *   subjects: [{ kind: "Group", name: "infrastructure-readers" }],
 *   roleRef: { kind: "ClusterRole", name: "node-reader" },
 * });
 * ```
 */
export function createClusterRoleBinding( chart: Chart, id: string, options: ClusterRoleBindingOptions ): ApiObject {
  validateName( options.name, "ClusterRoleBinding name" );
  validateSubjects( options.subjects );
  validateName( options.roleRef.name, "ClusterRoleBinding roleRef name" );

  return new ApiObject( chart, id, {
    apiVersion: RBAC_API_VERSION,
    kind: "ClusterRoleBinding",
    metadata: createMetadata( options ),
    subjects: options.subjects.map( renderSubject ),
    roleRef: {
      apiGroup: RBAC_API_GROUP,
      kind: options.roleRef.kind,
      name: options.roleRef.name,
    },
  } );
}

interface MetadataOptions {
  readonly name: string;
  readonly namespace?: string;
  readonly labels?: Readonly< Record< string, string > >;
  readonly annotations?: Readonly< Record< string, string > >;
}

function createMetadata( options: MetadataOptions ): Record< string, unknown > {
  const metadata: Record< string, unknown > = { name: options.name };

  if ( options.namespace !== undefined ) {
    metadata.namespace = options.namespace;
  }
  if ( options.labels !== undefined ) {
    metadata.labels = options.labels;
  }
  if ( options.annotations !== undefined ) {
    metadata.annotations = options.annotations;
  }

  return metadata;
}

function renderSubject( subject: RbacSubject ): Record< string, string > {
  if ( subject.kind === "ServiceAccount" ) {
    return {
      kind: subject.kind,
      name: subject.name,
      namespace: subject.namespace,
    };
  }

  return {
    apiGroup: subject.apiGroup ?? RBAC_API_GROUP,
    kind: subject.kind,
    name: subject.name,
  };
}

function validateName( value: string, field: string ): void {
  if ( value.trim().length === 0 ) {
    throw new Error( `${ field } must not be empty.` );
  }
}

function validateSecretReferences( references: readonly ServiceAccountSecretReference[], field: string ): void {
  for ( const reference of references ) {
    validateName( reference.name, `ServiceAccount ${ field } name` );
  }
}

function validateSubjects( subjects: readonly RbacSubject[] ): void {
  if ( subjects.length === 0 ) {
    throw new Error( "Role binding subjects must contain at least one entry." );
  }

  for ( const subject of subjects ) {
    validateName( subject.name, `${ subject.kind } subject name` );
    if ( subject.kind === "ServiceAccount" ) {
      validateName( subject.namespace, "ServiceAccount subject namespace" );
    }
  }
}

function validateResourceRules( rules: readonly ResourcePolicyRule[], field: string ): void {
  if ( rules.length === 0 ) {
    throw new Error( `${ field } must contain at least one entry.` );
  }

  for ( const rule of rules ) {
    validateNonEmptyArray( rule.apiGroups, `${ field } apiGroups` );
    validateNonEmptyArray( rule.resources, `${ field } resources` );
    validateNonEmptyArray( rule.verbs, `${ field } verbs` );
  }
}

function validatePolicyRules( rules: readonly PolicyRule[], field: string ): void {
  if ( rules.length === 0 ) {
    throw new Error( `${ field } must contain at least one entry.` );
  }

  for ( const rule of rules ) {
    validateNonEmptyArray( rule.verbs, `${ field } verbs` );
    if ( rule.nonResourceURLs !== undefined ) {
      validateNonEmptyArray( rule.nonResourceURLs, `${ field } nonResourceURLs` );
    } else {
      validateNonEmptyArray( rule.apiGroups, `${ field } apiGroups` );
      validateNonEmptyArray( rule.resources, `${ field } resources` );
    }
  }
}

function validateAggregationRule( aggregationRule: ClusterRoleAggregationRule ): void {
  validateNonEmptyArray( aggregationRule.clusterRoleSelectors, "ClusterRole aggregationRule clusterRoleSelectors" );

  for ( const selector of aggregationRule.clusterRoleSelectors ) {
    const hasLabels = selector.matchLabels !== undefined && Object.keys( selector.matchLabels ).length > 0;
    const hasExpressions = selector.matchExpressions !== undefined && selector.matchExpressions.length > 0;

    if ( ! hasLabels && ! hasExpressions ) {
      throw new Error( "ClusterRole aggregation selector must not be empty." );
    }

    for ( const expression of selector.matchExpressions ?? [] ) {
      validateName( expression.key, "ClusterRole aggregation selector key" );
      if ( expression.operator === "In" || expression.operator === "NotIn" ) {
        validateNonEmptyArray( expression.values, "ClusterRole aggregation selector values" );
      }
    }
  }
}

function validateNonEmptyArray( values: readonly unknown[], field: string ): void {
  if ( values.length === 0 ) {
    throw new Error( `${ field } must contain at least one entry.` );
  }
}
