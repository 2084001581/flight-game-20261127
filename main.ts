// Sky Courier: Island Run — the hand-in program (Node 22, standard library only).
//
// What it does, in order:
//   1. Self-checks the repository the way the gate will: license present, claim
//      file naming a Solana wallet, game/index.html inside its size cap,
//      3-4 screenshots inside theirs, game/ inside its file and byte caps,
//      and no symlinks anywhere under game/.
//   2. Copies game/ and screenshots/ beside this file into /output
//      (MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json
//      with the vendored make.fun library, exactly as the kit specifies.
//   3. Logs each step to stderr so a failed run says which check tripped.
//
// It writes nothing but those files, and nothing it writes depends on the clock,
// so two runs of the same repository produce the same bytes.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The gate's caps, as the kit's RULES.txt states them.
const GATE = {
  textMaxBytes: 163840,
  screenshotsMax: 4,
  screenshotMaxBytes: 262144,
  gameMaxFiles: 993,
  gameMaxBytes: 50331648,
  gamePathMaxBytes: 1000,
};

const WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function log(step, detail) {
  console.error(`[sky-courier hand-in] ${step}: ${detail}`);
}

function fail(step, detail) {
  log(step, `FAILED — ${detail}`);
  process.exit(1);
}

// Walk a directory tree the way the gate counts it: every file and directory,
// refusing symlinks outright instead of following them.
function walkTree(root, relative = '') {
  const entries = [];
  for (const name of readdirSync(join(root, relative))) {
    const rel = relative ? `${relative}/${name}` : name;
    const full = join(root, rel);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) fail('self-check', `symlink under game/: ${rel}`);
    entries.push({ rel, full, isDirectory: stat.isDirectory(), bytes: stat.isFile() ? stat.size : 0 });
    if (stat.isDirectory()) entries.push(...walkTree(root, rel));
  }
  return entries;
}

function selfCheck(here) {
  // License: an OSI-approved license must sit at the root.
  if (!existsSync(join(here, 'LICENSE'))) fail('self-check', 'LICENSE is missing from the repository root');
  log('self-check', 'LICENSE present');

  // Claim file: the wallet the prize would go to.
  const claimPath = join(here, '.makefun', 'owner.json');
  if (!existsSync(claimPath)) fail('self-check', '.makefun/owner.json is missing');
  let claim;
  try {
    claim = JSON.parse(readFileSync(claimPath, 'utf8'));
  } catch {
    fail('self-check', '.makefun/owner.json is not valid JSON');
  }
  if (typeof claim?.wallet !== 'string' || !WALLET_PATTERN.test(claim.wallet)) {
    fail('self-check', '.makefun/owner.json does not name a Solana wallet address');
  }
  log('self-check', `claim file names wallet ${claim.wallet.slice(0, 4)}…${claim.wallet.slice(-4)}`);

  // game/index.html: the entry point, inside its 1 MiB cap.
  const indexPath = join(here, 'game', 'index.html');
  if (!existsSync(indexPath)) fail('self-check', 'game/index.html is missing');
  const indexBytes = statSync(indexPath).size;
  if (indexBytes > 1048576) fail('self-check', `game/index.html is ${indexBytes} bytes, over the 1 MiB cap`);
  log('self-check', `game/index.html present (${indexBytes} bytes)`);

  // game/ as a whole: file count, bytes, path lengths.
  const gameEntries = walkTree(join(here, 'game'));
  if (gameEntries.length > GATE.gameMaxFiles) {
    fail('self-check', `game/ holds ${gameEntries.length} entries, over the ${GATE.gameMaxFiles} cap`);
  }
  const gameBytes = gameEntries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (gameBytes > GATE.gameMaxBytes) {
    fail('self-check', `game/ is ${gameBytes} bytes, over the ${GATE.gameMaxBytes} cap`);
  }
  for (const entry of gameEntries) {
    if (Buffer.byteLength(entry.rel, 'utf8') > GATE.gamePathMaxBytes) {
      fail('self-check', `path under game/ is over ${GATE.gamePathMaxBytes} bytes: ${entry.rel}`);
    }
  }
  log('self-check', `game/ holds ${gameEntries.length} entries, ${gameBytes} bytes`);

  // screenshots/: 3 or 4 images, each inside the 256 KiB cap, names the gate accepts.
  const shotsDir = join(here, 'screenshots');
  if (!existsSync(shotsDir)) fail('self-check', 'screenshots/ is missing');
  const shots = readdirSync(shotsDir)
    .filter((name) => !name.startsWith('.'))
    .sort();
  if (shots.length < 3 || shots.length > GATE.screenshotsMax) {
    fail('self-check', `screenshots/ holds ${shots.length} images, need 3 or 4`);
  }
  for (const name of shots) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(name) || name.startsWith('-')) {
      fail('self-check', `screenshot name the gate refuses: ${name}`);
    }
    const bytes = statSync(join(shotsDir, name)).size;
    if (bytes > GATE.screenshotMaxBytes) {
      fail('self-check', `screenshot ${name} is ${bytes} bytes, over the 256 KiB cap`);
    }
  }
  log('self-check', `${shots.length} screenshots (${shots.join(', ')})`);
  return shots;
}

function handIn(here, out) {
  if (resolve(out) === resolve('/')) fail('hand-in', 'refusing to write into /');
  mkdirSync(out, { recursive: true });
  // Clear the output directory's contents without removing the directory
  // itself: in the grader /output is a mount point the runner cannot unlink
  // (its parent is read-only), so rmSync(out) dies with EACCES and the whole
  // run exits 1. Emptying the children keeps the same clean-output promise.
  for (const name of readdirSync(out)) {
    rmSync(join(out, name), { recursive: true, force: true });
  }
  cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
  log('hand-in', 'copied game/ to output');
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  if (existsSync(join(here, 'screenshots'))) {
    cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  }
  log('hand-in', 'copied screenshots/ to output');
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: GATE.textMaxBytes,
      screenshots: { max: GATE.screenshotsMax, max_bytes: GATE.screenshotMaxBytes },
      game_max_files: GATE.gameMaxFiles,
      game_max_bytes: GATE.gameMaxBytes,
      game_path_max_bytes: GATE.gamePathMaxBytes,
    }),
  );
  const dossierBytes = statSync(join(out, 'dossier.json')).size;
  log('hand-in', `wrote dossier.json (${dossierBytes} bytes)`);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

selfCheck(here);
handIn(here, out);
log('done', `entry handed in to ${out}`);
