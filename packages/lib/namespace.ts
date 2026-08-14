import { ApiObject, type Chart } from "cdk8s";

/** 指定した名前の Namespace リソースを生成する。 */
export function createNamespace(chart: Chart, name: string): ApiObject {
    return new ApiObject(chart, "namespace", {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name },
    });
}
