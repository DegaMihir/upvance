import { db } from "../db";
import { fetchBoard } from "../sources";
import type { BoardAts } from "../ats";
import { ingestJobs } from "./ingest";

export const REFRESHABLE = ["greenhouse", "lever", "ashby", "gem", "workable", "smartrecruiters", "recruitee", "personio", "teamtailor", "bamboohr", "breezy", "jazzhr", "workday"];

/** Re-pull a company's public board and mark vanished jobs inactive. */
export async function refreshCompanyBoard(companyId: string) {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!c.boardSlug || !c.atsType || !REFRESHABLE.includes(c.atsType)) throw new Error("This company has no public job board configured.");
  const jobs = await fetchBoard(c.atsType as BoardAts, c.boardSlug);
  const res = await ingestJobs(jobs, { companyName: c.name });
  await db.job.updateMany({ where: { companyId, source: c.atsType, id: { notIn: res.jobIds } }, data: { isActive: false } });
  await db.company.update({ where: { id: companyId }, data: { lastFetchedAt: new Date() } });
  return res;
}
