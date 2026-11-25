/* global api, getConfig, fetchFileBase64, upvanceExtractJob, upvanceExtractRecruiter, upvanceFillForm */
const $ = (id) => document.getElementById(id);
let lastAppId = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function show(el, html) {
  el.innerHTML = html;
  el.classList.remove("hidden");
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function runInPage(func, args = []) {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("Open a normal web page first.");
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return res.result;
}
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Working…";
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function init() {
  const { appUrl } = await getConfig();
  try {
    const ping = await api("/api/extension/ping");
    $("conn").textContent = "connected";
    $("conn").className = "pill ok";
    for (const r of ping.ready) {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = `${r.title} – ${r.company}`;
      $("readyList").appendChild(o);
    }
    if (ping.prepareOnOpen) show($("notice"), "“Prepare applications for jobs I open” is ON (change in Upvance → Settings).");
  } catch (e) {
    $("conn").textContent = "not connected";
    $("conn").className = "pill bad";
    show($("notice"), `${esc(e.message)}<br><a href="options.html" target="_blank">Open options</a> · app: ${esc(appUrl)}`);
  }
  const tab = await activeTab();
  if (tab && /linkedin\.com\/in\//.test(tab.url || "")) $("recruiter").classList.add("primary");
}

$("analyse").addEventListener("click", () =>
  busy($("analyse"), async () => {
    const out = $("result");
    try {
      const job = await runInPage(upvanceExtractJob);
      if (!job.title || job.description.length < 50) throw new Error("Couldn't find a job posting on this page.");
      const r = await api("/api/extension/job", { method: "POST", body: job });
      const { appUrl } = await getConfig();
      const cls = r.eligibility === "Eligible" ? "good" : r.eligibility === "Ineligible" ? "bad" : "warn";
      show(
        out,
        `<div class="result">
          <div><span class="score">${r.score ?? "–"}</span> <span class="badge ${cls}">${esc(r.band ?? "")}</span> <span class="badge ${cls}">${esc(r.eligibility)}</span></div>
          <div><b>${esc(r.title)}</b> · ${esc(r.company)}</div>
          <div><span class="badge">Sponsorship: ${esc(r.sponsorship)}</span><span class="badge">${esc(r.remote)}</span></div>
          ${r.reasons.length ? `<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          ${r.whyMatch.length ? `<ul>${r.whyMatch.map((x) => `<li class="ok">${esc(x)}</li>`).join("")}</ul>` : ""}
          <div class="muted">${esc(r.atsSupport.note)}</div>
          ${r.prepared ? `<div class="ok">${esc(r.prepared)}</div>` : ""}
          ${r.aiNote ? `<div class="muted">AI: ${esc(r.aiNote)}</div>` : ""}
          ${
            r.application
              ? `<a class="open" target="_blank" href="${appUrl}/applications/${r.application.id}">Open application (${esc(r.application.status)}) →</a>`
              : r.atsSupport.level !== "unsupported"
                ? `<button id="prepare" class="primary">Prepare application</button>`
                : ""
          }
          <div><a class="open" target="_blank" href="${appUrl}/jobs/${r.jobId}">Full analysis in Upvance →</a></div>
        </div>`,
      );
      const prep = $("prepare");
      if (prep)
        prep.addEventListener("click", () =>
          busy(prep, async () => {
            try {
              const p = await api("/api/extension/prepare", { method: "POST", body: { jobId: r.jobId } });
              prep.outerHTML = `<a class="open" target="_blank" href="${appUrl}/applications/${p.applicationId}">Prepared – ${esc(p.status)}. Review in Upvance →</a>`;
            } catch (e) {
              prep.insertAdjacentHTML("afterend", `<div class="error">${esc(e.message)}</div>`);
            }
          }),
        );
    } catch (e) {
      show(out, `<div class="error">${esc(e.message)}</div>`);
    }
  }),
);

$("fill").addEventListener("click", () =>
  busy($("fill"), async () => {
    const out = $("fillResult");
    try {
      const tab = await activeTab();
      const chosen = $("readyList").value;
      const pkg = await api(`/api/extension/package?${chosen ? `applicationId=${encodeURIComponent(chosen)}` : `url=${encodeURIComponent(tab.url)}`}`);
      if (pkg.warning && !confirm(pkg.warning)) return;
      const files = { resume: await fetchFileBase64(pkg.resumePath), cover: pkg.coverLetterPath ? await fetchFileBase64(pkg.coverLetterPath) : null };
      const r = await runInPage(upvanceFillForm, [pkg, files]);
      lastAppId = pkg.applicationId;
      show(
        out,
        `<div class="result">
          <div class="ok">Filled ${r.filled.length} field(s) for <b>${esc(pkg.job.title)}</b>. Highlighted in purple.</div>
          ${r.missed.length ? `<div>Please fill yourself:</div><ul>${r.missed.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
          <div class="muted">Check every field, answer any custom questions, then click the employer's Submit button yourself.</div>
        </div>`,
      );
      $("submitted").classList.remove("hidden");
    } catch (e) {
      show(out, `<div class="error">${esc(e.message)}</div>`);
    }
  }),
);

$("submitted").addEventListener("click", () =>
  busy($("submitted"), async () => {
    if (!lastAppId) return;
    if (!confirm("Confirm you clicked Submit on the employer's site and the application went through?")) return;
    try {
      await api("/api/extension/submitted", { method: "POST", body: { applicationId: lastAppId, confirmed: true } });
      show($("fillResult"), `<div class="ok">Recorded as submitted in your tracker. Good luck!</div>`);
      $("submitted").classList.add("hidden");
    } catch (e) {
      show($("fillResult"), `<div class="error">${esc(e.message)}</div>`);
    }
  }),
);

$("recruiter").addEventListener("click", () =>
  busy($("recruiter"), async () => {
    const out = $("recruiterResult");
    try {
      const r = await runInPage(upvanceExtractRecruiter);
      if (!r.name) throw new Error("Couldn't find a name on this page. Use Upvance → Recruiter outreach to paste details.");
      const name = prompt("Recruiter name", r.name);
      if (!name) return;
      const role = prompt("Role you're asking about (optional)", "") || undefined;
      const d = await api("/api/extension/recruiter", { method: "POST", body: { ...r, name, role } });
      show(
        out,
        `<div class="result">
          <div>Draft for <b>${esc(name)}</b> (${esc(d.generator)}) · resume: ${esc(d.resume)}</div>
          <textarea id="msg">${esc(d.message)}</textarea>
          <button id="copy">Copy message</button>
          <div class="muted">Paste it into LinkedIn and send it yourself. Then mark it as sent in Upvance → Recruiter outreach.</div>
          ${d.note ? `<div class="muted">${esc(d.note)}</div>` : ""}
        </div>`,
      );
      $("copy").addEventListener("click", async () => {
        await navigator.clipboard.writeText($("msg").value);
        $("copy").textContent = "Copied ✓";
      });
    } catch (e) {
      show(out, `<div class="error">${esc(e.message)}</div>`);
    }
  }),
);

init();
