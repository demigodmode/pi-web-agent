import type { WebExploreResponse } from '../types.js';
import type { SecretKind, SecretMatch } from './secrets.js';

const messages: Record<SecretKind, string> = {
  github: 'Refused: the query contains what looks like a GitHub token. Remove it and try again. For private GitHub content, set GITHUB_TOKEN or run gh auth login instead.',
  openai: 'Refused: the query contains what looks like an OpenAI API key. Remove it and try again.',
  anthropic: 'Refused: the query contains what looks like an Anthropic API key. Remove it and try again.',
  aws: 'Refused: the query contains what looks like AWS credentials. Remove them and try again.',
  slack: 'Refused: the query contains what looks like a Slack token. Remove it and try again.',
  stripe: 'Refused: the query contains what looks like a Stripe key. Remove it and try again.',
  google: 'Refused: the query contains what looks like a Google API key. Remove it and try again.',
  npm: 'Refused: the query contains what looks like an npm token. Remove it and try again.',
  'private-key': 'Refused: the query contains what looks like a private key. Remove it and try again.',
  assignment: 'Refused: the query contains what looks like a password or token. Remove it and try again.',
  'url-password': 'Refused: the query contains a password in a URL. Remove it and try again.'
};

export function refusalMessage(kind: SecretKind): string {
  return messages[kind];
}

export function secretRefusal(match: SecretMatch): WebExploreResponse {
  return {
    status: 'error',
    findings: [],
    sources: [],
    error: { code: 'SECRET_IN_QUERY', message: refusalMessage(match.kind) }
  };
}
