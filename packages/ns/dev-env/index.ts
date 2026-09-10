import { type App, Chart } from "cdk8s";
import { createHelmApplicationSet } from "../../lib/argocd-applicationset.js";
import { createAppProject } from "../../lib/argocd-project.js";
import { IN_CLUSTER_SERVER, NFS_SERVER_ADDRESS, NFS_SHARE_PATH } from "../../lib/config.js";
import { createNamespace } from "../../lib/namespace.js";
import { createSealedSecret } from "../../lib/sealed-secret.js";

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

    // JFrog Artifactのsecret
    const artifactSecret = createSealedSecret( this, {
      name: "jfrog-artifact-secret",
      namespace: NAMESPACE,
      encryptedData: {
        "master-key":
          "AgCHU/XZLBPWGlNafca7YK1LE9ykRGwAHgJm4z56KdBkciDG9CnI6LJH1Ra0SijWjCquY3tgfW9r3PXzvXXfihZSzvPUexu4annK1P2QFRTgOqSuiYpmDrwiMBA9CVK/NOo3OITg+vCJI4sZf1OgLOkdx1UGSkRPix9hVjdGi3B2ZyjN6KwSRVfFhTZiIgSYktSkqR1xw4oKKfm30JkBhC6j+wghYdi1avoJtjnx6D3nhK9pWF9/pB40lj9sjbIdR0/6Jyd1xlGLbrryu2a0a7uwL9BiXD9QqSls8pgE891DMKTSUYgeS0vzr/blQA3dAwAlpbGT1sEE6nVFvDPEUJ0Yw9bINF+cDLV9woPhcNiqGd1ck/nZLbAHdXPVbHsADIAgyfxB7Pzwq4LQOY709gX1Xa41ogbpfg2TyrRF8GROBJg902SfjAsjSpWVMYZH7OFlldnh1abNVndrGq+SJ4zMVKi0FwX3z9QOgNazksyt5hlsViCoRwxWaXr2P9xa2iiEx07v2z3hcc57pVOuMZSPd6zi0lKi+r5yFg/YleBIpOsEIWaMvgE0qA+4O1TWnZKCZ5v0zMqjMKUl/zR0RT3PNCqrstCmlRrHeoRPHRm+sya2T9GD1r9sXAlC4sa8vx/rQtW3F4sVbVqK+F9nXGTk5SXZuEyLvAnQHMkoNrkErcfMZiP87QuTCQ0SBppGevlxHbja8jQ3tJluDnhyHA0yQRDmUTSWZ6K4rvp6E/R0+PQh2uSiYv4umyNcHtvU4DQrL8rnoY+NwsHsuaIO0Gai",
        "join-key":
          "AgAjqUvMpCzZPilu+fQy64nVEJxQPgb2KRVAIwSUu7W3gUD0a+1GLP5S7ZaI+cpKUZSB20UP7gxqMw1XkaWBoSMifoiKjlOkzbBh/HkjTcyw+K2ewL4dryCU8Nh5iJLEjm2isg5U3/RjgsvlxRNvoE+IqzSrPhpyGkYfXeSVAIvi7DmTHOcVfmCkRuNHvNXxJjTiVZAlxDVViaBYDisdCy9tq6yQdFeC1phLVxhWt0S2RRTcRse9qqofK0hv2ZSAYU4/B+PYVTPg/n1oKjnZfIRem3ixMfsrKXQ63F6cjLnKAMWtdUweYwDf13pzpKKFZNRszVc/W4sBaoViSH1pv+DbXVnvEssTDLVSavNfl+n1cC6Ud+05C1BIrYYXwS2JzvW7qPI5aA0KefPY3zETUu2BH1P1HTNPST/oP2SOwClfLyxsoVvQPgkoXje4PrrqbvFd7NJha5xjpm22yd1HLs1OJeivoJJcGE2vT52cqak2LOFDMblAJ+8LKV+yIkjIRPOc5eihe6HvgLS/AfeVYr4kR02nHHQMOUDFRWTyvk1/I1lC4EBzDBBeq0osaEeGUD07gDocdt8l8h9Tir6BW9mfzxrYAbyQ169jnJU7wjuMtQmE5hE/JVq27DiGlhWVgMdh+3ysWibFCXCRbdVNWkAS7iUc68jJxxZGubgtX00sBofh+Quh/aoNptyOqMA4LsFffU/6vmSkWNQi4NIMM4pH4h5gZX9BWL0wOSPmCenJ6uHbRVroXN6wnEeRlaCCgHxKJCQaY5lO2ILyRBsN81O1",
      },
    } );

    // JFrog Container Registryのsecret
    const crSecret = createSealedSecret( this, {
      name: "jfrog-cr-secret",
      namespace: NAMESPACE,
      encryptedData: {
        "join-key":
          "AgAmWbjNZLUAfLmPg09nKKoyUtYvfYVlsRwjP4kiHZP/aajCSdAwNTRz3bku3Ywm3eieMaQYHIQZGdgVTya4WGP7lksJNQ+MAk2TcFvZ/lFyYuAzckhb+Y1q3AMNvqyKMMqBC8omMsRpkLqAGPoVn46m9mp/31xrF5uLcbW8VNZU7dPOK7h4YwPj4D7si1IyLQCUDhFt/1J0naF/WpFN6sPKgSEIBmEUWPY4XLlYNlyzODqGZAF/sjM1KcepkG1TM25ShHpLcgxLNQx9/CIk0u3uy+31IdYA/WnJ3OJVra4f3oaFrTOTFm+A2HZIX+UIdn07Eo0D6ZaRFxxD6fXps8tcGPgBWMHljrSexzb35aj9OojsBDYJWYrydkMWQG+YQlK/7VUWIJ7PyFzqX1xM50jdIv+bOc2jpA+MhN3mRWh93Y0V0nxCjER4swmnTCCRxavouF0fJENhI1Fbl6IaTlTTeH0JA7Svc7jpzlDPjPDaiQx+BCyGkM3SM6uKadz1Y725A27Pp0EY6HzXzygs8nfHV9kv/fX1rRYqsCMcGPnpUX6vc+xjBijqY677dA+n0mGPi5hZP9bHqgAlLs/w4Yx3581LQPZQudR2eBBD6aXsUJZJThVm9BVf9PkWC7bYK5A7bafIVTG5QFEC3Jfpc2TilnXAOWY/Z+KNoUZTMIT5tz2okEMTMw/o9llVrnptsgjtvIVPc9GmLUionhQK/llIBcXEocKlDf57ciWYkMP7c09KVPVgySDaHC/HPevAwURYgJ5Bt7dbmziJCRvVVrDp",
        "master-key":
          "AgBbMv9RG4klIBN8TpU5ou/SusepvBJxVxqy6ezykYd6fmf53gLQvwWhfbT/kh+q6VFRmLjqeBpPDmZtafBuEFuDjG2n5bQk3YB8BgOBBrXxGfjBs7oyl60Z1mRAzJrHe5L7jJp8NVVpg6N6E9rjAUnMsJ2wmIFQvbwM5mBETHZyy1ef21wC8m08v+gWM+1T9SKk+OPnyNapqjZjzshi1GyPOOYQTCVgawUlPGql7p4sf9qJoJvGlyKCerJYose036VLq8/rEvKyRC9ohVRfHBJPfhl/vvtUdz7lf7dq1Ii6/vLDWvFYeaYGpTVzfji69f9j0BGVoJkQBv0yxnhgX3/rDmULjoP7yHEUc/E3iFqbd3SmoJNuXr5ovEy8fzOl5U13Qcd3okTBV9pHBJ35gRU0aKoklcMWDCHSjGbrWlz7S9asCZopRoB7MGn9/Telwn7yy+4GoYD4qyfYMEaq/xnRuq5HNpkDp3T5RCSZiNA64VT5rmNKI3FobgA/6+yFXKYBzkiqVdgL4k55bIv46s1t79+L/IBTqI6y4nD53G6MB5Lii7VmqZEgqZVjgMFWFrhHf2sCQdEo9sBy2TIWhmC01cHP58aWtKffoAOSqotZbuDfe2fKRJCCACtOljaX2IIjxAXXImX2qaC1cnFiDogFUIoiLQnPe2dugScoUyLKOTRryowi/T2hmvQObmZsouNBrp9zR1bQ7dyUSUTu6vK5aVnfA8JnXgMm+nOwMOrAVUnSR3yutOuS4vEdL2Xa/RrFpP64dfT+ee8HN3+tl1i1",
      },
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
              global: {
                masterKeySecretName: crSecret.name,
                joinKeySecretName: crSecret.name,
              },
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
            global: {
              masterKeySecretName: artifactSecret.name,
              joinKeySecretName: artifactSecret.name,
            },
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
              nginx: {
                https: {
                  enabled: false,
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
