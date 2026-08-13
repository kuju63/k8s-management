import { ApiObject, type Chart } from "cdk8s";

export function createNamespace(chart: Chart, name: string): ApiObject {
    return new ApiObject(chart, "namespace", {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name },
    });
}
