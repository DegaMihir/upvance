import { Sidebar } from "@/components/shell/sidebar";
import { NotificationPoller } from "@/components/shell/notification-poller";
import { signOutAction } from "@/app/actions/auth";
import { requireUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { allowedBeforeSetup, setupStatus } from "@/lib/setup";
import { Alert } from "@/components/ui/misc";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  // First-time setup must be finished before the dashboard, jobs and applying.
  const setup = await setupStatus(userId);
  const path = (await headers()).get("x-pathname") ?? "";
  if (!setup.complete && path && !allowedBeforeSetup(path)) redirect("/setup");
  const [user, needsYou, unread, review] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    db.application.count({ where: { userId, status: "Needs you" } }),
    db.email.count({ where: { userId, read: false, direction: "in" } }),
    db.applyJob.count({ where: { userId, status: { in: ["review", "needs-you", "paused"] } } }),
  ]);
  return (
    <div className="min-h-dvh">
      <Sidebar counts={{ needsYou, unread, review }} userEmail={user.email} signOutAction={signOutAction} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          {!setup.complete && (
            <Alert variant="warning" title="Finish your setup first" className="mb-4">
              Complete your profile here, then <a href="/setup" className="underline font-medium">go back to setup</a> to confirm your countries, roles and visa needs. The rest of the app opens after that.
            </Alert>
          )}
          {children}
        </div>
      </main>
      <NotificationPoller />
    </div>
  );
}
