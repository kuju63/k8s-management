import { execFileSync } from "node:child_process";
import { App } from "cdk8s";
import { MANIFESTS_PATH } from "./lib/config.js";
import { ActionsRunnerSystemChart } from "./ns/actions-runner-system/index.js";
import { ArcRunnersChart } from "./ns/arc-runners/index.js";
import { ArgocdChart } from "./ns/argocd/index.js";
import { EnvoyGatewaySystemChart } from "./ns/envoy-gateway-system/index.js";
import { MetallbSystemChart } from "./ns/metallb-system/index.js";
import { MonitoringChart } from "./ns/monitoring/index.js";

function buildApp(): App {
  const app = new App( { outdir: MANIFESTS_PATH } );

  new MetallbSystemChart( app );
  new EnvoyGatewaySystemChart( app );
  new ArgocdChart( app );
  new ActionsRunnerSystemChart( app );
  new ArcRunnersChart( app );
  new MonitoringChart( app );

  return app;
}

/** 全 namespace 分の manifest を {@link MANIFESTS_PATH} 配下に synth する。 */
export function synth(): string {
  buildApp().synth();
  return MANIFESTS_PATH;
}

/**
 * synth した manifest を `kubectl apply` する。
 *
 * 既知の制約: MetalLB の IPAddressPool や Gateway API の Gateway など CRD インスタンスは、
 * 対応する CRD（各コンポーネントの Helm チャート由来）がクラスタに存在しないと初回は適用に失敗しうる。
 * ArgoCD が Helm チャートを sync した後であれば解消するため、初回ブートストラップ時は
 * 複数回 apply が必要になる場合がある。
 */
export function apply(): void {
  synth();
  execFileSync( "kubectl", [ "apply", "-R", "-f", MANIFESTS_PATH ], { stdio: "inherit" } );
}

function main(): void {
  const command = process.argv[ 2 ] ?? "synth";

  if ( command === "apply" ) {
    apply();
  } else if ( command === "synth" ) {
    synth();
  } else {
    console.error( `unknown command: ${ command } (expected "synth" or "apply")` );
    process.exitCode = 1;
  }
}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {
  main();
}
