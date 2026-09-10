import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: { jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }], rules: { "vite-plus/prefer-vite-plus-imports": "error" }, options: { typeAware: true, typeCheck: true }, ignorePatterns: ["apps/api/**", "dist/**", "output/**", ".playwright-cli/**"] },
  fmt: { printWidth: 320, objectWrap: "collapse", sortPackageJson: false, ignorePatterns: ["apps/api/**", "dist/**", "output/**", ".playwright-cli/**", "bun.lock", "docs/**", "**/*.md"] },
});
