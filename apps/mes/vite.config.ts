import { applyDotenvToProcessEnv } from "@carbon/dev/vite";
import { reactRouter } from "@react-router/dev/vite";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";

/*
 * Pre-resolve Babel packages from `vite-plugin-babel-macros`'s node_modules.
 * Dynamic `import("@babel/core")` fails at runtime because Vite compiles
 * vite.config.ts into `.vite-temp/` where those packages aren't reachable.
 */
const _cfgRequire = createRequire(import.meta.url);
const _babelReq = createRequire(
  _cfgRequire.resolve("vite-plugin-babel-macros")
);
const babelPkg = _babelReq("@babel/core") as typeof import("@babel/core");
const syntaxJsx = _babelReq.resolve("@babel/plugin-syntax-jsx");
const syntaxTs = _babelReq.resolve("@babel/plugin-syntax-typescript");
const macrosPluginPath = _babelReq.resolve("babel-plugin-macros");

/**
 * Replacement for `vite-plugin-babel-macros` that short-circuits files without
 * any macro import before invoking Babel. The original plugin runs Babel's
 * full AST pipeline on EVERY .ts/.tsx file — auto-generated files like
 * `types.ts` (~2 MB) and `swagger-docs-schema.ts` (~4 MB) exceed Babel's
 * 500 KB "deoptimise" threshold and crash the dev server with
 * STATUS_STACK_BUFFER_OVERRUN. Since those files contain no macro imports,
 * a quick string check avoids Babel entirely for them.
 */
function macrosSkipLarge(): PluginOption {
  const macroImportRe = /\/macro["';]/;
  const tsxRe = /\.(j|t)sx$/;
  return {
    name: "babel-macros-skip-large",
    enforce: "pre" as const,
    async transform(source: string, filename: string) {
      if (filename.includes("node_modules")) return null;
      if (!/\.(j|t)sx?$/.test(filename)) return null;
      if (!macroImportRe.test(source)) return null;

      return babelPkg.transformAsync(source, {
        filename,
        plugins: [
          syntaxJsx,
          [syntaxTs, { isTSX: tsxRe.test(filename) }],
          macrosPluginPath,
        ],
        babelrc: false,
        configFile: false,
        sourceMaps: true,
      });
    },
  };
}

export default defineConfig(({ mode, isSsrBuild }) => {
  applyDotenvToProcessEnv(mode, __dirname);

  return {
    build: {
      minify: true,
      rolldownOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.code === "SOURCEMAP_ERROR") {
            return;
          }

          defaultHandler(warning);
        },
        ...(isSsrBuild && { input: "./server/app.ts" }),
      },
    },
    define: {
      global: "globalThis",
    },
    ssr: {
      noExternal: [
        "react-dropzone",
        "react-icons",
        "react-phone-number-input",
        "tailwind-merge",
      ],
    },
    server: {
      port: 3001,
      strictPort: true,
      allowedHosts: [".ngrok-free.app", ".w.modal.host", ".w.modal.dev", ".dev", ".localhost"],
    },
    plugins: [
      tailwindcss(),
      macrosSkipLarge(),
      lingui(),
      reactRouter(),
    ] as PluginOption[],
    resolve: {
      tsconfigPaths: true,
      alias: {
        "@carbon/utils": path.resolve(
          __dirname,
          "../../packages/utils/src/index.ts"
        ),
        "@carbon/form": path.resolve(
          __dirname,
          "../../packages/form/src/index.tsx"
        ),
      },
    },
  };
});
