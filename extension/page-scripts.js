// Functions injected into the page the USER is viewing, only when the user clicks a button.
// They read what's visible on the page or fill form fields. They never click Submit.

/* Reads the job posting currently on screen. */
function upvanceExtractJob() {
  const text = (el) => (el ? el.innerText.replace(/\s+\n/g, "\n").trim() : "");
  const pick = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && text(el)) return text(el);
    }
    return "";
  };
  const out = { url: location.href, title: "", company: "", location: "", description: "", applyUrl: "", easyApply: false, postedAt: undefined };

  // 1) Structured data (most company career pages and ATSs)
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : data["@graph"] || [data];
      const jp = items.find((i) => i && (i["@type"] === "JobPosting" || (Array.isArray(i["@type"]) && i["@type"].includes("JobPosting"))));
      if (jp) {
        const div = document.createElement("div");
        div.innerHTML = (jp.description || "").replace(/(<\/(p|li|h[1-6])>|<br\s*\/?>)/gi, "$1\n");
        out.title = jp.title || "";
        out.company = (jp.hiringOrganization && jp.hiringOrganization.name) || "";
        const locs = [].concat(jp.jobLocation || []).map((l) => (l.address ? [l.address.addressLocality, l.address.addressRegion, typeof l.address.addressCountry === "string" ? l.address.addressCountry : l.address.addressCountry && l.address.addressCountry.name].filter(Boolean).join(", ") : "")).filter(Boolean);
        out.location = [jp.jobLocationType === "TELECOMMUTE" ? "Remote" : "", locs.join("; ")].filter(Boolean).join(" – ");
        out.description = div.innerText.trim();
        out.postedAt = jp.datePosted;
        break;
      }
    } catch (e) {}
  }

  const host = location.hostname;
  // 2) LinkedIn job view (visible content only)
  if (/linkedin\.com$/.test(host)) {
    out.title = out.title || pick([".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", "h1"]);
    out.company = out.company || pick([".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name"]);
    out.location = out.location || pick([".job-details-jobs-unified-top-card__primary-description-container span", ".jobs-unified-top-card__bullet", ".job-details-jobs-unified-top-card__tertiary-description-container span"]);
    out.description = out.description || pick(["#job-details", ".jobs-description__content", ".jobs-box__html-content"]);
    const buttons = Array.from(document.querySelectorAll("button, a"));
    out.easyApply = buttons.some((b) => /easy apply/i.test(b.innerText || ""));
    const ext = buttons.find((b) => b.tagName === "A" && /apply/i.test(b.innerText || "") && b.href && !/linkedin\.com/.test(b.href));
    if (ext) out.applyUrl = ext.href;
  }
  // 3) Indeed
  if (/indeed\./.test(host)) {
    out.title = out.title || pick(['[data-testid="jobsearch-JobInfoHeader-title"]', "h1"]);
    out.company = out.company || pick(['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]']);
    out.location = out.location || pick(['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]']);
    out.description = out.description || pick(["#jobDescriptionText"]);
  }
  // 4) Generic fallback
  out.title = out.title || pick(["h1"]) || document.title;
  out.company = out.company || (document.querySelector('meta[property="og:site_name"]') || {}).content || host.replace(/^www\./, "").split(".")[0];
  out.description = out.description || pick(["main", "article", '[class*="description"]', "body"]).slice(0, 30000);
  if (!out.applyUrl && !/linkedin\.com$|indeed\./.test(host)) out.applyUrl = location.href;
  out.title = out.title.split("\n")[0].slice(0, 290);
  out.company = out.company.split("\n")[0].slice(0, 190);
  out.location = out.location.split("\n")[0].slice(0, 290);
  return out;
}

/* Reads a recruiter's visible name / headline / company from a profile page. */
function upvanceExtractRecruiter() {
  const t = (s) => {
    const el = document.querySelector(s);
    return el ? el.innerText.trim() : "";
  };
  const name = t("h1");
  const headline = t(".text-body-medium.break-words") || t('[data-generated-suggestion-target]') || "";
  let company = t('button[aria-label^="Current company"]') || t(".pv-text-details__right-panel span") || "";
  if (!company) {
    const m = headline.match(/\b(?:at|@)\s+(.+)$/i);
    if (m) company = m[1];
  }
  const title = headline.replace(/\s+(?:at|@)\s+.+$/i, "").split("|")[0].trim();
  return { name: name.split("\n")[0], title, company: company.split("\n")[0].replace(/^Current company:\s*/i, ""), profileUrl: location.href.split("?")[0] };
}

