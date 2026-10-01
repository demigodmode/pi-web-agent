const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('git version 2.55.0\n');
  process.exit(0);
}

for (let index = 0; index < Number(process.env.GIT_CONFIG_COUNT); index += 1) {
  if (process.env[`GIT_CONFIG_KEY_${index}`] === 'http.https://github.com/.extraHeader') {
    process.stderr.write(`${process.env[`GIT_CONFIG_VALUE_${index}`]}\n`);
  }
}
process.exit(1);
