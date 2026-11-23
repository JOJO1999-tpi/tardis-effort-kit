const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
const script = ['tardis-effort-core.js', 'scene-engine.js', 'animation.js'].map(read).join('\n');
fs.writeFileSync(path.join(__dirname, 'codex-tardis.mjs'), script + '\nexport { mountTardisAnimation, EFFORT_STAGES };\n');
fs.writeFileSync(path.join(__dirname, 'codex-tardis-preview.html'),
  read('preview.html').replace('/* ANIMATION */', () => script));
