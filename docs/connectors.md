# Job board connectors

Every connector calls only the **public endpoint the board's own careers page uses** to load its jobs. No logins, no private APIs, no CAPTCHA bypassing. Requests are read-only, rate-limited (max 3–4 parallel requests per board with a short pause, at most `BOARD_MAX_JOBS` jobs per board, default 150) and identify themselves with a `UpvanceLocal/1.0` user agent.

Code: `src/lib/sources/index.ts` (Greenhouse, Lever, Ashby, Remotive, Remote OK, Arbeitnow, Adzuna, Google Jobs, pasted URLs) and `src/lib/sources/boards.ts` (everything below).

| Board | Board URL you paste | Board id ("slug") |
|---|---|---|
| Gem | `https://jobs.gem.com/<board>` | `<board>` |
| Workable | `https://apply.workable.com/<account>/` | `<account>` |
| SmartRecruiters | `https://jobs.smartrecruiters.com/<Company>` | `<Company>` (case-sensitive) |
| Recruitee | `https://<company>.recruitee.com` | `<company>` |
| Personio | `https://<company>.jobs.personio.de` (or `.com`) | `<company>` |
| Teamtailor | `https://<company>.teamtailor.com` or a custom careers host | host |
| BambooHR | `https://<company>.bamboohr.com/careers` | `<company>` |
| Breezy HR | `https://<company>.breezy.hr` | `<company>` |
| JazzHR | `https://<company>.applytojob.com/apply` | `<company>` |
| Workday | `https://<tenant>.wdN.myworkdayjobs.com/<site>` | `tenant\|wdN\|site` |

---

## Gem – discovered with REA

**How it was found.** REA's `capture_browser_scenario` loaded `https://jobs.gem.com/nominal` and then the job page `https://jobs.gem.com/nominal/am9icG9zdDq-S-CZabzn1Br_Eg1-thRF` in Chromium with network request/response capture on. Of the page's 73 requests, the only job-data call was:

```
POST https://jobs.gem.com/api/public/graphql/batch
Content-Type: application/json
```

The request body is a JSON **array** of GraphQL operations (batched). Observed operations (decoded from the captured request bodies):

- `JobBoardList` – variables `{ "boardId": "<board>" }` – sent by the board page.
- `ExternalJobPosting` – variables `{ "boardId": "<board>", "extId": "<job id from the URL>" }` – sent by the job page.
- Also observed (not used by Upvance): `JobBoardTheme`, `OneClickApplyEnabled`, `OatsTeamSettingExternalPublic`, `OatsIsJobBoardSeoStructuredDataEnabled`, `FormAutofillData`, and a tracking call `POST /api/wpt` (403).

`https://jobs.gem.com/robots.txt` returns 404 (no rules). The job pages contain no JSON-LD, so the GraphQL endpoint is the only structured source.

**List query (subset Upvance sends):**

```graphql
query JobBoardList($boardId: String!) {
  oatsExternalJobPostings(boardId: $boardId) {
    jobPostings { id extId title locations { name city isoCountry isRemote } job { department { name } locationType employmentType } }
  }
  jobBoardExternal(vanityUrlPath: $boardId) { teamDisplayName pageTitle }
}
```

Response shape: `[{ "data": { "oatsExternalJobPostings": { "jobPostings": [ { "id": "T2F0c0pvYlBvc3Q6…", "extId": "37c9854b-…", "title": "Mission Operations Engineer", "locations": [{ "name": "Los Angeles, CA", "city": "Los Angeles", "isoCountry": "USA", "isRemote": false }], "job": { "department": { "name": "…" }, "locationType": "IN_OFFICE | HYBRID | REMOTE", "employmentType": "FULL_TIME | …" } } ] }, "jobBoardExternal": { "teamDisplayName": "Nominal" } } }]`. An unknown board returns `oatsExternalJobPostings: null` or a GraphQL error.

**Detail query:**

