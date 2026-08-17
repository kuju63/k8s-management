export default {
  // ---- 1. すべてのファイルで betterleaks を実行 ----
  "*": [ "betterleaks dir" ],

  // ---- 2. JS/TS ファイル → biome format + lint ----
  "*.{js,ts,jsx,tsx}": [ "pnpm run format:check", "pnpm run lint" ],

  // ---- HTML / CSS も biome でチェック ----
  "*.{html,css}": [ "pnpm run format:check", "pnpm run lint" ],

  // ---- 3. Markdownファイル → markdownlint + textlint ----
  "*.md": [ "markdownlint-cli2", "textlint" ],

  // ---- 4. 除外パス（必要に応じてコメントアウト解除） ----
  ".claude/skills/helm-chart-version-check/**/*": [],
};