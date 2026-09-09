import { type App, Chart } from "cdk8s";
import { createHelmApplicationSet } from "../../lib/argocd-applicationset.js";
import { createAppProject } from "../../lib/argocd-project.js";
import { IN_CLUSTER_SERVER, NFS_SERVER_ADDRESS, NFS_SHARE_PATH } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";

const NAMESPACE = "dev-env";
const PROJECT_NAME = "dev-env";

/**
 * 開発環境基盤のChart
 *
 * 現在整備されているもの
 *
 * - Container Registory
 */
export class DevEnvChart extends Chart {
  constructor( scope: App ) {
    super( scope, NAMESPACE );

    createNamespace( this, NAMESPACE );
    createAppProject( this, "dev-env", {
      name: PROJECT_NAME,
      sourceNamespaces: [ NAMESPACE ],
      sourceRepos: [ "ghcr.io/bjw-s-labs/helm", "https://charts.jfrog.io" ],
      destinations: [
        {
          server: IN_CLUSTER_SERVER,
          namespace: NAMESPACE,
        },
      ],
      // NFS永続化(persistence.type: nfs)がcluster-scopeのPersistentVolumeを生成するため許可
      clusterResourceWhitelist: [ { group: "", kind: "PersistentVolume" } ],
    } );

    createHelmApplicationSet( this, "jfrog", {
      name: "jfrog",
      namespace: NAMESPACE,
      project: PROJECT_NAME,
      applications: [
        {
          kind: "helm",
          name: "jfrog-cr",
          repoUrl: "https://charts.jfrog.io",
          chart: "artifactory-jcr",
          targetRevision: "107.161.26",
          valuesObject: {
            artifactory: {
              persistance: {
                type: "nfs",
                nfs: {
                  ip: NFS_SERVER_ADDRESS,
                  haDataMount: `${ NFS_SHARE_PATH }/{NAMESPACE}/jfrog-cr/data`,
                  haBackupMount: `${ NFS_SHARE_PATH }/{NAMESPACE}/jfrog-cr/backup`,
                  capacity: "200Gi",
                },
              },
            },
          },
        },
        {
          kind: "helm",
          name: "jfrog-artifactry",
          repoUrl: "https://charts.jfrog.io",
          chart: "artifactory-oss",
          targetRevision: "107.161.26",
          valuesObject: {
            artifactory: {
              persistance: {
                type: "nfs",
                nfs: {
                  ip: NFS_SERVER_ADDRESS,
                  haDataMount: `${ NFS_SHARE_PATH }/{NAMESPACE}/jfrog-artifactry/data`,
                  haBackupMount: `${ NFS_SHARE_PATH }/{NAMESPACE}/jfrog-artifactry/backup`,
                  capacity: "200Gi",
                },
              },
            },
          },
        },
      ],
    } );

    // Docker registoryのHTTPでの公開
    // createHTTPRoute( this, {
    //   name: "registory-route",
    //   namespace: NAMESPACE,
    //   hostnames: [ REGISTORY_HOST ],
    //   backendRefs: [ { name: "registory", port: 5000 } ],
    // } );
  }
}
