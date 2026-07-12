import { extractJobDraft } from '../src/lib/extraction/jobDraftExtractor';
import { JOB_DRAFT_EXTRACTOR_BRIDGE_KEY } from '../src/lib/extraction/jobDraftExtractorBridge';

export default defineContentScript({
  // No `matches`: this script is never auto-injected by the manifest and
  // adds nothing to `host_permissions`. It is only ever loaded on demand via
  // `browser.scripting.executeScript({ files: [...] })`, scoped to whatever
  // tab the user already granted `activeTab` access to.
  registration: 'runtime',
  main() {
    (window as unknown as Record<string, unknown>)[
      JOB_DRAFT_EXTRACTOR_BRIDGE_KEY
    ] = extractJobDraft;
  },
});
