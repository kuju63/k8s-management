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
        "join-key":
          "AgBjrec6ba01Lgyb2hYTMbipyIdef6PWU0OTJ83wSEXvDVzr8boYpruZh0Wn9XNcjqRkWPZPVcs0eSNhVg4p2kxayMZsHTlQgsmQsb4bnuR1CCID/c+X/h5YgxP/b2EejtDATW4Yq9fnHKDa/RM04SvxYAiR/T4o2Xpt/W+FB18qIfeWWpnD/rLdkPD6ffi7CDxSNhecY8JZENnG2cduFe1dRNB3yvxZtNnVnJNW/mUgQovrgO7exZTVCF/Wf4YjSOuYPzK+f/wtQUNi7GI6WgOW/bH02L5ih3DEeCxcjiESROVK6kAprj/uJh2Hyl967i0UEy3WhQi7mLcubVr1oNWnh261ojSaDTz0BuylsT6SfqzdtHPT+z7qGU9hIPYhBHuYYpHtZpvFOwZr9oJmE2pvTyZShQ7CmYwX9tkUjtlscKHvOUILBKMkSfpBZ4Qn5J/zKy82/YTqK7clFxilLLNv1WPLC/IWXkdov0zFuzLjYCVba3qDHGW02ncrSNS0asYESaQocjudl90p9GI6CwKHHCxsvAc2TZ2F7WGCjAgUfIQeEr0falLDq8VF3lwyFtB7cuwpSm6V4fZn1HFXhwh8jhAm3Ph3YDafnVucA4r/Yh6fSLqax790sGBVuhljCqx2q8kvuw4fxo8Cj7eHTs62IGMDHSKuysESxS5pFIlSKnw0lqs4HqGQbqcBZMOtHg+KqrNexaCS1DjXbJwWFmCQfiPwBZtsgypBfJoSysFpH488/ZMMs7OHmV9bImHl9nfBiL27vdclB1O3DvHEMbgC",
        "master-key":
          "AgCFPzzp6cx0LIs1YhOpBhom38MPdVbddJ6LoFkQssZaB6b1aJ5bzJoPLpRuVSYaAhJ6zU+1GRweVv4oP6iHvBLD1QRleV+6kgAgsutoB0M5zNjDa+cltKq0inDde8YDynhzrjMXWuqfn40EkCvfcCY7RYvj2FGSpE4nFtBZBL/dCHZ3mwo/Dcu0xwVjxSv9Ck8YUrgrODPiAM22i6PtXIeJDKCnHFeMgR0XFylAbkI3ZfUD8LIVr/hdvyqH5FRXGdPVmtKeBZU2OlEbG5+uyfLsTww4SQ0Ix5nVDkDJcJgajCk+dMlrgspcyxm//gR8xsCa1AIIUfDOVzsfGIF53i4mmZXypj/ygfrqezbQZfBHhKUfQibGkQYBLni09qubnF+8V9yLMZtocgL7J/uLIXWSJeVNKvommG70nsQNpORQMIdUZYiVEEEgxVdJhtAJqLpL4Qwn5fwuTqY3mEjeEGOC04JJkCmLsrCcic+JhR25QTsGUcd81cko/NpHZ3dWK0ABUiI3r3Tsu6vNb38V7RjRkpsxZZaaqwr/R1OnFNRIKFS5tjtNH5GzgddikJnnRTW79V33+1A79KCfRDpZ1azGPh/ZL8xky6BNZCjhQJsz/xSF6ygI/orHiL30wncpuwKkBapkKZ+i0bXGyXvXROM3in5V9nQGtw7zbQGRUQQ9eR+B9Z+n3ihhTdC2BCbPCgs9fgyQvYZjMbAQSYTowT1Ap//94A5hqp5GmaBFwGhUwpCZP3PuxkufIZhDpyNUUG7iHvj4g+bEoDLv06uZGRDk",
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
          targetRevision: "107.161.24",
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
          targetRevision: "107.161.24",
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
