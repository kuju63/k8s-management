import { ApiObject, type Chart } from "cdk8s";

const API_VERSION = "bitnami.com/v1alpha1";
const KIND = "SealedSecret";
const DEFAULT_NAMESPACE = "default";
const NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * `SealedSecret`リソース（apiVersion: bitnami.com/v1alpha1）の定義。Secret を生成するための「指示書」です。
 * [Sealed Secrets の概要](https://github.com/bitnami/sealed-secrets#overview) に記載されているとおり、
 * 暗号化された中身は公開リポジトリに保存しても安全です。暗号化解読ができるのは対象クラスタで動作する
 * コントローラのみであり、オリジナルの元 Secret は他者（元作者を含む）には分かりません。unseal されると、
 * 直接作成した Secret と同じように振るまる通常の `Secret` が生成されます。
 *
 * `name` と `namespace` は暗号データに束縛されます（既定の sealing スコープは `strict`）。そのため、
 * 別の namespace / 別の名前に移動・変更された `SealedSecret` は復号できません。`encryptedData` は
 * `spec.encryptedData` フィールドにマッピングされ、その値は非対称暗号化された base64 エンコードの
 * Secret アイテムです。
 *
 * 本ヘルパーは Secret の実体を平文で書かずに（= [config-and-secrets.md](../../docs/config-and-secrets.md)
 * の方針違反にならないように）コードから Secret を導入するための唯一の経路です。`encryptedData` の値は
 * `kubeseal` によって暗号化されておりコミット可能なため、同ドキュメントの「実体は書かない」制約の
 * 例外として扱えます。値の生成方法は下記フィールド参照。
 */
export interface SealedSecretOptions {
  /** `SealedSecret` の名前（unseal 後の `Secret` も同じ名前）。strict スコープでは暗号データの一部分。 */
  name: string;
  /** `SealedSecret` を適用する namespace。strict スコープでは payload に束縛されるため実質必須。 */
  namespace?: string;
  /**
   * base64 エンコードの暗号化 Secret アイテム。`spec.encryptedData` にマッピング。
   *
   * 値は平文ではなく `kubeseal` によって暗号化されたもので、**コミットしても安全**です。生成例:
   *
   * ```sh
   * echo -n bar | kubectl create secret generic mysecret --dry-run=client --from-literal=foo=bar -o json \
   *   | kubeseal -f - -o yaml > sealedsecret.yaml
   * ```
   *
   * `kubeseal` は入力 Secret の `name`/`namespace` を暗号化に反映します。既定の `strict` スコープでは
   * これらを**厳密に一致**させる必要があり、一致しないとクラスタで復号できません（`--scope` で
   * `namespace-wide` / `cluster-wide` を指定すると一致要件が緩和されます）。
   */
  encryptedData: Record< string, string >;
}

/**
 * `createSealedSecret` が生成した `SealedSecret` に関する、後続の処理で再利用するための最小限の情報。
 *
 * ビルド時の任意の値（`kind` や `apiVersion` など）は意図的に公開せず、`SealedSecret` を特定し、
 * かつ同じ `kubeseal` の鍵を使った別リソースと関連付けるのに必要な情報のみを開示する。この型に対して
 * 新たなフィールドを増やす場合は、後続の処理が本当に必要と判断できるかに注意する。
 */
export interface SealedSecretResult {
  /** `SealedSecret`（＝unseal 後の `Secret`）の名前。strict スコープでは暗号データの一部。 */
  name: string;
  /** 適用された物理的な namespace。`SealedSecretOptions.namespace` を省略した場合は `default`。 */
  namespace: string;
  /**
   * `encryptedData` のキーの集合。この `SealedSecret` が管理する Secret アイテムを特定する際に使う。
   * 例: `createSealedSecret(...)` の戻り値の `encryptedDataKey` は `Set { 'secretEnv' }` となる。
   */
  encryptedDataKey: Set< string >;
}

/**
 * 指定した `chart` に `SealedSecret` リソースを追加します。
 *
 * [Sealed Secrets](https://github.com/bitnami/sealed-secrets) と ArgoCD のインターフェースを踏襲し、
 * 引数は bitnami.com/v1alpha1 の `SealedSecret.spec` に、戻り値は `spec.encryptedData` のキーを元にした
 * 最小限の情報（`name` / `namespace` / 鍵の集合）のみを公開する独自型にしています。
 * これにより後続の処理（同じ鍵を使った別リソースとの関連付けなど）で使いやすくなります。
 *
 * `namespace` を省略した場合は `DEFAULT_NAMESPACE`（`default`）が適用されます。この値は `metadata`
 * の名前空間と戻り値の `namespace` に反映されます。
 *
 * @param chart リソースを配置する `cdk8s` の `Chart`
 * @param props [`SealedSecretOptions`](#SealedSecretOptions) — リソース定義と暗号データ
 * @returns 呼び出し側で再利用するための最小限の結果。`encryptedDataKey` には `encryptedData` のキーが
 * 格納されているため、この `SealedSecret` が管理する Secret アイテムを特定するために使える
 *
 * @example 使用例
 * ```ts
 * const sealed = createSealedSecret(appChart, {
 *   name: 'foo',
 *   namespace: 'bar',
 *   encryptedData: { secretEnv: 'AgBy...kubeseal...' },
 * })
 * // sealed.encryptedDataKey => Set { 'secretEnv' }
 * ```
 */
export function createSealedSecret( chart: Chart, props: SealedSecretOptions ): SealedSecretResult {
  const { name, namespace = DEFAULT_NAMESPACE, encryptedData } = props;

  if ( ! NAME_REGEX.test( name ) ) {
    throw new Error( `name must match /${ NAME_REGEX.source }/` );
  }

  // encryptedDataがないとapply時にエラーとなる
  if ( Object.keys( encryptedData ).length === 0 ) {
    throw new Error( "encryptedData must contain at least one entry." );
  }

  new ApiObject( chart, props.name, {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name, namespace },
    spec: {
      encryptedData,
    },
  } );

  return {
    name,
    namespace,
    encryptedDataKey: new Set( Object.keys( encryptedData ) ),
  };
}
