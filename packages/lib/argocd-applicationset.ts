import { ApiObject, type Chart } from "cdk8s";
import { normalizeHelmSource, type HelmApplicationProps } from "./argocd-application.js";
import { ARGOCD_NAMESPACE } from "./config.js";

const DESTINATION_SERVER = "https://kubernetes.default.svc";

/** `createApplicationSet` のプロパティ。 */
export interface ApplicationSetProps {
  /** ApplicationSet 名（= リソース名）。 */
  readonly name: string;
  /** Application のパラメータを生成する generator 群。 */
  readonly generators: readonly Record< string, unknown >[];
  /** generator のパラメータから生成する Application のテンプレート。 */
  readonly template: Record< string, unknown >;
  /** Go template を有効にするか。省略時は ApplicationSet 側のデフォルトに従う。 */
  readonly goTemplate?: boolean;
  /** Go template のオプション（例: `[ "missingkey=error" ]`）。 */
  readonly goTemplateOptions?: readonly string[];
  /** 文字列以外のフィールドを動的に変更するための YAML/JSON パッチ。 */
  readonly templatePatch?: string;
  /** ApplicationSet 削除時に、生成 Application がデプロイしたリソースを残すか。省略時は `false`。 */
  readonly preserveResourcesOnDeletion?: boolean;
}

/** 任意の generator と template から ArgoCD ApplicationSet を生成する。 */
export function createApplicationSet( chart: Chart, id: string, props: ApplicationSetProps ): ApiObject {
  const spec: Record< string, unknown > = {
    generators: props.generators,
    template: props.template,
  };

  if ( props.goTemplate !== undefined ) {
    spec.goTemplate = props.goTemplate;
  }
  if ( props.goTemplateOptions !== undefined ) {
    spec.goTemplateOptions = props.goTemplateOptions;
  }
  if ( props.templatePatch !== undefined ) {
    spec.templatePatch = props.templatePatch;
  }
  if ( props.preserveResourcesOnDeletion !== undefined ) {
    spec.syncPolicy = { preserveResourcesOnDeletion: props.preserveResourcesOnDeletion };
  }

  return new ApiObject( chart, id, {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "ApplicationSet",
    metadata: { name: props.name, namespace: ARGOCD_NAMESPACE },
    spec,
  } );
}

/** `createHelmApplicationSet` が生成する Application 1件分の指定。 */
export type HelmApplicationSetApplication = Omit< HelmApplicationProps, "namespace" >;

/** `createHelmApplicationSet` のプロパティ。 */
export interface HelmApplicationSetProps {
  /** ApplicationSet 名（= リソース名）。 */
  readonly name: string;
  /** すべての Application に共通するインストール先 namespace。 */
  readonly namespace: string;
  /** List generator で生成する Helm Application 群。 */
  readonly applications: readonly HelmApplicationSetApplication[];
  /** ApplicationSet 削除時に、各 Application がデプロイしたリソースを残すか。省略時は `false`。 */
  readonly preserveResourcesOnDeletion?: boolean;
}

/**
 * 複数の upstream Helm チャートを List generator で管理する ArgoCD ApplicationSet を生成する。
 * Application ごとの `valuesObject` は Go template の `templatePatch` で型を保ったまま反映する。
 */
export function createHelmApplicationSet( chart: Chart, id: string, props: HelmApplicationSetProps ): ApiObject {
  const elements = props.applications.map( ( application ) => {
    const source = normalizeHelmSource( application.repoUrl, application.chart );
    if ( source.chart === undefined ) {
      throw new Error(
        `Helm ApplicationSet "${ props.name }" の Application "${ application.name }" には chart が必要です`,
      );
    }

    return {
      name: application.name,
      repoURL: source.repoURL,
      chart: source.chart,
      targetRevision: application.targetRevision,
      // missingkey=error を有効にしても全要素で参照でき、空オブジェクトなら with が偽になる。
      valuesObject: application.valuesObject ?? {},
    };
  } );

  const applicationSetProps: ApplicationSetProps = {
    name: props.name,
    goTemplate: true,
    goTemplateOptions: [ "missingkey=error" ],
    generators: [ { list: { elements } } ],
    template: {
      metadata: { name: "{{ .name }}" },
      spec: {
        project: "default",
        source: {
          repoURL: "{{ .repoURL }}",
          chart: "{{ .chart }}",
          targetRevision: "{{ .targetRevision }}",
        },
        destination: {
          server: DESTINATION_SERVER,
          namespace: props.namespace,
        },
        syncPolicy: {
          automated: { prune: true, selfHeal: true },
          // 大きな CRD で last-applied-configuration annotation の 256 KiB 上限を超えないようにする。
          syncOptions: [ "ServerSideApply=true" ],
        },
      },
    },
    templatePatch: `{{- with .valuesObject }}
spec:
  source:
    helm:
      valuesObject:
{{ . | toYaml | nindent 8 }}
{{- end }}`,
    ...( props.preserveResourcesOnDeletion === undefined
      ? {}
      : { preserveResourcesOnDeletion: props.preserveResourcesOnDeletion } ),
  };

  return createApplicationSet( chart, id, applicationSetProps );
}
