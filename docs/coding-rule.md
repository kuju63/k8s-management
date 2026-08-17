# コーディングルール

このプロジェクトは **Biome** と **TSDoc** を使用してコード品質とドキュメントの整合性を確保する。代表的な設定と要件をまとめている。

## 1. Biome の代表的設定

|設定|説明|
|---|---|
|`semi`|行末にセミコロンを必ず付ける|
|`quote`|文字列はシングルクォートで囲む|
|`indent`|インデントは2スペース|
|`maxLineLength`|行長は100文字まで|
|`noExplicitAny`|明示的な `any` の使用を禁止|
|`noUnusedVariables`|未使用変数をエラーにする|

`biome lint --config packages/biome.toml` を実行して設定を検証してください。

## 2. TSDoc の要件

### 2.1 公開 API は必ずドキュメント化する

- エクスポートされる関数・クラス・インターフェース・型エイリアス・定数
- 公開インターフェースのフィールドもドキュメント化必須

### 2.2 例外

|コードスニペット|原因|
|---|---|
|テストファイル (`.test.ts`, `.spec.ts`)|ドキュメント化不要|
|デバッグエクスポート|一時的であっても公開は禁止（本番配備前に削除）|

### 2.4 型定義の推奨

- 基本的に **interface** を使用すること

  **type** は union 型（例: `type Result = Success | Failure`）や型エイリアスとしてのみ使用し、
  構造体の形を定義する場合は interface を優先する

### 2.3 例

```ts
/** ユーザー情報を取得します */
export function getUser(id: string): User {
  // 実装
}

/** ユーザーインターフェース */
export interface User {
  /** ユーザー名 */
  name: string;
  /** アバター画像URL */
  avatarUrl?: string;
}
```

## 3. まとめ

- Biome の代表設定を守り、`biome lint` を実行すること
- 公開 API には必ず TSDoc を付け、テストコードは除外すること
- デバッグエクスポートは本番前に必ず削除すること
