import { type App, Chart } from "cdk8s";
import { createHelmApplication } from "../../lib/argocd-application.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "arc-runners";

/**
 * ns: arc-runners（CI系: Runner本体・ephemeral）
 * ジョブ毎に ARC Controller（ns: actions-runner-system）が生成・破棄する Runner Pod の scale set。
 */
export class ArcRunnersChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );

    // githubConfigUrl/githubConfigSecret は対象リポジトリ・組織が未確定のため TODO。
    // githubConfigSecret はここでは平文Secretを作らず、事前に kubectl 等で作成済みのSecret名を指す想定。
    // targetRevision: 2026-08-13 時点の ghcr.io actions-runner-controller-charts 最新版。
    // actions-runner-system の gha-runner-scale-set-controller と同じバージョンで揃える。
    createHelmApplication( this, "argocd-application", {
      name: "arc-runners",
      namespace: NAMESPACE,
      repoUrl: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
      targetRevision: "0.14.2",
      valuesObject: {
        githubConfigUrl: "https://github.com/kuju63",
        githubConfigSecret: "github-config-secret",
        controllerServiceAccount: {
          namespace: "actions-runner-system",
          name: "arc-controller-gha-rs-controller",
        },
      },
    } );
  }
}
