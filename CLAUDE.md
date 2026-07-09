# CLAUDE.md

This file provides guidance when working in this repository.

---

## Status

This repo is a standalone WXT Manifest V3 TypeScript extension for saving the active browser tab's visible job posting into the Job Tracker API.

Current foundation:

- WXT project at the repo root with popup, options, and background entrypoints.
- Runtime message validation with Zod.
- User-triggered active-tab extraction through `chrome.scripting.executeScript`.
- Settings persisted in `chrome.storage.local` for API base URL, API key, and auto-detect preference.
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

- **Endpoint:** `POST /api/scrape` on the Next.js app (default `http://localhost:3000`), header `Authorization: Bearer <API_KEY>`.
- **Required fields:** `source_platform` (enum: `linkedin|indeed|glassdoor|dice|lever|greenhouse|workday|angellist|direct|other`), `external_job_id`, `company_name`, `job_title`, `job_link` (URL).
- **Response:** always `{ action: 'created' | 'updated' | 'duplicate_skipped', job_id }`. Use `job_id` to render an "Open in Job Tracker" link to `{BASE_URL}/jobs/{job_id}`.
- **Auth probe:** `GET /api/health/auth` returns `{ ok: true }` when the configured bearer key is accepted and `401 { error: 'Unauthorized' }` when rejected.
- **Tags:** `skills`, `software`, `keywords`, `certifications` arrays default to `[]`. Prefer sending `job_description` and leaving `skills` empty/omitted so the server can run NLP extraction.
- **Omit `posting_md_path`:** that field belongs to the Python scraper, which writes markdown files into a shared `postings/` volume the extension cannot access.
- **Salary:** annual salaries are integer cents (`salary_min`/`salary_max`); hourly rates are decimal dollars (`hourly_rate_min`/`hourly_rate_max`), with `salary_type: 'annual' | 'hourly'`. When unsure how to parse, send `salary_text` and omit numeric fields.
- **Google Jobs:** map detected Google Jobs pages to `source_platform: 'other'` until the backend enum adds `google` (tracked as API-010).
- **Dedup is server-authoritative:** the extension needs no local dedup.

---

## Security Boundaries

- Keep API keys in extension/background/settings context only; never pass them into page-injected extraction functions.
- Use `activeTab` + user-triggered script execution for page reads. Avoid broad persistent host permissions unless a specific feature requires them.
- Render scraped values as text, never as HTML.
- Do not execute remote code or page-provided scripts.
- Keep extension settings and scraped payloads out of logs unless redacted.

---

## Workspace Context

This repo is one of three in the `job_tracker` workspace; see `../CLAUDE.md` for the cross-project picture. Design docs and task tracking live in the Obsidian vault at `../.obsidian/`.