/* Fills the employer form on screen from the approved package. Never submits. */
function upvanceFillForm(pkg, files) {
  const filled = [];
  const missed = [];
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const labelFor = (el) => {
    const parts = [];
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(l.innerText);
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.innerText);
    parts.push(el.getAttribute("aria-label") || "", el.placeholder || "", el.name || "", el.id || "", el.getAttribute("data-automation-id") || "");
    const lb = el.getAttribute("aria-labelledby");
    if (lb) lb.split(/\s+/).forEach((id) => { const x = document.getElementById(id); if (x) parts.push(x.innerText); });
    const field = el.closest('[class*="field"], [class*="question"], fieldset, .form-group, li, div');
    if (field && parts.join("").length < 4) parts.push((field.innerText || "").slice(0, 200));
    return norm(parts.join(" "));
  };
  const setValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #7C3AED";
    el.style.outlineOffset = "1px";
  };
  const f = pkg.fields;
  const rules = [
    [/\bfirst name\b|\bgiven name\b|^first$|fname/, f.firstName],
    [/\blast name\b|\bsurname\b|\bfamily name\b|lname/, f.lastName],
    [/\bfull name\b|^name$|\byour name\b|legal name/, f.fullName],
    [/e ?mail/, f.email],
    [/phone|mobile|telephone/, f.phone],
    [/linkedin/, f.linkedin],
    [/website|portfolio|github|personal site|url/, f.website],
    [/\bcity\b/, f.city],
    [/\bcountry\b/, f.country],
    [/location|address|where are you based/, f.location],
    [/current (job )?title|job title/, f.currentTitle],
    [/current (company|employer)|employer/, f.currentCompany],
  ];
  const answerRules = [
    [/authori[sz]ed|legally (able|eligible)|right to work|work permit/, "work-auth"],
    [/sponsor/, "sponsorship"],
    [/relocat/, "relocation"],
    [/salary|compensation|pay expectation/, "salary"],
    [/notice|start date|available to start|availability/, "notice"],
    [/years of (relevant )?experience/, "experience"],
  ];
  const answer = (id) => (pkg.answers.find((a) => a.id === id) || {}).answer;

  const inputs = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const type = (el.type || "").toLowerCase();
    return !el.disabled && !el.readOnly && !["hidden", "submit", "button", "checkbox", "radio", "image", "reset", "password"].includes(type) && el.offsetParent !== null;
  });
  for (const el of inputs) {
    const label = labelFor(el);
    if (!label) continue;
    if (el.type === "file") continue;
    if (el.value && el.value.trim()) continue; // never overwrite what's there
    let value = null;
    if (/cover letter|coverletter|motivation/.test(label) && el.tagName === "TEXTAREA") value = pkg.coverLetter;
    if (value == null) for (const [re, v] of answerRules) if (re.test(label)) { value = answer(v); break; }
    if (value == null) for (const [re, v] of rules) if (re.test(label)) { value = v; break; }
    if (!value) {
      if (el.required || /\*/.test(label)) missed.push(label.slice(0, 80));
      continue;
    }
    if (el.tagName === "SELECT") {
      const want = norm(value);
      const opt = Array.from(el.options).find((o) => norm(o.text) === want) || Array.from(el.options).find((o) => norm(o.text).startsWith(want.split(" ")[0]) && want.length > 1);
      if (!opt) { missed.push(label.slice(0, 80)); continue; }
      setValue(el, opt.value);
    } else setValue(el, value);
    filled.push(label.slice(0, 60));
  }

  // Documents
  const toFile = (f) => {
    const bin = atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name, { type: f.type });
  };
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  for (const el of fileInputs) {
    const label = labelFor(el);
    let file = null;
    if (/cover/.test(label) && files.cover) file = files.cover;
    else if (/resume|cv|curriculum/.test(label) || fileInputs.length === 1) file = files.resume;
    if (!file || (el.files && el.files.length)) continue;
    try {
      const dt = new DataTransfer();
      dt.items.add(toFile(file));
      el.files = dt.files;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled.push(/cover/.test(label) ? "cover letter (file)" : "resume (file)");
    } catch (e) {
      missed.push("file upload: " + label.slice(0, 40));
    }
  }
  return { filled, missed: Array.from(new Set(missed)).slice(0, 15) };
}
