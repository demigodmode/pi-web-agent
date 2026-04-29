import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

export function extractReleaseNotes(changelog, tagName) {
  const version = tagName.replace(/^v/, '');
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = changelog.match(new RegExp(`## \\[${escapedVersion}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`));

  if (!match) {
    throw new Error(`CHANGELOG.md does not contain a section for ${tagName}.`);
  }

  return match[1].trim();
}

function main() {
  const tagName = process.argv[2];
  const outputPath = process.argv[3];

  if (!tagName || !outputPath) {
    throw new Error('Usage: node scripts/release-notes.mjs <tag> <output-file>');
  }

  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  writeFileSync(outputPath, `${extractReleaseNotes(changelog, tagName)}\n`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
