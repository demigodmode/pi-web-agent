import type { PresentationEnvelope, PresentationMode } from './types.js';

export function selectPresentationView(
  envelope: PresentationEnvelope | undefined,
  requestedMode: PresentationMode
): string | undefined {
  if (!envelope) {
    return undefined;
  }

  if (requestedMode === 'preview' && envelope.views.preview) {
    return envelope.views.preview;
  }

  if (requestedMode === 'verbose' && envelope.views.verbose) {
    return envelope.views.verbose;
  }

  return envelope.views.compact;
}
