import { ApiObject, type Chart } from "cdk8s";
import { CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE } from "./config.js";

/**
 * HTTPRoute の parentRef。Gateway を特定するための参照情報。
 */
interface HttpRouteParentRef {
  /** 対象 Gateway（GatewayClass）の名前。 */
  readonly name?: string;
  /** Gateway が配置された namespace。省略時は parentRef を付けた HTTPRoute と同じ namespace。 */
  readonly namespace?: string;
  /** GatewayClass の API group。省略時は `gateway.networking.k8s.io`。 */
  readonly group?: string;
  /** GatewayClass の kind。省略時は `GatewayClass`。 */
  readonly kind?: string;
}

/**
 * HTTPRoute の redirect フィルタ。リクエストを別 scheme・ホスト名へリダイレクトする。
 */
interface HttpRouteRequestRedirect {
  /** リダイレクト後の host名。省略時は元のリクエストと同じ。 */
  readonly hostname?: string;
  /** リダイレクト後の scheme（`http` / `https`）。 */
  readonly scheme?: string;
  /** リダイレクトのステータスコード（`301` / `302` / `307` のいずれか）。 */
  readonly statusCode?: number;
  /** リダイレクト後のポート。 */
  readonly port?: number;
}

/** URL パスの書き換え指定。replacePrefixMatch と replaceFullPath のいずれかのみ有効。 */
interface PathModifier {
  /** pathMatches の prefix と部分一致する部分をこの値で置換する。 */
  readonly replacePrefixMatch?: string;
  /** リクエストの path をこの値で全面置換する。 */
  readonly replaceFullPath?: string;
}

/** urlRewrite フィルタ。replacePrefixMatch または replaceFullPath のいずれかを含む。 */
interface UrlRewrite {
  /** URL パスの書き換え。プレフィックスまたはフルパスのいずれかのみ指定可能。 */
  readonly path: PathModifier;
}

/** HTTPRoute の filters（`spec.rules.filters`）。urlRewrite / header 操作 / redirect を含む。 */
interface HttpRouteFilters {
  /** URL パスを書き換え、バックエンドへ転送するリクエストの path を変更する。 */
  readonly urlRewrite?: UrlRewrite;
  /** リクエストヘッダーの操作。 */
  readonly requestHeaderModifier?: {
    /** 上書きするヘッダー（名前: 値）。 */
    readonly set?: string[];
    /** 追加するヘッダー（名前: 値）。 */
    readonly add?: string[];
    /** 削除するヘッダーの名前。 */
    readonly remove?: string[];
  };
  /** レスポンスヘッダーの操作。 */
  readonly responseHeaderModifier?: {
    /** 上書きするヘッダー（名前: 値）。 */
    readonly set?: string[];
    /** 追加するヘッダー（名前: 値）。 */
    readonly add?: string[];
    /** 削除するヘッダーの前名。 */
    readonly remove?: string[];
  };
  /** リクエストを別 interface ホストへリダイレクトする。 */
  readonly requestRedirect?: HttpRouteRequestRedirect;
}

/** HTTPRoute が転送するバックエンド Service。 */
interface BackendRef {
  /** バックエンド Service の名前。 */
  readonly name: string;
  /** ポート番号。省略時は Service 指定のデフォルトポートを指す。 */
  readonly port?: number;
}

/** HTTPRoute の単一 rule。 */
interface Rule {
  /** この rule が適用される host名リスト。省略時は spec.hostnames を継承する。 */
  readonly hostnames?: string[];
  /** この rule に付与する filter。 */
  readonly filters?: HttpRouteFilters;
  /** この rule 専用リダイレクト。unset 時は親 filters.requestRedirect を継承する。 */
  readonly requestRedirect?: HttpRouteRequestRedirect;
  /** 必須。ルートを転送するバックエンド。1 つ以上必要。 */
  readonly backendRefs: BackendRef[];
}

/**
 * `createHTTPRoute` への引数。
 */
interface Props {
  /** HTTPRoute の名前。 */
  readonly name: string;
  /** HTTPRoute が配置される namespace。バックエンド Service と同じ namespace を推奨。 */
  readonly namespace: string;
  /** この HTTPRoute が一致する host名リスト。省略時は `*.${CLUSTER_DOMAIN}` を単一要素生成する。 */
  readonly hostnames?: string[];
  /** 必須。1 つ以上のバックエンド Service。 */
  readonly backendRefs: BackendRef[];
  /** 接続する Gateway。省略時は GATEWAY_NAME / GATEWAY_NAMESPACE を既定値とする。 */
  readonly parentRefs?: HttpRouteParentRef[];
  /** 複数の rule を明示的に指定する。省略時は backendRefs（と任意の filter）を内包する rule を一件生成する。 */
  readonly rules?: Rule[];
  /** 全 rule に共通して付る filter。各 rule.filters には優先して反映される。 */
  readonly filters?: HttpRouteFilters;
  /** 全 rule に共通して適用するリダイレクト。各 rule.requestRedirect には優先して反映される。 */
  readonly requestRedirect?: HttpRouteRequestRedirect;
}