```graphql
query ExternalJobPosting($boardId: String!, $extId: String!) {
  oatsExternalJobPosting(boardId: $boardId, extId: $extId) {
    title descriptionHtml extId firstPublishedTsSec companyUrl
    locations { name city isoCountry isRemote }
    job { locationType employmentType teamDisplayName department { name } }
    jobPostSectionHtml { introHtml outroHtml }
    compensationHtml
  }
}
```

`isoCountry` is ISO-3166 alpha-3 (`USA`, `GBR`). `extId` accepts both the UUID from the list and the base64-style id used in shared links (as in the example URL). The page's job query also requests `oatsJobPostFieldsAndQuestions` (form fields, custom questions, EEO survey), which documents what the apply form asks.

**Apply URL:** `https://jobs.gem.com/<board>/<extId>` (the form is on the same page).

---

## Other boards (endpoints verified with live requests on 2026-11-15)

### Workable
`GET https://apply.workable.com/api/v1/widget/accounts/<account>?details=true` – the public widget feed. Shape: `{ name, description, jobs: [{ shortcode, title, employment_type, telecommuting, city, country, locations: [{city, country}], description, requirements, benefits, published_on, url, application_url }] }`. (The careers page itself uses `POST /api/v3/accounts/<account>/jobs` for lists and `GET /api/v2/accounts/<account>/jobs/<shortcode>` for details; the widget feed gives the same data in one request.) Apply: `https://apply.workable.com/<account>/j/<shortcode>/`.

### SmartRecruiters (official public Posting API)
List `GET https://api.smartrecruiters.com/v1/companies/<Company>/postings?limit=100` → `{ totalFound, content: [{ id, name, releasedDate, location: {city, country, remote, fullLocation}, typeOfEmployment: {label}, company: {name} }] }`. Detail `GET …/postings/<id>` adds `jobAd.sections.{companyDescription,jobDescription,qualifications,additionalInformation}.text`, `applyUrl`, `postingUrl`. Unknown companies return `totalFound: 0`.

### Recruitee (public offers API)
`GET https://<company>.recruitee.com/api/offers/` → `{ offers: [{ id, slug, title, description (HTML), requirements, location, city, country, remote, careers_url, careers_apply_url, published_at, employment_type_code, company_name }] }`.

### Personio (official XML feed)
`GET https://<company>.jobs.personio.de/xml` (or `.com`) → `<workzag-jobs><position><id/><office/><department/><name/><jobDescriptions><jobDescription><name/><value>(HTML, CDATA)</value></jobDescription></jobDescriptions><employmentType/><schedule/><createdAt/></position>…`. Some boards publish empty `jobDescriptions`; Upvance then reads the public job page `https://<company>.jobs.personio.de/job/<id>`.

### Teamtailor (public RSS feed)
`GET https://<host>/jobs.rss` → RSS 2.0 with `<item><title/><link/><guid/><pubDate/><description>(HTML)</description><tt:locations><tt:location><tt:city/><tt:country/></tt:location></tt:locations><remoteStatus/></item>`.

### BambooHR (careers JSON used by the careers page)
List `GET https://<company>.bamboohr.com/careers/list` → `{ meta: { totalCount }, result: [{ id, jobOpeningName, departmentLabel, employmentStatusLabel, location: {city, state}, atsLocation: {country}, isRemote }] }`. Detail `GET /careers/<id>/detail` → `{ result: { jobOpening: { description } } }`. Non-existent tenants redirect to bamboohr.com (HTML), which Upvance treats as "no board".

### Breezy HR (public JSON)
`GET https://<company>.breezy.hr/json` → `[{ id, friendly_id, name, url, published_date, type: {name}, location: {name, city, country: {name}, is_remote}, company: {name} }]`. Descriptions come from each public job page (`url`), parsed from its structured data.

### JazzHR
No JSON feed. The career page `https://<company>.applytojob.com/apply` lists job links `/apply/<id>/<title>`; each job page is parsed for its structured data. Inactive pages show "Inactive Career Page".

