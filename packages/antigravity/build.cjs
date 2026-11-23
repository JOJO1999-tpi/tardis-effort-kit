const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8').trim();
const hook = [
  '/* TARDIS Effort for the Chuanban Antigravity theme patch. */',
  '(() => {',
  "if (typeof ctx === 'undefined' || !ctx.onCleanup || !document.body || !document.head) return;",
  "if (document.getElementById('antigravity-tardis-effort-css')) return;",
  'function sceneFactory() {',
  read('tardis-effort-core.js'),
  read('scene-engine.js'),
  'return { createSceneClock, buildProfileState, clamp };',
  '}',
  'const { createSceneClock, buildProfileState, clamp } = sceneFactory();',
  'const workerProgram = `const { createSceneClock } = (${sceneFactory.toString()})();',
  'let scene;',
  'self.onmessage = ({ data }) => {',
  '  if (data.surface) {',
  '    scene = createSceneClock(data.surface);',
  '    self.postMessage("ready");',
  '  }',
  '  scene.apply(data.change);',
  '};`;',
  read('slider.js'),
  'const core = { createTardisEffortSlider };',
  `const panelStyles = ${JSON.stringify(read('panel.css'))};`,
  read('client.js'),
  '})();',
  '',
].join('\n');

fs.writeFileSync(path.join(__dirname, 'tardis-antigravity.js'), hook);
