import { type App, ApiObject, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { GATEWAY_NAME, GATEWAY_NAMESPACE } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = GATEWAY_NAMESPACE;
const GATEWAY_CLASS_NAME = "envoy-gateway";

/**
 * ns: envoy-gateway-system（運用系: 入口）
 * MetalLB が払い出す LoadBalancer IP の先で HTTPRoute を捌く Envoy Gateway を配置する。
 * GatewayClass/Gateway はここに置き、各 HTTPRoute はバックエンド Service のある namespace
 * （apps/monitoring/argocd）側に置く（Gateway API の慣例）。
 */
export class EnvoyGatewaySystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );

    // targetRevision: 2026-08-13 時点の docker.io/envoyproxy/gateway-helm 最新安定タグ。
    createHelmApplication( this, "argocd-application", {
      name: "envoy-gateway",
      namespace: NAMESPACE,
      repoUrl: "oci://docker.io/envoyproxy/gateway-helm",
      targetRevision: "1.8.3",
    } );

    new ApiObject( this, "gateway-class", {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "GatewayClass",
      metadata: { name: GATEWAY_CLASS_NAME },
      spec: {
        controllerName: "gateway.envoyproxy.io/gatewayclass-controller",
      },
    } );

    new ApiObject( this, "gateway", {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "Gateway",
      metadata: { name: GATEWAY_NAME, namespace: NAMESPACE },
      spec: {
        gatewayClassName: GATEWAY_CLASS_NAME,
        listeners: [
          {
            name: "http",
            protocol: "HTTP",
            port: 80,
            // apps/monitoring/argocd など他namespaceのHTTPRouteからのアタッチを許可する。
            allowedRoutes: {
              namespaces: { from: "All" },
            },
          },
        ],
      },
    } );
  }
}