/** {@link HttpRouteParentRef} を ArgoCD 経由で管理するための parentRef に換算する。 */
function toParentRef( ref: HttpRouteParentRef ): Record< string, unknown > {
  const parentRef: Record< string, unknown > = {};

  if ( ref.name !== undefined ) {
    parentRef.name = ref.name;
  }

  if ( ref.namespace !== undefined ) {
    parentRef.namespace = ref.namespace;
  }

  if ( ref.group !== undefined ) {
    parentRef.group = ref.group;
  }

  if ( ref.kind !== undefined ) {
    parentRef.kind = ref.kind;
  }

  return parentRef;
}

/** {@link BackendRef} を ArgoCD 経由で管理するための backendRef に換算する。 */
function toBackendRef( ref: BackendRef ): Record< string, unknown > {
  const backendRef: Record< string, unknown > = { name: ref.name };

  if ( ref.port !== undefined ) {
    backendRef.port = ref.port;
  }

  return backendRef;
}

/** {@link Rule} を ArgoCD 経由で管理するための `spec.rules[]` に換算する。 */
function toRuleSpec( rule: Rule ): Record< string, unknown > {
  const ruleSpec: Record< string, unknown > = {
    backendRefs: rule.backendRefs.map( ( ref ) => toBackendRef( ref ) ),
  };

  if ( rule.hostnames !== undefined ) {
    ruleSpec.hostnames = rule.hostnames;
  }

  if ( rule.filters !== undefined ) {
    ruleSpec.filters = rule.filters;
  }

  if ( rule.requestRedirect !== undefined ) {
    ruleSpec.requestRedirect = rule.requestRedirect;
  }

  return ruleSpec;
}

/**
 * rules が未指定の場合、単一 rule を生成する。
 *
 * 渡された backendRefs を1 rule へ内包し、filter / requestRedirect がある場合は rule のフィルタへ
 * 継承する。requestRedirect は rule 指定が親指定を優先する（unset のみ親の値を継承）。
 */
function defaultFromRefs(
  backendRefs: BackendRef[],
  filters?: HttpRouteFilters,
  requestRedirect?: HttpRouteRequestRedirect,
): Record< string, unknown > {
  const rule: Record< string, unknown > = { backendRefs: backendRefs.map( ( ref ) => toBackendRef( ref ) ) };
  if ( filters !== undefined ) {
    rule.filters = filters;
  }

  const effectiveRedirect = requestRedirect ?? filters?.requestRedirect;
  if ( effectiveRedirect !== undefined ) {
    rule.requestRedirect = effectiveRedirect;
  }

  return rule;
}

/**
 * HTTPRoute を ArgoCD 経由で管理するための `HTTPRoute` リソースを生成する。
 *
 * cdk8s の `ApiObject` を直接生成する薄いラッパーであり、ArgoCD Application のような中間レイヤーを
 * 挟みません。`packages/ns/<namespace>/index.ts` で直接使うことを想定しています。
 *
 * 必須は `backendRefs` と `parentRefs` のみ。`parentRefs` は `GATEWAY_NAME` と `GATEWAY_NAMESPACE`
 * を既定値として埋めます。`hostnames` を省略した場合は `CLUSTER_DOMAIN` から `*.<domain>` を1件
 * 生成します。`rules` を省略した場合は `backendRefs` を内包する規則を1件生成します。
 */
export function createHTTPRoute( chart: Chart, props: Props ): ApiObject {
  if ( props.backendRefs.length === 0 ) {
    throw new Error( "HTTPRoute requires at least one backendRef." );
  }

  const parentRefs = props.parentRefs?.map( ( ref ) => toParentRef( ref ) ) ?? [
    { name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE },
  ];

  const hostnames = props.hostnames ?? [ `*.${ CLUSTER_DOMAIN }` ];

  let rules: Record< string, unknown >[];
  if ( props.rules ) {
    rules = props.rules.map( ( rule ) => toRuleSpec( rule ) );
  } else {
    rules = [ defaultFromRefs( props.backendRefs, props.filters, props.requestRedirect ) ];
  }

  return new ApiObject( chart, props.name, {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: props.name, namespace: props.namespace },
    spec: { hostnames, parentRefs, rules },
  } );
}
