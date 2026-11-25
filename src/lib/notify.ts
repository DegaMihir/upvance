import { db } from "./db";

/** Create an in-app notification (shown as a desktop/browser notification when allowed). */
export async function notify(userId: string, kind: string, title: string, body = "", href = "") {
  const settings = await db.userSettings.findUnique({ where: { userId }, select: { notifyDesktop: true } });
  return db.notification.create({ data: { userId, kind, title: title.slice(0, 200), body: body.slice(0, 500), href, shownAt: settings?.notifyDesktop === false ? new Date() : null } });
}
