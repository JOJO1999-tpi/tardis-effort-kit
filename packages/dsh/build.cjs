const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = __dirname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const { name } = JSON.parse(read('package.json'));
const core = read('src/tardis-effort-core.js');
const client = read('src/client.js');
const style = JSON.stringify(read('src/panel.css'));

mkdirSync(join(root, 'lib'), { recursive: true });
writeFileSync(join(root, 'lib/client.js'), [
  '/* Built by build.cjs. */',
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory(require) {`,
  'const core = (() => {',
  core.trim(),
  '})();',
  `const styles = ${style};`,
  client.trim(),
  'return { name: "tardis-effort", inject, apply };',
  '} });',
  '',
].join('\n'));
