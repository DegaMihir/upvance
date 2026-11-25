export type ActionResult = { ok?: string; error?: string; warn?: string } | undefined;

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  return e instanceof Error ? e.message : "Something went wrong.";
}
