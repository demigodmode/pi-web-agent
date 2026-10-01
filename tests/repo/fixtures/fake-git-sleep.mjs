import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--version') && process.env.FAKE_GIT_SLEEP_VERSION !== '1') {
  process.stdout.write('git version 2.55.0\n');
  process.exit(0);
}
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
if (process.env.FAKE_GIT_PID_FILE) {
  const temporaryPidFile = `${process.env.FAKE_GIT_PID_FILE}.${process.pid}.tmp`;
  writeFileSync(temporaryPidFile, JSON.stringify({ pid: process.pid, grandchild: grandchild.pid }));
  renameSync(temporaryPidFile, process.env.FAKE_GIT_PID_FILE);
}
if (process.env.FAKE_GIT_STARTED_FILE) writeFileSync(process.env.FAKE_GIT_STARTED_FILE, 'started');
setInterval(() => {}, 1000);
