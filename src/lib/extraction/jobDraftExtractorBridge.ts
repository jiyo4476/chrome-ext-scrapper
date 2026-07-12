// `chrome.scripting.executeScript({ func })` stringifies the function and
// re-runs it with no access to the extension's module scope, so it cannot
// see top-level imports like `dompurify`/`turndown`. The content-script
// entrypoint (`entrypoints/content.ts`) is injected as a real bundled file
// instead, and parks `extractJobDraft` under this key on the page's
// isolated-world `window` so a follow-up `func` call -- which shares that
// same isolated world -- can invoke it with the per-call `detection` args.
export const JOB_DRAFT_EXTRACTOR_BRIDGE_KEY = '__jobTrackerExtractJobDraft';
