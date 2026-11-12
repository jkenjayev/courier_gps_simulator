'use strict';
/**
 * Copies the simulator (server.js, public/, ios_helper.py) from the project root into desktop/app/,
 * which is what gets packaged. Run automatically by `npm start` and `npm run dist`.
 */
const fs = require('fs');
const path = require('path');

const desktop = path.join(__dirname, '..');
const root = path.join(desktop, '..');
const out = path.join(desktop, 'app');

for (const f of ['server.js', 'public', 'ios_helper.py']) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error(`Missing ${f} in ${root}. The desktop/ folder must stay inside the courier-gps-sim project.`);
    process.exit(1);
  }
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(out, 'server.js'));
fs.copyFileSync(path.join(root, 'ios_helper.py'), path.join(out, 'ios_helper.py'));
fs.cpSync(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });
console.log('Prepared app/ (server.js, public/, ios_helper.py)');
