import { createHelmApplication } from "../../lib/argocd-application.js";

export function build( chart ) {
  createHelmApplication( chart, "argocd-application-example", {
    name: "example",
    namespace: "example",
    repoUrl: "https://example.github.io/charts",
    chart: "example-chart",
    targetRevision: "1.2.3",
  } );
}
