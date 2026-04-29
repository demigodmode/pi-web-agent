import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { execSync } from 'node:child_process';

export function parseUnreleasedSections(changelog) {
  const unreleasedMatch = changelog.match(/## Unreleased\s*([\s\S]*?)(?:\n## \[|$)/);
  if (!unreleasedMatch) {
    throw new Error('CHANGELOG.md is missing an Unreleased section.');
  }

  const body = unreleasedMatch[1];
  const result = {
    Added: [],
    Changed: [],
    Fixed: [],
    Breaking: []
  };

  let currentSection = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^###\s+(Added|Changed|Fixed|Breaking)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    if (!currentSection || !line.startsWith('-')) continue;

    const entry = line.replace(/^-\s*/, '').trim();
    if (!entry || entry === 'None.' || entry === 'Nothing yet.') continue;
    result[currentSection].push(entry);
  }

  return result;
}

export function inferVersionBump(sections) {
  if ((sections.Breaking ?? []).some((line) => line.trim())) return 'major';
  if ((sections.Added ?? []).some((line) => line.trim())) return 'minor';
  return 'patch';
}

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split('.').map(Number);
  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function ensureCleanWorkingTree() {
  const status = execSync('git status --short', { encoding: 'utf8' }).trim();
  if (status) {
    throw new Error('Working tree must be clean before running release script.');
  }
}

function rewriteChangelog(changelog, nextVersion) {
  const today = new Date().toISOString().slice(0, 10);
  return changelog.replace(
    /## Unreleased\s*([\s\S]*?)(?=\n## \[|$)/,
    `## Unreleased\n\n### Added\n- Nothing yet.\n\n### Changed\n- Nothing yet.\n\n### Fixed\n- Nothing yet.\n\n### Breaking\n- None.\n\n## [${nextVersion}] - ${today}\n$1`
  );
}

export function rewritePackageLockVersion(packageLockText, nextVersion) {
  const packageLock = JSON.parse(packageLockText);
  packageLock.version = nextVersion;

  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = nextVersion;
  }

  return `${JSON.stringify(packageLock, null, 2)}\n`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const changelogPath = 'CHANGELOG.md';
  const packageJsonPath = 'package.json';
  const packageLockPath = 'package-lock.json';

  const changelog = readFileSync(changelogPath, 'utf8');
  const packageJsonText = readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonText);

  const unreleased = parseUnreleasedSections(changelog);
  const bump = inferVersionBump(unreleased);
  const nextVersion = bumpVersion(packageJson.version, bump);

  if (
    unreleased.Added.length === 0 &&
    unreleased.Changed.length === 0 &&
    unreleased.Fixed.length === 0 &&
    unreleased.Breaking.length === 0
  ) {
    throw new Error('Unreleased section is empty. Nothing to release.');
  }

  if (dryRun) {
    console.log(`Current version: ${packageJson.version}`);
    console.log(`Version bump: ${bump}`);
    console.log(`Next version: ${nextVersion}`);
    console.log(`Tag: v${nextVersion}`);
    return;
  }

  ensureCleanWorkingTree();

  execSync(`npm version ${nextVersion} --no-git-tag-version`, { stdio: 'inherit' });
  execSync('npm install --package-lock-only --include=optional', { stdio: 'inherit' });
  writeFileSync(changelogPath, rewriteChangelog(changelog, nextVersion));

  execSync(`git add ${packageJsonPath} ${packageLockPath} ${changelogPath}`, { stdio: 'inherit' });
  execSync(`git commit -m "release v${nextVersion}"`, { stdio: 'inherit' });
  execSync(`git tag v${nextVersion}`, { stdio: 'inherit' });

  console.log(`Released ${nextVersion}`);
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
