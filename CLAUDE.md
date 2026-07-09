# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Status

**No extension code yet.** This repo contains only `.gitignore`, `LICENSE`, and agent scaffolding (`.agents/`, `.claude/`). It is the planned home of a Chrome extension that captures a job posting from the active tab and POSTs it to the existing job tracker API. Do not assume a build system, framework, or file layout — none has been chosen.

---

## The API Contract (settled — build against this)

Documented in the workspace vault at `../.obsidian/App/API Reference.md`; implemented at `../job-tracker-nextjs/src/app/api/scrape/route.ts` with the Zod schema in `../job-tracker-nextjs/src/lib/schemas.ts`.

- **Endpoint:** `POST /api/scrape` on the Next.js app (default `http://localhost:3000`), header `Authorization: Bearer <API_KEY>`.
- **Required fields:** `source_platform` (enum: `linkedin|indeed|glassdoor|dice|lever|greenhouse|workday|angellist|direct|other`), `external_job_id`, `company_name`, `job_title`, `job_link` (URL).
- **Response:** always `{ action: 'created' | 'updated' | 'duplicate_skipped', job_id }`. `duplicate_skipped` returns the *existing* job's id. Use `job_id` to render an "Open in Job Tracker" link to `{BASE_URL}/jobs/{job_id}`.
- **Tags:** `skills`, `software`, `keywords`, `certifications` arrays default to `[]`. Do **not** extract tags client-side — send `job_description` and leave `skills` empty/omitted; the server runs NLP extraction when `skills` is empty and `job_description` is present.
- **Omit `posting_md_path`:** that field belongs to the Python scraper, which writes markdown files into a shared `postings/` volume the extension cannot access.
- **Salary:** annual salaries are integer **cents** (`salary_min`/`salary_max`); hourly rates are decimal dollars (`hourly_rate_min`/`hourly_rate_max`), with `salary_type: 'annual' | 'hourly'`. When unsure how to parse, send `salary_text` (raw string) and omit the numeric fields.
- **Dedup is server-authoritative:** `UNIQUE(external_job_id, source_platform)` plus a 7-day fuzzy match on `(company, title)`. The extension needs no local dedup.
- **Auth probe:** a `GET /api/health/auth` endpoint for validating a configured API key from the extension's settings UI is planned but **not yet built** (task API-009: `../.obsidian/Tasks/API-009 Auth health check endpoint.md`). Until it exists there is no safe auth probe.

---

## Workspace Context

This repo is one of three in the `job_tracker` workspace — see `../CLAUDE.md` for the cross-project picture. Design docs and task tracking live in the Obsidian vault at `../.obsidian/`.
