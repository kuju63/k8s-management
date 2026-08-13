export default {
  // ---- 1. すべてのファイルで betterleaks を実行 ----
  '*': ['betterleaks dir'],

  // ---- 2. src配下の JS/TS ファイル → biome format + lint ----
  'src/**/*.{js,ts,jsx,tsx}': [
    'biome format --write',
    'biome lint',
  ],

  // ---- HTML / CSS も biome でチェック ----
  '*.{html,css}': [
    'biome format --write',
    'biome lint',
  ],

  // ---- 3. Markdownファイル → markdownlint + textlint ----
  '*.md': [
    'markdownlint-cli2',
    'textlint',
  ],

  // ---- 4. 除外パス（必要に応じてコメントアウト解除） ----
  // '!**/vendor/**/*',
  // '!**/.git/**/*',
};
