import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "actions-runner-system";

/**
 * ns: actions-runner-system（CI系: ARC Controller・常駐）
 * GitHub 公式推奨に沿い、常駐する Controller は ephemeral な Runner 本体（ns: arc-runners）と
 * namespace を分離する。
 */
export class ActionsRunnerSystemChart extends Chart {
    constructor(scope: App) {
        super(scope, NAMESPACE);

        createNamespace(this, NAMESPACE);

        // targetRevision: 2026-08-13 時点の ghcr.io actions-runner-controller-charts 最新版。
        // arc-runners の gha-runner-scale-set と同じバージョンで揃える(セットでリリースされるため)。
        createHelmApplication(this, "argocd-application", {
            name: "arc-controller",
            namespace: NAMESPACE,
            repoUrl: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller",
            targetRevision: "0.14.2",
        });
    }
}
