import { ApiObject, type Chart } from "cdk8s";

/**
 * 生成されるConfigMapの情報
 */
export interface ConfigMapInfo {
  /** 名称 */
  readonly name: string;
  /** namespace */
  readonly namespace: string;
  /** データ */
  readonly data: Record< string, string >;
}

/**
 * ConfigMapのリソースを生成する
 *
 * @param chart `this`
 * @param name ConfigMapの名称
 * @param namespace namespace
 * @param data ConfigMapに格納するデータ
 * @returns 生成されたConfigMapの情報
 *
 * @example
 * ```typescript
 * createConfigMap(this, "configmap-example", "app-config", NAMESPACE, {
 *  LOG_LEVEL: "info",
 *  FEATURE_FLAG_X: "true"
 * })
 * ```
 */
export function createConfigMap(
  chart: Chart,
  name: string,
  namespace: string,
  data: Record< string, string >,
): ConfigMapInfo {
  new ApiObject( chart, name, {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name, namespace },
    data,
  } );
  return {
    name,
    namespace,
    data,
  };
}
