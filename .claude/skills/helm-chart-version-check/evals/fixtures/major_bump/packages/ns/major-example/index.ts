import { createHelmApplication } from "../../lib/argocd-application.js";

export function build( chart ) {
  createHelmApplication( chart, "argocd-application-major-example", {
    name: "major-example",
    namespace: "major-example",
    repoUrl: "https://major-example.github.io/charts",
    chart: "major-chart",
    targetRevision: "2.5.1",
  } );
}
