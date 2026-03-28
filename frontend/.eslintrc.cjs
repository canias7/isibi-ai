module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "prettier",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    // Warn on `any` — don't block builds, but make it visible
    "@typescript-eslint/no-explicit-any": "warn",
    // Allow unused vars prefixed with _
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    // React hooks exhaustive deps
    "react-hooks/exhaustive-deps": "warn",
    // No console.log in production
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
};
