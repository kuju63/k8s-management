import { type App, Chart } from "cdk8s";
import { createAppProject } from "../../lib/argocd-project.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "ai-base";

/**
 * ns: ai-base
 *
 * AI関連システムの基盤システム
 */
export class AIBaseSystemChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );
    createAppProject( this, "ai-base", {
      name: "ai-base",
      description: "AIアプリ開発基盤",
      sourceRepos: [],
      destinations: [
        {
          server: "https://kubernetes.default.svc",
          namespace: NAMESPACE,
        },
      ],
      clusterResourceWhitelist: [ { group: "*", kind: "*" } ],
    } );
  }
}
