import { ApiObject, type Chart } from "cdk8s";
import { CLUSTER_DOMAIN, GATEWAY_NAME, GATEWAY_NAMESPACE } from "./config.js";

interface HttpRouteParentRef {
  readonly name?: string;
  readonly namespace?: string;
  readonly group?: string;
  readonly kind?: string;
}

interface HttpRouteRequestRedirect {
  readonly hostname?: string;
  readonly scheme?: string;
  readonly statusCode?: number;
  readonly port?: number;
}

interface PathModifier {
  readonly replacePrefixMatch?: string;
  readonly replaceFullPath?: string;
}

interface UrlRewrite {
  readonly path?: PathModifier;
}

interface HttpRouteFilters {
  readonly urlRewrite?: UrlRewrite;
  readonly requestHeaderModifier?: {
    readonly set?: string[];
    readonly add?: string[];
    readonly remove?: string[];
  };
  readonly responseHeaderModifier?: {
    readonly set?: string[];
    readonly add?: string[];
    readonly remove?: string[];
  };
  readonly requestRedirect?: HttpRouteRequestRedirect;
}

interface BackendRef {
  readonly name: string;
  readonly port?: BackendPort;
}

type BackendPort = number;

interface Rule {
  readonly hostnames?: string[];
  readonly filters?: HttpRouteFilters;
  readonly requestRedirect?: HttpRouteRequestRedirect;
  readonly backendRefs: BackendRef[];
}

interface Props {
  readonly name: string;
  readonly namespace: string;
  readonly hostnames?: string[];
  readonly backendRefs: BackendRef[];
  readonly parentRefs?: HttpRouteParentRef[];
  readonly rules?: Rule[];
  readonly filters?: HttpRouteFilters;
  readonly requestRedirect?: HttpRouteRequestRedirect;
}

function toParentRef( ref: HttpRouteParentRef ): Record< string, unknown > {
  const spec: Record< string, unknown > = {};

  if ( ref.name !== undefined ) {
    spec.name = ref.name;
  }

  if ( ref.namespace !== undefined ) {
    spec.namespace = ref.namespace;
  }

  if ( ref.group !== undefined ) {
    spec.group = ref.group;
  }

  if ( ref.kind !== undefined ) {
    spec.kind = ref.kind;
  }

  return spec;
}

function toBackendRef( ref: BackendRef ): Record< string, unknown > {
  const spec: Record< string, unknown > = { name: ref.name };

  if ( ref.port !== undefined ) {
    spec.port = ref.port;
  }

  return spec;
}

/**
 * HTTPRoute を ArgoCD 経由で管理するための `HTTPRoute` リソースを生成する。
 *
 * cdk8s の `ApiObject` を直接生成する薄いラッパーであり、ArgoCD Application のような
 * 中間レイヤーを挟みません。`packages/ns/<namespace>/index.ts` で直接使うことを想定しています。
 *
 * 必須は `backendRefs` と `parentRefs` のみ。`parentRefs` は `GATEWAY_NAME` と
 * `GATEWAY_NAMESPACE` を既定値として埋めます。`hostnames` を省略した場合は
 * `CLUSTER_DOMAIN` から `*. <domain>` を一件生成します。`rules` を省略した場合は
 * `backendRefs` を内包する規則を生成します。
 */ export function createHTTPRoute( chart: Chart, props: Props ): ApiObject {
  if ( ! props.backendRefs || props.backendRefs.length === 0 ) {
    throw new Error( "HTTPRoute requires at least one backendRef." );
  }

  let parentRefs: Array< Record< string, unknown > >;
  if ( props.parentRefs ) {
    parentRefs = props.parentRefs.map( ( ref ) => toParentRef( ref ) );
  } else {
    parentRefs = [ { name: GATEWAY_NAME, namespace: GATEWAY_NAMESPACE } ];
  }

  const backendRefs: Array< Record< string, unknown > > = props.backendRefs.map( ( ref ) => toBackendRef( ref ) );

  const hostnames = props.hostnames ?? [ `*. ${ CLUSTER_DOMAIN }` ];

  let rules: unknown[];
  if ( props.rules ) {
    rules = props.rules.map( ( rule ) => ruleToSpec( rule ) );
  } else {
    const ruleSpec: Record< string, unknown > = { backendRefs };
    if ( props.filters ) {
      ruleSpec.filters = props.filters;
    }
    const requestRedirect = props.requestRedirect ?? props.filters?.requestRedirect;
    if ( requestRedirect ) {
      ruleSpec.requestRedirect = requestRedirect;
    }

    rules = [ ruleSpec ];
  }

  return new ApiObject( chart, props.name, {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: props.name, namespace: props.namespace },
    spec: {
      hostnames,
      parentRefs,
      rules,
    },
  } );
}

function ruleToSpec( rule: Rule ): Record< string, unknown > {
  const spec: Record< string, unknown > = { backendRefs: rule.backendRefs };

  if ( rule.hostnames ) {
    spec.hostnames = rule.hostnames;
  }

  if ( rule.filters ) {
    spec.filters = rule.filters;
  }

  if ( rule.requestRedirect ) {
    spec.requestRedirect = rule.requestRedirect;
  }

  return spec;
}
