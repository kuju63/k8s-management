import { ApiObject, type Chart } from "cdk8s";
import {
  APP_TEMPLATE_TARGET_REVISION,
  buildContainerValuesObject,
  type ContainerValuesProps,
  type HelmApplicationProps,
  normalizeHelmSource,
} from "./argocd-application.js";
import { APP_TEMPLATE_REPO_URL, ARGOCD_NAMESPACE, IN_CLUSTER_SERVER } from "./config.js";

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

/** upstream Helm チャートに共通する指定。 */
interface HelmApplicationSetEntryBase
  extends Omit< HelmApplicationProps, "namespace" | "project" | "repoUrl" | "chart" > {
  /** 判別子。省略時は `"helm"`。 */
  readonly kind?: "helm";
}

/** 通常の Helm リポジトリ、または動的な URL を使用する要素。 */
interface RepositoryHelmApplicationSetEntry extends HelmApplicationSetEntryBase {
  /** Helm リポジトリ URL。 */
  readonly repoUrl: string;
  /** リポジトリ内のチャート名。 */
  readonly chart: string;
}

/** チャート名を URL 末尾から取得できる OCI Helm 要素。 */
interface OciHelmApplicationSetEntry extends HelmApplicationSetEntryBase {
  /** チャート名まで含む OCI URL。 */
  readonly repoUrl: `oci://${ string }/${ string }`;
  /** 明示的に上書きするチャート名。 */
  readonly chart?: string;
}

/**
 * `createHelmApplicationSet` の要素のうち、upstream Helm チャートを source とするもの。
 * `kind` は省略可能で、省略時は `"helm"` として扱う。
 */
export type HelmApplicationSetEntry = RepositoryHelmApplicationSetEntry | OciHelmApplicationSetEntry;

/**
 * `createHelmApplicationSet` の要素のうち、コンテナイメージから app-template チャートで
 * ワークロードを生成するもの。`createContainerApplication` と同じフィールドを受け取る。
 */
export interface ContainerApplicationSetEntry extends ContainerValuesProps {
  /** 判別子。コンテナ要素であることを示す。 */
  readonly kind: "container";
  /**
   * app-template チャート自体のバージョン。省略時は {@link APP_TEMPLATE_TARGET_REVISION}。
   * （アプリのバージョンは `image.tag` 側で指定する点に注意。）
   */
  readonly targetRevision?: string;
}

/** `createHelmApplicationSet` が生成する Application 1件分の指定。Helm / コンテナのいずれか。 */
export type ApplicationSetEntry = HelmApplicationSetEntry | ContainerApplicationSetEntry;

/**
 * @deprecated `ApplicationSetEntry`（または `HelmApplicationSetEntry`）を使用すること。
 */
export type HelmApplicationSetApplication = HelmApplicationSetEntry;

/** `createHelmApplicationSet` のプロパティ。 */
export interface HelmApplicationSetProps {
  /** ApplicationSet 名（= リソース名）。 */
  readonly name: string;
  /** すべての Application に共通するインストール先 namespace。 */
  readonly namespace: string;
  /** すべての Application を所属させる AppProject 名。省略時は `default`。 */
  readonly project?: string;
  /** List generator で生成する Application 群。Helm チャートとコンテナを混在できる。 */
  readonly applications: readonly ApplicationSetEntry[];
  /** ApplicationSet 削除時に、各 Application がデプロイしたリソースを残すか。省略時は `false`。 */
  readonly preserveResourcesOnDeletion?: boolean;
}

/** List generator の1要素。Helm・コンテナのどちらも同じ形へ正規化する。 */
interface ListElement {
  readonly name: string;
  readonly repoURL: string;
  readonly chart: string;
  readonly targetRevision: string;
  readonly valuesObject: Record< string, unknown >;
}

/**
 * 1つの要素を List generator 用の要素へ正規化する。
 * コンテナ要素は app-template チャートの Helm source として表現するため、
 * Helm 要素と同一の形（`repoURL`/`chart`/`targetRevision`/`valuesObject`）に揃う。
 */
function normalizeEntry( setName: string, entry: ApplicationSetEntry ): ListElement {
  if ( entry.kind === "container" ) {
    const source = normalizeHelmSource( APP_TEMPLATE_REPO_URL );
    if ( source.chart === undefined ) {
      throw new Error( `ApplicationSet "${ setName }" の app-template chart 名を解決できません` );
    }
    return {
      name: entry.name,
      repoURL: source.repoURL,
      chart: source.chart,
      targetRevision: entry.targetRevision ?? APP_TEMPLATE_TARGET_REVISION,
      valuesObject: buildContainerValuesObject( entry ),
    };
  }

  const source = normalizeHelmSource( entry.repoUrl, entry.chart );
  if ( source.chart === undefined ) {
    throw new Error( `Helm ApplicationSet "${ setName }" の Application "${ entry.name }" には chart が必要です` );
  }
  return {
    name: entry.name,
    repoURL: source.repoURL,
    chart: source.chart,
    targetRevision: entry.targetRevision,
    // missingkey=error を有効にしても全要素で参照でき、空オブジェクトなら with が偽になる。
    valuesObject: entry.valuesObject ?? {},
  };
}

/**
 * 複数の Application を List generator で管理する ArgoCD ApplicationSet を生成する。
 * upstream Helm チャート（`kind: "helm"` または省略）と、コンテナイメージから
 * app-template で生成するワークロード（`kind: "container"`）を混在できる。
 * Application ごとの `valuesObject` は Go template の `templatePatch` で型を保ったまま反映する。
 */
export function createHelmApplicationSet( chart: Chart, id: string, props: HelmApplicationSetProps ): ApiObject {
  const elements = props.applications.map( ( entry ) => normalizeEntry( props.name, entry ) );

  const applicationSetProps: ApplicationSetProps = {
    name: props.name,
    goTemplate: true,
    goTemplateOptions: [ "missingkey=error" ],
    generators: [ { list: { elements } } ],
    template: {
      metadata: { name: "{{ .name }}", namespace: "{{ .namespace }}" },
      spec: {
        project: props.project ?? "default",
        source: {
          repoURL: "{{ .repoURL }}",
          chart: "{{ .chart }}",
          targetRevision: "{{ .targetRevision }}",
        },
        destination: {
          server: IN_CLUSTER_SERVER,
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
