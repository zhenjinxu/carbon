import { applyDotenvToProcessEnv } from "@carbon/dev/vite";
import { lingui } from "@lingui/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, PluginOption } from "vite";

/*
 * Pre-resolve Babel packages from `vite-plugin-babel-macros`'s node_modules.
 * Dynamic `import("@babel/core")` fails at runtime because Vite compiles
 * vite.config.ts into `.vite-temp/` where those packages aren't reachable.
 * Resolving at config-load time (before the temp-file move) gives us absolute
 * paths that work anywhere.
 */
const _cfgRequire = createRequire(import.meta.url);
/* Resolve the macros plugin's compiled JS, then create a require scoped to
 * its own node_modules — that's where @babel/core and babel-plugin-macros
 * live as transitive deps. All resolved to absolute paths up front so they
 * remain valid after Vite moves vite.config.ts into `.vite-temp/`. */
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

export default defineConfig(({ isSsrBuild, mode }) => {
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
      external: ["@napi-rs/canvas"],
      noExternal: [
        "react-tweet",
        "react-dropzone",
        "react-icons",
        "react-phone-number-input",
        "tailwind-merge",
      ],
    },
    server: {
      port: 3000,
      strictPort: true,
      allowedHosts: [
        ".ngrok-free.app",
        ".ngrok-free.dev",
        ".dev",
        ".localhost",
        "host.docker.internal",
      ],
      watch: {
        awaitWriteFinish: { stabilityThreshold: 250 },
      },
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
        /**
         * Konva's Node entry (`index-node.js`) requires native `canvas`. Vite SSR
         * can still load that graph; alias `canvas` to a stub (do not alias the
         * whole `konva` package — react-konva imports `konva/lib/Core.js`, etc.).
         */
        canvas: path.resolve(__dirname, "app/ssr-shims/canvas-stub.cjs"),
        "@carbon/utils": path.resolve(
          __dirname,
          "../../packages/utils/src/index.ts",
        ),
        "@carbon/form": path.resolve(
          __dirname,
          "../../packages/form/src/index.tsx",
        ),
      },
    },
  };
});
