import { ApiObject, type Chart } from "cdk8s";
import { ARGOCD_NAMESPACE, GIT_REPO_URL, GIT_TARGET_REVISION } from "./config.js";

const DESTINATION_SERVER = "https://kubernetes.default.svc";

export interface HelmApplicationProps {
    /** ArgoCD Application 名（= リソース名）。 */
    readonly name: string;
    /** インストール先 namespace。 */
    readonly namespace: string;
    /** Helm リポジトリURL、または OCI レジストリURL（`oci://...`）。 */
    readonly repoUrl: string;
    /** 通常の Helm リポジトリの場合のみ指定（OCI の場合は repoUrl にチャート名まで含まれるため省略）。 */
    readonly chart?: string;
    readonly targetRevision: string;
    readonly valuesObject?: Record<string, unknown>;
}

/** upstream の Helm チャートを source とする ArgoCD Application を生成する。 */
export function createHelmApplication(chart: Chart, id: string, props: HelmApplicationProps): ApiObject {
    const source: Record<string, unknown> = {
        repoURL: props.repoUrl,
        targetRevision: props.targetRevision,
    };
    if (props.chart !== undefined) {
        source.chart = props.chart;
    }
    if (props.valuesObject !== undefined) {
        source.helm = { valuesObject: props.valuesObject };
    }

    return new ApiObject(chart, id, {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: props.name, namespace: ARGOCD_NAMESPACE },
        spec: {
            project: "default",
            source,
            destination: {
                server: DESTINATION_SERVER,
                namespace: props.namespace,
            },
            syncPolicy: {
                automated: { prune: true, selfHeal: true },
            },
        },
    });
}

export interface GitApplicationProps {
    readonly name: string;
    readonly namespace: string;
    readonly repoUrl: string;
    readonly targetRevision: string;
    /** リポジトリ内での監視対象パス。 */
    readonly path: string;
    readonly recurse?: boolean;
}

/** 任意の git リポジトリのディレクトリを source とする ArgoCD Application を生成する。 */
export function createGitApplication(chart: Chart, id: string, props: GitApplicationProps): ApiObject {
    return new ApiObject(chart, id, {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: props.name, namespace: ARGOCD_NAMESPACE },
        spec: {
            project: "default",
            source: {
                repoURL: props.repoUrl,
                targetRevision: props.targetRevision,
                path: props.path,
                directory: { recurse: props.recurse ?? false },
            },
            destination: {
                server: DESTINATION_SERVER,
                namespace: props.namespace,
            },
            syncPolicy: {
                automated: { prune: true, selfHeal: true },
            },
        },
    });
}

export interface DirectoryApplicationProps {
    readonly name: string;
    readonly namespace: string;
    /** このリポジトリ内での監視対象パス。 */
    readonly path: string;
    readonly recurse?: boolean;
}

/** このリポジトリ自身の git ディレクトリを source とする ArgoCD Application を生成する（App-of-Apps の root 用）。 */
export function createDirectoryApplication(chart: Chart, id: string, props: DirectoryApplicationProps): ApiObject {
    return createGitApplication(chart, id, {
        name: props.name,
        namespace: props.namespace,
        repoUrl: GIT_REPO_URL,
        targetRevision: GIT_TARGET_REVISION,
        path: props.path,
        recurse: props.recurse ?? false,
    });
}
