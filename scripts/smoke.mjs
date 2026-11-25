// End-to-end smoke test against a RUNNING app (npm run dev or npm start).
// Signs in with the demo account and checks every page and API responds.
// Usage: npm run test:smoke
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const base = `http://localhost:${process.env.PORT || 3100}`;
const jar = new Map();

function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
const cookieHeader = () => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
async function req(p, init = {}) {
  const res = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie: cookieHeader(), ...(init.headers ?? {}) } });
  storeCookies(res);
  return res;
}

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` – ${extra}` : ""}`);
  if (!ok) failures++;
};

try {
  const health = await req("/api/health");
  check("health endpoint", health.ok);
} catch {
  console.error(`✗ Can't reach ${base}. Start the app first (npm run dev).`);
  process.exit(1);
}

const csrf = await (await req("/api/auth/csrf")).json();
const login = await req("/api/auth/callback/credentials", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: "demo@upvance.local", password: "demo12345", callbackUrl: `${base}/dashboard` }),
});
check("sign in (demo account)", [302, 303].includes(login.status) && [...jar.keys()].some((k) => k.includes("session-token")), `status ${login.status}`);

const pages = ["/dashboard", "/jobs", "/jobs?countries=GB,DE&workplace=remote,hybrid&sponsorship=1&noClearance=1", "/apply-queue", "/inbox", "/inbox?tab=Interview", "/sheet", "/jobs?eligibility=all&sponsorship=required&remote=remote", "/discover", "/applications", "/applications?tab=needs-you", "/profile", "/searches", "/outreach", "/companies", "/insights", "/analytics", "/visa", "/visa/gb", "/sponsors", "/settings", "/manifest.webmanifest"];
for (const p of pages) {
  const r = await req(p);
  const body = await r.text();
  check(`GET ${p}`, r.status === 200 && !/Application error|Unhandled Runtime Error/.test(body), `status ${r.status}`);
}

const jobsHtml = await (await req("/jobs?eligibility=all")).text();
const jobId = jobsHtml.match(/href="\/jobs\/([a-z0-9]{20,})"/)?.[1];
if (jobId) {
  const r = await req(`/jobs/${jobId}`);
  check("job detail page", r.status === 200);
}
const appsHtml = await (await req("/applications")).text();
const appId = appsHtml.match(/href="\/applications\/([a-z0-9]{20,})"/)?.[1];
if (appId) {
  check("application page", (await req(`/applications/${appId}`)).status === 200);
  const pdf = await req(`/api/resume/${appId}?format=pdf`);
  check("resume PDF export", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf");
  const docx = await req(`/api/resume/${appId}?format=docx`);
  check("resume DOCX export", docx.status === 200 && (docx.headers.get("content-type") ?? "").includes("wordprocessingml"));
}
const csv = await req("/api/export/applications");
check("applications CSV export", csv.status === 200 && (await csv.text()).replace(/^﻿/, "").startsWith("created,"));
const unauth = await fetch(`${base}/api/extension/ping`);
check("extension API rejects unpaired requests", unauth.status === 401);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll smoke checks passed.");
process.exit(failures ? 1 : 0);
