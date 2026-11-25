import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { registerAction } from "@/app/actions/auth";
import { allowedBeforeSetup, setupStatus } from "@/lib/setup";
import { checkOpenAnswer, isOpenQuestion, openAnswerId, soundsHuman, templateAnswer, upsertOpenAnswers, writeOpenAnswers, type OpenAnswerContext } from "@/lib/writing/open-answers";
import { decide, type Facts, type FormField } from "@/lib/apply/form";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("1. Register: confirm password", () => {
  const base = { name: "Test Person", email: "confirm-test@example.com", password: "longenough1", timezone: "UTC" };

  it("refuses mismatched passwords, says why, and creates no account", async () => {
    const r = await registerAction(undefined, fd({ ...base, confirmPassword: "longenough2" }));
    expect(r).toMatchObject({ field: "confirmPassword" });
    expect(r?.error).toMatch(/don't match/);
    expect(await db.user.findUnique({ where: { email: base.email } })).toBeNull();
  });

  it("refuses an empty confirmation and a short password with clear messages", async () => {
    expect((await registerAction(undefined, fd({ ...base, confirmPassword: "" })))?.field).toBe("confirmPassword");
    const short = await registerAction(undefined, fd({ ...base, password: "short", confirmPassword: "short" }));
    expect(short).toMatchObject({ field: "password" });
    expect(short?.error).toMatch(/at least 8 characters/);
  });

  it("an existing email is reported on the email field", async () => {
    await db.user.upsert({ where: { email: "taken@example.com" }, update: {}, create: { email: "taken@example.com", name: "x", passwordHash: "x" } });
    const r = await registerAction(undefined, fd({ ...base, email: "taken@example.com", confirmPassword: base.password }));
    expect(r).toMatchObject({ field: "email" });
    expect(r?.error).toMatch(/already exists/);
  });
});

describe("2. Setup before the dashboard", () => {
  it("is incomplete until the profile, preferences and confirmation are all done", async () => {
    const u = await db.user.create({ data: { email: `setup-${Date.now()}@example.com`, name: "Setup", passwordHash: "x", settings: { create: {} }, profiles: { create: { name: "Main resume", isDefault: true, fullName: "Setup Person", email: "s@example.com" } } } });
    let st = await setupStatus(u.id);
    expect(st.complete).toBe(false);
    expect(st.profileMissing).toEqual(expect.arrayContaining(["Resume", "Phone", "Citizenship", "Skills", "Work history"]));
    expect(st.prefsMissing).toEqual(["Countries", "Job roles"]);

    await db.profile.updateMany({ where: { userId: u.id }, data: { phone: "+91 90000 00000", currentCountry: "India", citizenship: "India", skills: JSON.stringify(["Python"]), experiences: JSON.stringify([{ title: "Engineer", company: "Acme", start: "2020", end: "", bullets: ["Built APIs"] }]), resumeText: "Setup Person – Engineer at Acme" } });
    await db.userSettings.update({ where: { userId: u.id }, data: { targetCountries: JSON.stringify(["US"]), targetTitles: JSON.stringify(["AI Engineer"]) } });
    st = await setupStatus(u.id);
    expect(st).toMatchObject({ profileOk: true, prefsOk: true, confirmed: false, complete: false }); // still needs "Finish setup"

    await db.userSettings.update({ where: { userId: u.id }, data: { setupCompletedAt: new Date() } });
    expect((await setupStatus(u.id)).complete).toBe(true);
  });

  it("only the profile and setup pages open before setup is finished", () => {
    for (const p of ["/setup", "/profile", "/profile/abc123"]) expect(allowedBeforeSetup(p), p).toBe(true);
    for (const p of ["/dashboard", "/jobs", "/apply-queue", "/sheet", "/settings", "/profiles-old"]) expect(allowedBeforeSetup(p), p).toBe(false);
  });
});

describe("3. Open questions answered in plain English", () => {
  const ctx: OpenAnswerContext = {
    jobTitle: "Software Engineer, Payments",
    company: "Stripe",
    jobDescription: "Build payment APIs in Python and PostgreSQL. You'll work on risk systems for the Payments team.",
    resumeText: "Mihir Example – Software Engineer at Acme Corp (2021–present). Built Python services on PostgreSQL handling 2 million requests a day. Skills: Python, PostgreSQL, Docker.",
    profileSkills: ["Python", "PostgreSQL", "Docker"],
    currentTitle: "Software Engineer",
    yearsExperience: 4,
  };

  it("spots open questions but not fact fields", () => {
    for (const label of ["Why do you want to work at Stripe?", "What interests you about this role?", "Tell us about a project you're proud of", "Cover letter", "Anything else you'd like us to know?"]) expect(isOpenQuestion({ label, kind: "textarea" }), label).toBe(true);
    for (const label of ["Salary expectations", "Why do you need visa sponsorship?", "LinkedIn profile", "Phone"]) expect(isOpenQuestion({ label, kind: "textarea" }), label).toBe(false);
    expect(isOpenQuestion({ label: "Why?", kind: "select" })).toBe(false);
  });

  it("rejects answers that sound machine-written or invent facts", () => {
    expect(soundsHuman("I'm passionate about payments.")).toMatch(/passionate/);
    expect(soundsHuman("- Built APIs\n- Shipped things")).toMatch(/list/);
    expect(soundsHuman("I built Python services for four years.")).toBeNull();
    expect(checkOpenAnswer("I built services handling 10 million requests a day.", ctx)).toMatch(/number/);
    expect(checkOpenAnswer("I have years of Kubernetes experience.", ctx)).toMatch(/Kubernetes/);
    expect(checkOpenAnswer("At Acme Corp I built Python services on PostgreSQL that handled 2 million requests a day, which is close to the payment API work on the Payments team at Stripe.", ctx)).toBeNull();
  });

  it("without AI, writes a plain template for 'why' questions only", async () => {
    const t = templateAnswer(ctx)!;
    expect(t).toMatch(/Software Engineer, Payments role at Stripe/);
    expect(t).toMatch(/working with Python and SQL/);
    expect(checkOpenAnswer(t, ctx)).toBeNull();
    const { answers } = await writeOpenAnswers(
      [
        { uid: "a", label: "Why do you want to work at Stripe?" },
        { uid: "b", label: "Tell us about a project you're proud of" },
        { uid: "c", label: "Why this role? (max 120 characters)", maxLength: 120 },
      ],
      ctx,
      null,
    );
    expect(answers.a).toBe(t);
    expect(answers.b).toBeUndefined(); // can't be made up – left for you
    expect(answers.c.length).toBeLessThanOrEqual(120);
  });

  it("saves answers with the application, keeps your edits, and reuses them when filling", () => {
    const q = "Why do you want to work at Stripe?";
    let saved = upsertOpenAnswers([], [{ question: q, answer: "Draft one.", required: true }]);
    expect(saved[0]).toMatchObject({ id: openAnswerId(q), source: "ai-draft", answer: "Draft one." });
    saved = [{ ...saved[0], answer: "My own words.", source: "user" }];
    expect(upsertOpenAnswers(saved, [{ question: q, answer: "Draft two.", required: true }])[0].answer).toBe("My own words.");
    const field: FormField = { uid: "x", kind: "textarea", label: q, name: "why", required: true, options: [], value: "" };
    const facts = { answers: saved, coverLetter: null, sensitive: {} } as unknown as Facts;
    expect(decide(field, facts)).toMatchObject({ value: "My own words.", source: "answer" });
  });
});

describe("3b. The plain template only answers 'why this company/role' questions", () => {
  it("doesn't answer unrelated questions that merely contain 'why'", async () => {
    const { isWhyCompanyQuestion } = await import("@/lib/writing/open-answers");
    for (const q of ["Why do you want to work at Stripe?", "Why are you interested in this role?", "What interests you about our team?", "Why are you applying?"]) expect(isWhyCompanyQuestion(q), q).toBe(true);
    for (const q of ["Describe your favourite data structure and why", "Tell us why you left your last job", "Why is the sky blue?"]) expect(isWhyCompanyQuestion(q), q).toBe(false);
  });
});
