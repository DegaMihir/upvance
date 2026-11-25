/**
 * Local mock employer application sites for testing the apply engine.
 * Nothing here talks to the internet; submissions are recorded in memory.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Submission {
  jobId: string;
  fields: Record<string, string>;
  files: string[];
}

export interface MockAts {
  url: string;
  submissions: Submission[];
  codesSent: { email: string; code: string }[];
  onCodeSent?: (email: string, code: string) => Promise<void> | void;
  close: () => Promise<void>;
}

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

function form(jobId: string, extra = "") {
  return page(
    "Apply – Mock Co",
    `<h1>Apply: ML Engineer</h1>
<form method="post" action="/apply/${jobId}" enctype="multipart/form-data">
  <label for="first_name">First Name *</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last Name *</label><input id="last_name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  <label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin">
  <label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required>
  <label for="auth">Are you legally authorized to work in the United Kingdom? *</label>
  <select id="auth" name="auth" required><option value="">Select...</option><option>Yes</option><option>No</option></select>
  <fieldset><legend>Will you now or in the future require visa sponsorship? *</legend>
    <label><input type="radio" name="sponsorship" value="yes" required> Yes</label>
    <label><input type="radio" name="sponsorship" value="no"> No</label>
  </fieldset>
  <label for="gender">Gender (voluntary)</label>
  <select id="gender" name="gender"><option value="">Select...</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select>
  ${extra}
  <label><input type="checkbox" name="privacy" required> I have read and agree to the privacy notice *</label>
  <label><input type="checkbox" name="marketing"> Contact me about future jobs</label>
  <button type="submit">Submit application</button>
</form>`,
  );
}

function parseMultipart(body: Buffer, contentType: string) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  const fields: Record<string, string> = {};
  const files: string[] = [];
  if (!boundary) return { fields, files };
  for (const part of body.toString("latin1").split(`--${boundary}`)) {
    const name = part.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const filename = part.match(/filename="([^"]*)"/)?.[1];
    const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
    if (filename !== undefined) {
      if (filename) files.push(`${name}:${filename}:${value.startsWith("%PDF") ? "pdf" : "other"}`);
    } else fields[name] = value;
  }
  return { fields, files };
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startMockAts(): Promise<MockAts> {
  const state: MockAts = { url: "", submissions: [], codesSent: [], close: async () => {} };
  const accounts = new Map<string, string>(); // jobId -> code
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const [, kind, id] = u.pathname.split("/");
    const send = (html: string, status = 200) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    };
    try {
      if (kind === "jobs") return send(page("Job – Mock Co", `<h1>ML Engineer</h1><p>Great job.</p><a href="/apply/${id}">Apply now</a>`));
      if (kind === "apply" && req.method === "GET") return send(form(id));
      if (kind === "apply" && req.method === "POST") {
        const { fields, files } = parseMultipart(await readBody(req), req.headers["content-type"] ?? "");
        state.submissions.push({ jobId: id, fields, files });
        return send(page("Thanks", `<h1>Thank you for applying!</h1><p>We have received your application.</p>`));
      }
      if (kind === "custom") return send(form(id, `<label for="ds">Describe your favourite data structure and why *</label><textarea id="ds" name="ds" required></textarea>`));
      if (kind === "captcha") return send(form(id, `<iframe src="/fake-recaptcha/anchor" title="reCAPTCHA" width="300" height="80"></iframe>`));
      if (kind === "fake-recaptcha") return send(page("captcha", "I'm not a robot"));
      if (kind === "account" && req.method === "GET")
        return send(page("Sign in – Mock Workday", `<h1>Create your candidate account</h1><form method="post" action="/account/${id}"><label for="em">Email Address</label><input id="em" name="email" type="email"><label for="pw">Password</label><input id="pw" name="password" type="password"><label for="pw2">Verify New Password</label><input id="pw2" name="password2" type="password"><button type="submit">Create Account</button></form>`));
      if (kind === "account" && req.method === "POST") {
        const body = new URLSearchParams((await readBody(req)).toString());
        const code = String(Math.floor(100000 + Math.random() * 899999));
        accounts.set(id, code);
        state.codesSent.push({ email: body.get("email") ?? "", code });
        await state.onCodeSent?.(body.get("email") ?? "", code);
        return send(page("Verify", `<h1>Check your email</h1><form method="post" action="/verify/${id}"><label for="vc">Verification code</label><input id="vc" name="code"><button type="submit">Verify</button></form>`));
      }
      if (kind === "verify" && req.method === "POST") {
        const body = new URLSearchParams((await readBody(req)).toString());
        if (body.get("code") !== accounts.get(id)) return send(page("Wrong code", `<p role="alert">That code is wrong.</p>`), 400);
        res.writeHead(302, { location: `/apply/${id}` });
        return res.end();
      }
      send("not found", 404);
    } catch (e) {
      send(String(e), 500);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((r) => server.close(() => r()));
  return state;
}
