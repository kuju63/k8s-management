import { type App, ApiObject, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { METALLB_ADDRESS_RANGE } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "metallb-system";
const POOL_NAME = "lan-pool";

/**
 * ns: metallb-system（運用系: 入口）
 * LANクライアントへ LoadBalancer IP を払い出す MetalLB を配置する。
 */
export class MetallbSystemChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        // repoURL/chart/targetRevision は要検証（upstream の最新値を確認すること）。
        createHelmApplication(this, "argocd-application", {
            name: "metallb",
            namespace: NAMESPACE,
            repoUrl: "https://metallb.github.io/metallb",
            chart: "metallb",
            targetRevision: "0.14.9",
        });

        new ApiObject(this, "ip-address-pool", {
            apiVersion: "metallb.io/v1beta1",
            kind: "IPAddressPool",
            metadata: { name: POOL_NAME, namespace: NAMESPACE },
            spec: {
                addresses: [METALLB_ADDRESS_RANGE],
            },
        });

        new ApiObject(this, "l2-advertisement", {
            apiVersion: "metallb.io/v1beta1",
            kind: "L2Advertisement",
            metadata: { name: "lan-l2", namespace: NAMESPACE },
            spec: {
                ipAddressPools: [POOL_NAME],
            },
        });
    }
}
