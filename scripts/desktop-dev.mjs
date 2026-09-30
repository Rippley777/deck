import { spawn } from 'node:child_process';

let existing;
try {
  existing = await fetch('http://127.0.0.1:1432', { signal: AbortSignal.timeout(1500) });
} catch { /* No existing dev server. */ }
if (existing) {
  if (!(await existing.text()).includes('<title>Deck')) {
    console.error('Port 1432 belongs to another app. Stop it or change both Deck port settings.');
    process.exit(1);
  }
  console.log('Reusing the Deck development server on port 1432.');
} else {
  const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
}