### Workday (cxs JSON used by Workday career sites)
List `POST https://<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` with body `{ "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }` → `{ total, jobPostings: [{ title, externalPath, locationsText, postedOn }] }` (max 20 per page). Detail `GET …/wday/cxs/<tenant>/<site><externalPath>` → `{ jobPostingInfo: { id, title, jobDescription (HTML), location, additionalLocations, timeType, startDate, externalUrl, country: {descriptor}, remoteType }, hiringOrganization: { name } }`. Applying on Workday needs an account (see Settings → application password).

### Greenhouse, Lever, Ashby (official public board APIs – unchanged)
`https://boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true`, `https://api.lever.co/v0/postings/<company>?mode=json`, `https://api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true`.

### Aggregators (optional keys in `.env`)
- **Adzuna** – `GET https://api.adzuna.com/v1/api/jobs/<country>/search/1?app_id&app_key&what` for each target country (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`).
- **Google Jobs via SerpApi** – `GET https://serpapi.com/search.json?engine=google_jobs&q=…&location=…&api_key=…` (`SERPAPI_KEY`). Results include `apply_options[].link`; Upvance prefers a link on a known applicant-tracking system so the job resolves to the original employer apply URL.

Aggregator jobs are deduplicated against board jobs by company + title + location; the board copy wins because it has the original apply link.

---

## Job sites added 2026-11-17

| Site | Endpoint used | robots.txt | Can Upvance apply? |
|---|---|---|---|
| **We Work Remotely** | Public RSS feeds `https://weworkremotely.com/remote-jobs.rss` (latest ~100) and `https://weworkremotely.com/categories/remote-programming-jobs.rss` (+ full-stack, back-end, devops categories). Item fields: `title` ("Company: Job title"), `region`, `type`, `description` (HTML), `pubDate`, `link`/`guid`. | `Allow: /` (only account pages disallowed) | Not on WWR itself: the "Apply" button links to `/job-seekers/account/register` for logged-out visitors (an account path that robots.txt disallows). Upvance looks for the same job on the employer's own board and applies there. |
| **Y Combinator jobs** | Role pages `https://www.ycombinator.com/jobs/role/<role>` and `/jobs/role/<role>/remote` embed the page data as JSON in `data-page` (Inertia, component `WaasJobListingsPage`, `props.jobPostings[]`: `id, title, url, location, type, salaryRange, minExperience, visa, companyName, createdAt`). Job pages `/companies/<co>/jobs/<id>` (component `WaasShowJobPage`) add `props.job.description` (Markdown) and `props.company.website`. | `Allow: /` (only `/verify`, `/library?…`, `/companies?…` query pages disallowed) | Not on YC itself: applying needs your own Work at a Startup account. Upvance looks for the same job on the employer's own board (YC companies mostly use Ashby, Greenhouse or Lever). |
| **Wellfound** | – | `/search` and `/_jobs/` are disallowed | **Not added.** Search pages are disallowed for tools and applying needs a Wellfound account. Use Wellfound yourself, then paste the employer's own job link, paste the job text, or use the Chrome extension on a job you're viewing. |
| Remotive, Remote OK, Lever | Already supported (see above). Lever has no global list of all companies – each company's board (`jobs.lever.co/<company>`) is added on Discover jobs → "Add a company". | | Lever: yes. Remotive / Remote OK: when the employer's apply link is found. |

**YC visa field** – values seen: `Will sponsor`, `US citizen/visa only`, `US citizenship/visa not required`. They are turned into plain sentences in the job text so the normal sponsorship analysis reads them (e.g. "We do not sponsor visas").

**Employer-board matching** (`onEmployerBoard` in `src/lib/sources/remote-boards.ts`): an ATS link in the text if there is one; otherwise the company's website (YC gives it) is checked for a careers/ATS link; otherwise a few name-based guesses on Ashby, Greenhouse, Lever and Workable. The job only counts as found when the title matches (`sameTitle`). Results are cached per run. In a live check, about 3 in 10 listings were found on the employer's board.

**Schedule:** the worker checks all four job sites for your target titles every 6 hours (`checkJobSites` in `src/lib/jobs/job-sites.ts`); the "Check job sites now" button on Discover jobs does the same at once. Only job titles that fit your target titles are kept, and at most 40 listings per run are looked up on employer boards.
