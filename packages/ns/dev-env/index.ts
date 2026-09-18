import { type App, Chart } from "cdk8s";
import { createContainerApplication, createHelmApplication } from "../../lib/argocd-application.js";
import { createHelmApplicationSet } from "../../lib/argocd-applicationset.js";
import { createAppProject } from "../../lib/argocd-project.js";
import { CLUSTER_DOMAIN, IN_CLUSTER_SERVER } from "../../lib/config.js";
import { createHTTPRoute } from "../../lib/gateway-api.js";
import { createNamespace } from "../../lib/namespace.js";
import { createSealedSecret } from "../../lib/sealed-secret.js";
import { NFS_STORAGE_CLASS_NAME, nfsPersistence } from "../../lib/storage.js";

const NAMESPACE = "dev-env";
const PROJECT_NAME = "dev-env";

const FORGEJO_RELEASE = "forgejo";
const FORGEJO_POSTGRES_RELEASE = "forgejo-postgresql";
const FORGEJO_DB_SECRET = "forgejo-db-secret";
const FORGEJO_ADMIN_SECRET = "forgejo-admin-secret";

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
      sourceRepos: [
        "ghcr.io/bjw-s-labs/helm",
        "https://charts.jfrog.io",
        // Forgejo 公式 OCI チャート。normalizeHelmSource が `oci://` を除去したレジストリパスへ正規化するためこの形式。
        "code.forgejo.org/forgejo-helm",
      ],
      destinations: [
        {
          server: IN_CLUSTER_SERVER,
          namespace: NAMESPACE,
        },
      ],
      // NFS永続化(persistence.storageClassName: nfs)がcluster-scopeのPersistentVolumeを生成するため許可
      clusterResourceWhitelist: [ { group: "", kind: "PersistentVolume" } ],
    } );

    // JFrog Artifactのsecret。join-key/master-keyに加え、postgresql(jfrog-artifactry-postgresql)の
    // DB認証情報(password/postgres-password)も同居させる。existingSecretで固定することで、
    // StatefulSet/PVC再作成のたびにchart側がランダムパスワードを再生成し、DB内の実パスワードと
    // Secretの値がずれる事故を防ぐ。
    const artifactSecret = createSealedSecret( this, {
      name: "jfrog-artifact-secret",
      namespace: NAMESPACE,
      encryptedData: {
        "join-key":
          "AgBjrec6ba01Lgyb2hYTMbipyIdef6PWU0OTJ83wSEXvDVzr8boYpruZh0Wn9XNcjqRkWPZPVcs0eSNhVg4p2kxayMZsHTlQgsmQsb4bnuR1CCID/c+X/h5YgxP/b2EejtDATW4Yq9fnHKDa/RM04SvxYAiR/T4o2Xpt/W+FB18qIfeWWpnD/rLdkPD6ffi7CDxSNhecY8JZENnG2cduFe1dRNB3yvxZtNnVnJNW/mUgQovrgO7exZTVCF/Wf4YjSOuYPzK+f/wtQUNi7GI6WgOW/bH02L5ih3DEeCxcjiESROVK6kAprj/uJh2Hyl967i0UEy3WhQi7mLcubVr1oNWnh261ojSaDTz0BuylsT6SfqzdtHPT+z7qGU9hIPYhBHuYYpHtZpvFOwZr9oJmE2pvTyZShQ7CmYwX9tkUjtlscKHvOUILBKMkSfpBZ4Qn5J/zKy82/YTqK7clFxilLLNv1WPLC/IWXkdov0zFuzLjYCVba3qDHGW02ncrSNS0asYESaQocjudl90p9GI6CwKHHCxsvAc2TZ2F7WGCjAgUfIQeEr0falLDq8VF3lwyFtB7cuwpSm6V4fZn1HFXhwh8jhAm3Ph3YDafnVucA4r/Yh6fSLqax790sGBVuhljCqx2q8kvuw4fxo8Cj7eHTs62IGMDHSKuysESxS5pFIlSKnw0lqs4HqGQbqcBZMOtHg+KqrNexaCS1DjXbJwWFmCQfiPwBZtsgypBfJoSysFpH488/ZMMs7OHmV9bImHl9nfBiL27vdclB1O3DvHEMbgC",
        "master-key":
          "AgCFPzzp6cx0LIs1YhOpBhom38MPdVbddJ6LoFkQssZaB6b1aJ5bzJoPLpRuVSYaAhJ6zU+1GRweVv4oP6iHvBLD1QRleV+6kgAgsutoB0M5zNjDa+cltKq0inDde8YDynhzrjMXWuqfn40EkCvfcCY7RYvj2FGSpE4nFtBZBL/dCHZ3mwo/Dcu0xwVjxSv9Ck8YUrgrODPiAM22i6PtXIeJDKCnHFeMgR0XFylAbkI3ZfUD8LIVr/hdvyqH5FRXGdPVmtKeBZU2OlEbG5+uyfLsTww4SQ0Ix5nVDkDJcJgajCk+dMlrgspcyxm//gR8xsCa1AIIUfDOVzsfGIF53i4mmZXypj/ygfrqezbQZfBHhKUfQibGkQYBLni09qubnF+8V9yLMZtocgL7J/uLIXWSJeVNKvommG70nsQNpORQMIdUZYiVEEEgxVdJhtAJqLpL4Qwn5fwuTqY3mEjeEGOC04JJkCmLsrCcic+JhR25QTsGUcd81cko/NpHZ3dWK0ABUiI3r3Tsu6vNb38V7RjRkpsxZZaaqwr/R1OnFNRIKFS5tjtNH5GzgddikJnnRTW79V33+1A79KCfRDpZ1azGPh/ZL8xky6BNZCjhQJsz/xSF6ygI/orHiL30wncpuwKkBapkKZ+i0bXGyXvXROM3in5V9nQGtw7zbQGRUQQ9eR+B9Z+n3ihhTdC2BCbPCgs9fgyQvYZjMbAQSYTowT1Ap//94A5hqp5GmaBFwGhUwpCZP3PuxkufIZhDpyNUUG7iHvj4g+bEoDLv06uZGRDk",
        password:
          "AgB4vYnmSNWAsZpSP5SATtdKnwUDWfu5cwA64+EQIAj2vf7PvpqsgEiSHe6r9lOPW2rXXOQ6ZO23j74beIvxJCF7Y2FhqEK+IeCaAyyNKDhPwibWGg3hXnWsKMXRltt65IlUTEVWef8AthHBm0M7hKYjwfgnsthE70wiAtapoeM5LBdTbR8nNuRkDcNW9SfTNZIEIpM6mLc7hQz+BSmCvn4LM0sLA9CPLovSqKNeUWE0A9odUClsWrXbuXawLaqk6lSWatdas4HgCIia8/xHtgJncScOSdk/4dwZXpJ3KKtMntb+/b9Buj7AXuOugagUW7BtrszUvWBi48ZAN4yc7o99BPqpO1V2sGmfozUWuZhojAANuCrimefzjhtan/Jl7hj0nUHdXVxCLWwct/Cnszx84y6zTMeaHYY7P58naLznIuQIqc1TA4gdQ0MsnEOHbwfHphYbJXhxadhB3dl+zOLnLJRbk/5PalmRS5mlKNki9UjX/i2GTsIuWkc/NL1BpeEjmnYxxvsu2o/qjGkaxw0FmlcaBDQSVrE75sDydVFWesJv4IU8HMcl9YkEdWAOXppJt/XvVCHPo5arhU822zhSzsy4LWTbLdL8WYE7tqNPZlTgnfeneA7wYB7r7Yhoqpx7Uym6nfrnqcow8bONCS+4SNeom0AFMLsZIbhVUdsi7yZSazx54wtR1HmBKiCS3xaiLIuSHbnwQ8OxDJ4G5HGtyKe6GnNB489bgjb+5K86",
        "postgres-password":
          "AgBU7C3b2w80CPkQUist2gMTgeuPARXcAjVCl3lZNQaNGoNYqrT2lCxsMk+Twc5ijHt9hehvjk/uRZYTDwQoJeeUL1EaAo7/DTzU+4DeoN371zxnasDDKDfOfXWOyXeYF+bumwOuRW2g74hLG/u+JHcOx8Da/Ju7raJDpmKiy56i0bmSM7WhLroEqvYkAvl5WU1Ue56g+RP6m2kWIdvuYWWcovY8yYXzia2CkJx1tvnxELTpAv/zaOInKTEZIHeRqT7B3mQDvUimx2mnAJRTZj/u2bLw62QNCW4EQaZfT2+Vnn5468K5j/BIPwOVJuvsdFm991bDq/qiz426MS2y2iZmi+ulfMAtD7oRrv6zHcaUo1TMFKOWYkWCHbRMElFijbZU5jCDwpvOJyCHd7xC8230RhNGS/hy/mX6YZBhG1W+tkIfE/mwnKH20pAf1/Q1nqKumBQlvDAdRv0q2MAFNiqv7ZjnN0ospFc1OIMtaVfQQ3pTxhTlDIZd5OQijV8S0ln6WQn8vbpQQDO8HYQjLkv1LFHZFFwu8HLcgyN6pJF1xzftyszEiMnK9vIwXJi4dUELTwbVFgMWuns/qAamKZHGcd7xxBEQvbmf2qQz23vBiD7mdcdDMExI2xGWblbkjC/ygJAlauqEviJXcXidudTtRS42MjJy27bFUqHI+GAxE+n7skGTTtbdb5KvrxauhCSPT8QgYCOongnPIxtfEbS6WmkoomC7NsVGaXgM2nA3",
      },
    } );

    // JFrog Container Registryのsecret。join-key/master-keyに加え、postgresqlのDB認証情報
    // (password/postgres-password)も同居させる。理由はartifactSecretのコメントを参照。
    const crSecret = createSealedSecret( this, {
      name: "jfrog-cr-secret",
      namespace: NAMESPACE,
      encryptedData: {
        "join-key":
          "AgAmWbjNZLUAfLmPg09nKKoyUtYvfYVlsRwjP4kiHZP/aajCSdAwNTRz3bku3Ywm3eieMaQYHIQZGdgVTya4WGP7lksJNQ+MAk2TcFvZ/lFyYuAzckhb+Y1q3AMNvqyKMMqBC8omMsRpkLqAGPoVn46m9mp/31xrF5uLcbW8VNZU7dPOK7h4YwPj4D7si1IyLQCUDhFt/1J0naF/WpFN6sPKgSEIBmEUWPY4XLlYNlyzODqGZAF/sjM1KcepkG1TM25ShHpLcgxLNQx9/CIk0u3uy+31IdYA/WnJ3OJVra4f3oaFrTOTFm+A2HZIX+UIdn07Eo0D6ZaRFxxD6fXps8tcGPgBWMHljrSexzb35aj9OojsBDYJWYrydkMWQG+YQlK/7VUWIJ7PyFzqX1xM50jdIv+bOc2jpA+MhN3mRWh93Y0V0nxCjER4swmnTCCRxavouF0fJENhI1Fbl6IaTlTTeH0JA7Svc7jpzlDPjPDaiQx+BCyGkM3SM6uKadz1Y725A27Pp0EY6HzXzygs8nfHV9kv/fX1rRYqsCMcGPnpUX6vc+xjBijqY677dA+n0mGPi5hZP9bHqgAlLs/w4Yx3581LQPZQudR2eBBD6aXsUJZJThVm9BVf9PkWC7bYK5A7bafIVTG5QFEC3Jfpc2TilnXAOWY/Z+KNoUZTMIT5tz2okEMTMw/o9llVrnptsgjtvIVPc9GmLUionhQK/llIBcXEocKlDf57ciWYkMP7c09KVPVgySDaHC/HPevAwURYgJ5Bt7dbmziJCRvVVrDp",
        "master-key":
          "AgBbMv9RG4klIBN8TpU5ou/SusepvBJxVxqy6ezykYd6fmf53gLQvwWhfbT/kh+q6VFRmLjqeBpPDmZtafBuEFuDjG2n5bQk3YB8BgOBBrXxGfjBs7oyl60Z1mRAzJrHe5L7jJp8NVVpg6N6E9rjAUnMsJ2wmIFQvbwM5mBETHZyy1ef21wC8m08v+gWM+1T9SKk+OPnyNapqjZjzshi1GyPOOYQTCVgawUlPGql7p4sf9qJoJvGlyKCerJYose036VLq8/rEvKyRC9ohVRfHBJPfhl/vvtUdz7lf7dq1Ii6/vLDWvFYeaYGpTVzfji69f9j0BGVoJkQBv0yxnhgX3/rDmULjoP7yHEUc/E3iFqbd3SmoJNuXr5ovEy8fzOl5U13Qcd3okTBV9pHBJ35gRU0aKoklcMWDCHSjGbrWlz7S9asCZopRoB7MGn9/Telwn7yy+4GoYD4qyfYMEaq/xnRuq5HNpkDp3T5RCSZiNA64VT5rmNKI3FobgA/6+yFXKYBzkiqVdgL4k55bIv46s1t79+L/IBTqI6y4nD53G6MB5Lii7VmqZEgqZVjgMFWFrhHf2sCQdEo9sBy2TIWhmC01cHP58aWtKffoAOSqotZbuDfe2fKRJCCACtOljaX2IIjxAXXImX2qaC1cnFiDogFUIoiLQnPe2dugScoUyLKOTRryowi/T2hmvQObmZsouNBrp9zR1bQ7dyUSUTu6vK5aVnfA8JnXgMm+nOwMOrAVUnSR3yutOuS4vEdL2Xa/RrFpP64dfT+ee8HN3+tl1i1",
        password:
          "AgB1BXA+IcI03lrzqPQPGFKEJIdvNHr+furpqffzbBtj+pddHmgnmq8fIhL5HSWoxiCc7qihkBEcMZXr1SZJ9r7F1LWRmbM/Ssw5ZvIdl/r4+oFb23TqT8qinXHnmVPUWRb7SWwsozVIAIT75FML9xaZxo1fixqS/Zv8sO8pqY9Da08E6KpzDz+jRZa2t5sYbQcZheWUQH6m7DUk0bTvHrO0KRmRdScUkjKD6iAbKnAHay0yMSK9sKmFZ5jevvV3SlMShEbgOxzq388arYbWu0+ZBTp0XxyCdLjYSNxU3XMVYe1dqNDQm0fE+bWzsFAa7jgfFunFu1G1cD4BYY0vpLzO6QT/Ib2fV/bbEU1DgUqQUzPbFMRhhPpsCforXz95I3Bxwyfp69wVd7rki9ds44b1ovjGY1wMtqICdM7w1J8O4cD4oLJLHGTnHRq9J/6nGUGT0x1fK3OyD/RHvewLlWpGqpyP5YA1Ab116Q3q0xBc904cppXwOGWw8xQkSiyWbQ1RUIOl6JOBu+Czrk07n3Pg+nJpVkmyvJXgSPW6sgb14O8rJlgjgiPf/waEJpDwDh8Fn2EP5oeNmJIrAHl1vt0v9cHQ4kPC7ZkfSw4WFVD0JowH3br75AR0GP7h1gYqEwMeEaqhG/YJLodDQ9+8Zj4LrYY1fYg7AZrhuby8NSjdc9NpbN6EJ8OnYEDlhDy7zuWwiLOlKQXfezLLnt9N6Sqbf8NUvMEcU1PECRI/euni",
        "postgres-password":
          "AgAoEgfh4ulflAHU6s167XutTIOYg8sPfA0CQqoWyMeqOvgL/crqQBkaAJFTcRlFL6gQfRwAtgFxJat4Gs3nVcSKzSIaioUtL3Zzj5AKMjXNJmAIQtEtj64a3Si7SkR/IQIksfH3IOjAOtnqjjanmjG779TrVrlgHVRaZbAFMYs+qyiUn15JdmAOv64EGM2h3TxOXH0TmarD1DoRVEEXpF6ymM+uBiv4ziCsmtW++8cO9rVnII6WUfVnoksRXZVTUtExmG3Ch8+uUd6ciX4p2ffejQ9zsIK0x4uZ5mFaF1zHng6XSjKWqreMBlMpJPqpia0h8D6iUo6h5VzW92mUUGhnIE46GeLQ4WWwhC1QMxkpP/p1i49I3yZ6LsAJ3a9P/bfiqs81KkFb0Wo8Qq98MP5uER9+GfmgWv/WhN8jYND3hjuv2rmOsAuUEn5o9mbSILqaGL1M6KcNbQhC2LInmy99D4RRcpHjJR0TVN3mP+PNk7FbsLqR+VQ5U68A6kHoDUaDCGlOZjxndo4H0wlS0lp6ZXakIB/q7LOlH9KhjAlSA1ITDIsyVekYj329dxE1Rbtv8uHIz5DYSBSAq8wt5hTvqlZiX3y6kpNK2a2x+kZNoaXinrAMBBHl4t9306jMAIC6AeewXMZ6dajsZpZCAuWWpIfnjKgaVkNoAR5EUEpfiloTGZtAgvq3E8Lsf/rw52Ir1352VW76f9h+UkENvXx1gpNd+HYjrlbzIt+7QIzy",
      },
    } );

    // Forgejo 用 PostgreSQL のDB認証情報。createContainerApplication で立てる PG と Forgejo の両方が参照する。
    // encryptedData は実装時に `kubeseal` で暗号化した値に置き換える（参照クラスタの sealing key が必要）。
    const foregejoDBSecret = createSealedSecret( this, {
      name: FORGEJO_DB_SECRET,
      namespace: NAMESPACE,
      encryptedData: {
        password:
          "AgAEDtNaLNmCyo4ISFh9BYSXnm76oZpYvarSQfvucaIlVYo63k50WMYyv9E+8r+mxdvvnle46mdSAANdqzV0M37+S2OLztwrNrcz0LLQ6YAI0oeqRiqEdHfH7/0x7Aum236JPIl5asM1rANmSAFegVerjp+D1PcdRI9LQfNPMdMWn5GGkhfjLFbaywFhTQSmIbtJ1pe7mJB4GZVRzF5+EVysH2p25t5mSwfTBLIi+1jkAaNjU0pk3M2ixmcgSvU4cYyrh+2usOKd0UyQpOb+rO/6v2n137KQlmfGMf9OIQYzzjZHgJYBzwQHnlf8UquX5MI+0kX6gZL3PherzWzGWMIPZDTu5NVgFOswfNRojHHqt+4wWekewjlNuJZWg1X35+7R/IxJxA2bsv9uGVJ1GJ1GMeKkjtONQf4eVYAwErbAanEbMhknBhLsAgRLj0BO3LJ7sCVhSBE9bo5AuUaCTZ78NDEIYIoadSawATk7E7mgtllTdUFf4+ANMCXrtSntkKgEs8ft0/0FDwNglKOiqX/9cQpck4tayVI+yW3FQMTBWZnd6y9+OzanoBDVHqDZr8mG0Azop8zJHC5i0kv7lXf77O6dDOdlOqLE7gTVZEYYkJm0w5etK8RMJ8ImLA2Z0LS+vjLRo55HbhuXzpuT83tcah2rvrc+kVTFZgdVMd/I4XBO7AD84XDjlyz3MnAqamCb8YMuioDny1hA0A1bPlJ9H9nmgfWfct527cz4qmwGdg==",
      },
    } );

    // Forgejo の管理者アカウント認証情報。chart は `username` / `password` キーを期待する（ユーザー名に `admin` は不可）。
    const foregejoAdminSecret = createSealedSecret( this, {
      name: FORGEJO_ADMIN_SECRET,
      namespace: NAMESPACE,
      encryptedData: {
        password:
          "AgATfBZCx2sKZEbLIvrRziGfDFtP7K9+uBLPu9CxxdmcWz5SqnVumvDuSPMesuW/b0+WiY3R4Q7xdyLRE7rmPzsyAr+tkszuNrmRJqYrYICC7vsJ4E9byp73dzxnsk89VIjeExtUAeQhQ5jc0t+XrXx1zOt6MMaYCej5nBzgx+luGuC/l2JS1xnNvH0XuUtXyo3igNK/50Be9zJds9SHM2CJsSGG5RkiFl/e7m2Zq7KISy17vIUSuVGqKe2Yj1Q8mwEheqJRzS5a2TILi3V7D/43/1rnDlZp10BHxQluThxLme1Tg5ptb9ukJM8kJ7seaDOpuQZ2cPRw/JMqG+qtxTU+G5q+aRS9fev6WtJ4m0f377fMOlFvF8kwi3THpp41omJqxpXVlUwHvOVgUTUPxxednJK/zvHsNxT50gF+2XeaMsEDa924RUsjhvd9UCkpAOobWkzhM3sMTaXW7XpFisfFzzWdjK0jBk8qVIUSsj6fZbosu6gCz/laOj2P+vLX0CLQl8QKZyLvjCBlYqoTaBaTgxlvyAPc92w3ofqbyEpkxgRUA5e8uL3LhxOTvQRa6+qawb3Vngkq3MW74HW1RdsbN6mqfrHgX0qRhD8hrCYWk5dsmbzdPjy0x77Y5zHnB/VLLkl6c+MmNrVHjmbezweeeHzf61sflsW69xBkcIIasXex4PeVTN0KfOt45+5x++1mTHrz2DIcmsrvKg==",
        username:
          "AgBDu70xWvNEnM0OFhmSsRKFSCESeDTMOigkZuzEWWebstrbsYEhFiaKpdhLKkdb8JOXTQmq4sX+UWazc31o2z4Rqu2PkWb25FZl9YexDye9yFfk5WpZWAihf6TjNd/ucfdSn7jCQAAucjj7GNYV4l3zjVeEdP87mVPfCGN/bxniuxgHXMpYSZwCs6/fpagKofqquyxjeYR2KHNBCa9v5u+6hYPCIyCus76/e7sl2wNFsG9Kq70541INCmaIfxgGfV39W95a4F9VSEi1Bx0aCHf56+loACysxYRzVCwTvyeZ6qER3/RBW10MOwjwO8bd9/zMUr5k8Ol02FJWbAa5l3e8Q4hpt2ewQXRcULKngWtW9/34+TRwbW9+7u0jtj/pe7+yj1CRvm/U5RYMZxauSyVrlP313xciCFOV239iL+r4xk5L53d+xI4vlvzMwWPo+v2ReyEbxXX92kDLbJoXiWJbch+HnKFmA4GlRZNZzqpzeU6neku5eSty/hp0tlNIzrc0SAXFw5pe7rKNBCfFu1iMbPVrLeZVNa+RWdBzi1gs2CshIWECIkYj+gxkUhLtTnnJrqPBWP2Mzql6kvYipQry/iZQ7eZD41+r5uMLjhVTAkJ5x99DT2cD2of/l+2bFljOYnvnGyYEvSSs0Z6XBIOvPC+hx0WJiMdyBpRxImlGVbSa115jB1RTNd8r+3ILrxb1WIrYllo=",
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
          targetRevision: "107.161.20",
          valuesObject: {
            artifactory: {
              global: {
                masterKeySecretName: crSecret.name,
                joinKeySecretName: crSecret.name,
              },
              // artifactory-jcr chartは全値を`artifactory`直下にネストする設計のため、
              // charts/artifactory/values.yaml側のグループキー`artifactory.persistence`に
              // 届けるには、ここでもう一段`artifactory`を挟む必要がある(helm templateで実測済み)。
              // 一方`database`はnginxと同様にサブチャート自身のトップレベルキーのため1階層でよい。
              artifactory: {
                persistence: {
                  storageClassName: NFS_STORAGE_CLASS_NAME,
                },
              },
              // artifactory本体のJF_SHARED_DATABASE_PASSWORD参照先を、既定の
              // `<release>-postgresql`ではなくcrSecret(jfrog-cr-secret)に向ける。
              database: {
                secrets: {
                  password: {
                    name: crSecret.name,
                    key: "password",
                  },
                },
              },
              nginx: {
                https: {
                  enabled: false,
                },
                // 外部公開はEnvoy Gateway(HTTPRoute)経由に統一する。個別にLoadBalancer IPを
                // 払い出すと、IP変更のたびに外部DNSが追随できない問題があるため、ここは
                // クラスタ内部からのみ到達可能なClusterIPに固定する。
                service: {
                  type: "ClusterIP",
                },
                resources: {
                  requests: {
                    memory: "128Mi",
                    cpu: "100m",
                  },
                  limits: {
                    memory: "250Mi",
                    cpu: "500m",
                  },
                },
              },
              postgresql: {
                auth: {
                  existingSecret: crSecret.name,
                },
                primary: {
                  persistence: {
                    storageClass: NFS_STORAGE_CLASS_NAME,
                    size: "10Gi",
                  },
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
          targetRevision: "107.161.20",
          valuesObject: {
            global: {
              masterKeySecretName: artifactSecret.name,
              joinKeySecretName: artifactSecret.name,
            },
            artifactory: {
              // charts/artifactory/values.yaml側のグループキー`artifactory.persistence`に
              // 届けるには、ここでもう一段`artifactory`を挟む必要がある(helm templateで実測済み)。
              artifactory: {
                persistence: {
                  storageClassName: NFS_STORAGE_CLASS_NAME,
                },
              },
              // artifactory本体のJF_SHARED_DATABASE_PASSWORD参照先を、既定の
              // `<release>-postgresql`ではなくartifactSecret(jfrog-artifact-secret)に向ける。
              database: {
                secrets: {
                  password: {
                    name: artifactSecret.name,
                    key: "password",
                  },
                },
              },
              nginx: {
                https: {
                  enabled: false,
                },
                // jfrog-cr側のコメントと同じ理由でClusterIPに固定し、Envoy Gateway経由で公開する。
                service: {
                  type: "ClusterIP",
                },
                resources: {
                  requests: {
                    memory: "64Mi",
                    cpu: "200m",
                  },
                  limits: {
                    memory: "250Mi",
                    cpu: "500m",
                  },
                },
              },
              postgresql: {
                auth: {
                  existingSecret: artifactSecret.name,
                },
                primary: {
                  resources: {
                    requests: {
                      cpu: "2",
                      memory: "512Mi",
                    },
                    limits: {
                      cpu: "3",
                      memory: "2048Mi",
                    },
                  },
                  persistence: {
                    storageClass: NFS_STORAGE_CLASS_NAME,
                    size: "10Gi",
                  },
                },
              },
            },
          },
        },
      ],
    } );

    // jfrog-cr / jfrog-artifactryのnginxフロントエンド(旧LoadBalancer)をEnvoy Gateway経由で公開する。
    // backendRefsのnameはHelmチャートのfullname規則(`<release>-artifactory-nginx`)に従う。
    createHTTPRoute( this, {
      name: "jfrog-cr-route",
      namespace: NAMESPACE,
      hostnames: [ `cr.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: "jfrog-cr-artifactory-nginx", port: 80 } ],
    } );

    createHTTPRoute( this, {
      name: "jfrog-artifactry-route",
      namespace: NAMESPACE,
      hostnames: [ `artifactry.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: "jfrog-artifactry-artifactory-nginx", port: 80 } ],
    } );

    // Forgejo 用 PostgreSQL（StatefulSet）。データVolume は NFS（NAS）上に置く。認証情報は DB Secret のみ参照。
    const forgejoDb = createContainerApplication( this, "forgejo-postgresql", {
      name: FORGEJO_POSTGRES_RELEASE,
      namespace: NAMESPACE,
      project: PROJECT_NAME,
      controllerType: "statefulset",
      image: { repository: "postgres", tag: "17-bookworm" },
      env: {
        POSTGRES_DB: "forgejo",
        POSTGRES_USER: "forgejo",
        POSTGRES_PASSWORD: {
          secretKeyRef: { name: foregejoDBSecret.name, key: "password" },
        },
      },
      resources: {
        requests: { cpu: "100m", memory: "256Mi" },
        limits: { memory: "1Gi" },
      },
      persistence: {
        data: nfsPersistence( {
          accessMode: "ReadWriteOnce",
          size: "10Gi",
          retain: true,
          globalMounts: [ { path: "/var/lib/postgresql/data" } ],
        } ),
      },
      service: {
        ports: { postgresql: { port: 5432 } },
      },
    } );

    // Forgejo（Gitea のフォークであるコードホスティング環境）。上流の公式 OCI チャートを導入する。
    // release名=forgejo なので Service 名も forgejo になる（chart の fullname 規則）。SSH は外部公開しない。
    createHelmApplication( this, "application-forgejo", {
      name: FORGEJO_RELEASE,
      namespace: NAMESPACE,
      project: PROJECT_NAME,
      repoUrl: "oci://code.forgejo.org/forgejo-helm/forgejo",
      targetRevision: "17.1.7",
      valuesObject: {
        image: {
          // rootless:true のとき chart が自動的に `-rootless` サフィックスを付与する。
          rootless: true,
          tag: "16.0.5",
        },
        gitea: {
          admin: {
            existingSecret: foregejoAdminSecret.name,
            passwordMode: "keepUpdated",
          },
          server: {
            domain: `forgejo.${ CLUSTER_DOMAIN }`,
          },
          metrics: {
            enabled: true,
          },
          database: {
            db_type: "postgres",
            host: `${ forgejoDb.metadata.name }:5432`,
            name: "forgejo",
            user: "forgejo",
          },
        },
        additionalConfigFromEnvs: [
          {
            name: "FORGEJO__DATABASE__PASSWD",
            valueFrom: {
              secretKeyRef: {
                name: foregejoDBSecret.name,
                key: "password",
              },
            },
          },
        ],
        // DB パスワードのみ機密値。FORGEJO__DATABASE__PASSWD で app.ini の [database] PASSWD に展開される。
        persistence: {
          storageClass: NFS_STORAGE_CLASS_NAME,
          size: "10Gi",
        },
        service: {
          http: { type: "ClusterIP", port: 3000 },
        },
      },
    } );

    // Forgejo Web UI を Envoy Gateway（HTTPRoute）経由で公開。SSH(2222) の外部公開は不要。
    createHTTPRoute( this, {
      name: "forgejo-route",
      namespace: NAMESPACE,
      hostnames: [ `forgejo.${ CLUSTER_DOMAIN }` ],
      backendRefs: [ { name: "forgejo-http", port: 3000 } ],
    } );
  }
}
