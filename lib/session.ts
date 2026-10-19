import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./auth.ts";

export async function isOwner(): Promise<boolean> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
}

// Every page and server action calls this first: without a valid session the
// visitor only sees the sign-in page.
export async function requireOwner(): Promise<void> {
  if (!(await isOwner())) redirect("/signin");
}
