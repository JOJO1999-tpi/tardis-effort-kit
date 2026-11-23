const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const begin = '/* BEGIN TARDIS ANTIGRAVITY EFFORT */';
const end = '/* END TARDIS ANTIGRAVITY EFFORT */';
const command = process.argv[2];
const target = process.argv[3] ?? path.join(
  os.homedir(), '.gemini', 'antigravity', 'theme-patch', 'user', 'custom.js',
);

if (!['install', 'remove'].includes(command)) {
  console.error('Usage: node install.cjs install|remove [path-to-theme-user-custom.js]');
  process.exit(1);
}

const source = fs.readFileSync(target, 'utf8');
const first = source.indexOf(begin);
const last = source.indexOf(end);
if (first !== -1 || last !== -1) {
  if (first < 1 || last < first || source.indexOf(begin, first + 1) !== -1
    || source.indexOf(end, last + 1) !== -1 || source[first - 1] !== '\n'
    || source[last + end.length] !== '\n') {
    throw new Error('Unexpected TARDIS markers in custom.js. Review the file before proceeding.');
  }
}

const block = command === 'install'
  ? `\n${begin}\n${fs.readFileSync(path.join(__dirname, 'tardis-antigravity.js'), 'utf8').trimEnd()}\n${end}\n`
  : '';
const updated = first === -1
  ? source + block
  : source.slice(0, first - 1) + block + source.slice(last + end.length + 1);

if (updated !== source) {
  const temporary = `${target}.tardis-${process.pid}.tmp`;
  fs.writeFileSync(temporary, updated, { flag: 'wx' });
  try {
    if (fs.readFileSync(target, 'utf8') !== source) throw new Error('custom.js changed during the operation');
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
console.log(updated === source ? 'No change needed.' : 'Updated the TARDIS extension block.');
