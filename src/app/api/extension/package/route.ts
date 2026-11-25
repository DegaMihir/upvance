import { db } from "@/lib/db";
import { extensionHandler, json, options } from "@/lib/extension-api";
import { canonicalizeUrl } from "@/lib/text";
import { parseJson } from "@/lib/utils";
import { countryName } from "@/lib/countries";
import type { ScreeningAnswer } from "@/lib/writing/screening";

export const OPTIONS = options;

/**
 * The "prepared package" the extension uses to fill an employer form.
 * Looked up by application id, or by the URL of the form the user is on.
 */
export const GET = extensionHandler(async (req, userId) => {
  const url = new URL(req.url);
  const appId = url.searchParams.get("applicationId");
  const pageUrl = url.searchParams.get("url");
  let app = appId
    ? await db.application.findFirst({ where: { id: appId, userId }, include: { job: { include: { company: true } }, profile: true } })
    : null;
  if (!app && pageUrl) {
    const canon = canonicalizeUrl(pageUrl);
    const candidates = await db.application.findMany({
      where: { userId, status: { in: ["Ready", "Needs you", "Preparing"] } },
      include: { job: { include: { company: true } }, profile: true },
      orderBy: { updatedAt: "desc" },
    });
    app = candidates.find((a) => {
      const apply = canonicalizeUrl(a.job.applyUrl);
      const source = canonicalizeUrl(a.job.sourceUrl);
      return !!apply && (canon === apply || canon === source || canon.startsWith(apply) || apply.startsWith(canon));
    }) ?? null;
  }
  if (!app) return json(req, { error: "No prepared application matches this page. Pick one from the list in the extension popup." }, 404);
  if (!["Ready", "Needs you"].includes(app.status)) return json(req, { error: `This application is “${app.status}”.` }, 409);

  const p = app.profile;
  const [firstName, ...rest] = p.fullName.trim().split(/\s+/);
  const city = p.location.split(",")[0]?.trim() ?? "";
  const answers = parseJson<ScreeningAnswer[]>(app.screeningAnswers, []);
  return json(req, {
    applicationId: app.id,
    status: app.status,
    warning: app.status === "Needs you" ? "This application still needs your attention in Upvance – fill only if you're sure." : null,
    job: { title: app.job.title, company: app.job.company.name, applyUrl: app.job.applyUrl },
    fields: {
      firstName: firstName ?? "",
      lastName: rest.join(" "),
      fullName: p.fullName,
      email: p.email,
      phone: p.phone,
      location: p.location,
      city,
      country: p.currentCountry ? countryName(p.currentCountry) : "",
      linkedin: p.linkedin,
      website: p.website,
      currentTitle: parseJson<{ title: string }[]>(p.experiences, [])[0]?.title ?? p.headline,
      currentCompany: parseJson<{ company: string }[]>(p.experiences, [])[0]?.company ?? "",
    },
    answers: answers.filter((a) => a.answer).map((a) => ({ id: a.id, question: a.question, answer: a.answer, category: a.category })),
    coverLetter: app.coverLetterNeeded && app.coverLetterStatus === "approved" ? app.coverLetter : null,
    resumePath: `/api/resume/${app.id}?format=pdf`,
    coverLetterPath: app.coverLetterNeeded && app.coverLetterStatus === "approved" ? `/api/cover-letter/${app.id}` : null,
  });
});
