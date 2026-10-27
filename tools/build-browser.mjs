import { build } from 'esbuild';
await build({
  stdin: { contents: "import fengari from 'fengari'; export const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;", resolveDir: new URL('..', import.meta.url).pathname, sourcefile: 'fengari-browser.js' },
  outfile: new URL('../shared/web/vendor/fengari.mjs', import.meta.url).pathname,
  bundle: true, platform: 'browser', format: 'esm', minify: true,
  define: { 'process.env.FENGARICONF': 'undefined', process: 'undefined' },
  legalComments: 'inline',
});
