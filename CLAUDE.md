# CLAUDE.md

This file provides guidance when working in this repository.

---

## Obsidian Vault Location

The shared project vault is the parent workspace at `C:\Users\Jimmy\Documents\Projects\job_tracker`. Project notes, task boards, provider documentation, and handoffs are stored under `C:\Users\Jimmy\Documents\Projects\job_tracker\.obsidian` (from this repository: `../.obsidian/`). Read and update that shared vault rather than creating a repository-local vault.

---

## Status

This repo is a standalone WXT Manifest V3 TypeScript extension for saving the active browser tab's visible job posting into the Job Tracker API.

Current foundation:

- WXT project at the repo root with popup, options, and background entrypoints.
- Runtime message validation with Zod.
- User-triggered active-tab extraction through `chrome.scripting.executeScript`.
- Settings persisted in `chrome.storage.local` for API base URL, Authentik OAuth client settings/tokens, and auto-detect preference.
- Background save flow posts validated payloads to `POST /api/scrape`.
- Starter HTML fixtures live under `fixtures/html/`.
- Quality command: `npm run quality`.

Build output is generated under `.output/` and should not be treated as source.

---

## Common Commands

```bash
npm run dev
npm run quality
npm run build
npm run zip
```

`npm run quality` runs Prettier check, ESLint, TypeScript compile, Vitest, and WXT build.

---

## The API Contract

Documented in the workspace vault at `../.obsidian/App/API Reference.md`; implemented at `../job-tracker-nextjs/src/app/api/scrape/route.ts` with the Zod schema in `../job-tracker-nextjs/src/lib/schemas.ts`.

- **Endpoint:** `POST /api/scrape` on the Next.js app (default `http://localhost:3000`), header `Authorization: Bearer <OAuth2 access token>`.
- **Required fields:** `source_platform` (enum: `linkedin|indeed|glassdoor|dice|lever|greenhouse|workday|angellist|direct|other|google`), `external_job_id`, `company_name`, `job_title`, `job_link` (URL).
- **Response:** always `{ action: 'created' | 'updated' | 'duplicate_skipped', job_id }`. Use `job_id` to render an "Open in Job Tracker" link to `{BASE_URL}/jobs/{job_id}`.
- **Auth probe:** `GET /api/health/auth` returns `{ ok: true }` when the Authentik-issued bearer token is accepted and `401 { error: 'Unauthorized' }` when rejected.
- **Taxonomies (never "tags"):** `skills`, `software`, `certifications`, and `keywords` are four independent, category-owned arrays — there is no generic tags field anywhere in the extension. The extension derives low-confidence matches from the selected sanitized `job_description` using the checked-in canonical catalog (`src/lib/extraction/taxonomyCatalog.ts`, generated from the backend's `nlp-extract.ts` via `npm run sync:catalog`; `CATALOG_HASH`/`CATALOG_VERSION` are verified by tests, no runtime API dependence). Credentials stay in `certifications`, named tools/platforms in `software`, capabilities/methods in `skills`, and contextual labels (e.g. `remote`) in `keywords`, which may deliberately repeat a skill. Precedence per category: structured provider values first (e.g. Dice skills section, Lever department), then description-derived matches appended; case-insensitive dedup and the 100-entry cap apply within a category only, never across categories, and empty arrays are omitted from payloads. Re-extract merges per category instead of overwriting user edits. The server still runs its additive recovery pass for every non-blank description.
- **JSON-LD export mapping (reviewed):** `skills` → JobPosting `skills` (string array); `certifications` → `qualifications` as `EducationalOccupationalCredential` objects; `software` and `keywords` are explicitly omitted (JobPosting has no faithful property for them) and are never silently serialized as `skills`.
- **Omit `posting_md_path`:** that field belongs to the Python scraper, which writes markdown files into a shared `postings/` volume the extension cannot access.
- **Salary:** annual salaries are integer cents (`salary_min`/`salary_max`); hourly rates are decimal dollars (`hourly_rate_min`/`hourly_rate_max`), with `salary_type: 'annual' | 'hourly'`. When unsure how to parse, send `salary_text` and omit numeric fields.
- **Google Jobs:** detected Google Jobs pages map to `source_platform: 'google'` (backend enum updated in API-010, deployed 2026-07-10).
- **Dedup is server-authoritative:** the extension needs no local dedup.

---

## Security Boundaries

- Keep OAuth tokens in extension/background/settings context only; never pass them into page-injected extraction functions.
- Use Authentik authorization-code + PKCE through `chrome.identity`; do not store a client secret in the extension.
- Use `activeTab` + user-triggered script execution for page reads. Avoid broad persistent host permissions unless a specific feature requires them.
- Render scraped values as text, never as HTML.
- Do not execute remote code or page-provided scripts.
- Keep extension settings and scraped payloads out of logs unless redacted.

---

## Workspace Context

This repo is one of three in the `job_tracker` workspace; see `../CLAUDE.md` for the cross-project picture. Design docs and task tracking live in the Obsidian vault at `../.obsidian/`.
