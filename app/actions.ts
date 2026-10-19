"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, consumeLoginToken, signSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { BLOCK_STATUSES, FIXED_KINDS, fixedBlocks, settings, type BlockStatus, type FixedKind } from "@/lib/db/schema";
import {
  LOG_COUNTERS,
  bumpCounter,
  planDay,
  saveNote,
  setAlgoDone,
  setBlockStatus,
  setTaskDone,
  type LogCounter,
} from "@/lib/planner/service";
import { requireOwner } from "@/lib/session";
import { kyivDate, kyivMinutes, parseHm } from "@/lib/time";

const refresh = () => revalidatePath("/", "layout");
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

// ---------- Login ----------

export async function signIn(form: FormData) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) redirect("/signin?error=config");
  const ok = await consumeLoginToken(getDb(), str(form, "token"));
  if (!ok) redirect("/signin?error=link");
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect("/");
}

export async function signOut() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/signin");
}

// ---------- Day ----------

export async function buildToday() {
  await requireOwner();
  await planDay(getDb(), kyivDate());
  refresh();
}

// Rebuilds the rest of today; `delay` (minutes) moves the start later.
export async function replanToday(form: FormData) {
  await requireOwner();
  const delay = Math.max(0, Math.min(180, Number(form.get("delay") ?? 0) || 0));
  await planDay(getDb(), kyivDate(), { replan: true, fromMin: kyivMinutes() + delay });
  refresh();
}

export async function changeBlock(form: FormData) {
  await requireOwner();
  const status = str(form, "status") as BlockStatus;
  if (!BLOCK_STATUSES.includes(status)) return;
  await setBlockStatus(getDb(), str(form, "id"), status);
  refresh();
}

export async function bump(form: FormData) {
  await requireOwner();
  const field = str(form, "field") as LogCounter;
  const delta = Number(form.get("delta"));
  if (!LOG_COUNTERS.includes(field) || ![-1, 1, 5].includes(delta)) return;
  await bumpCounter(getDb(), kyivDate(), field, delta);
  refresh();
}

export async function toggleAlgo(form: FormData) {
  await requireOwner();
  await setAlgoDone(getDb(), kyivDate(), str(form, "done") === "1");
  refresh();
}

export async function toggleTask(form: FormData) {
  await requireOwner();
  await setTaskDone(getDb(), str(form, "id"), str(form, "done") === "1", kyivDate());
  refresh();
}

export async function updateNote(form: FormData) {
  await requireOwner();
  await saveNote(getDb(), kyivDate(), String(form.get("note") ?? ""));
  refresh();
}

// ---------- Settings ----------

// React resets a form after its action runs, so a failed submit sends the typed
// values back in `values` and the form uses them as defaults.
export type SettingsState = { error?: string; saved?: boolean; values?: Record<string, string | string[]> };

const valuesOf = (form: FormData, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, k === "weekday" ? form.getAll(k).map(String) : str(form, k)]));

export async function saveRhythm(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  await requireOwner();
  const fail = (error: string): SettingsState => ({ error, values: valuesOf(form, ["wake", "sleep", "focus", "block"]) });
  const wake = parseHm(str(form, "wake"));
  let sleep = parseHm(str(form, "sleep"));
  const focusHours = Number(str(form, "focus").replace(",", "."));
  const block = Number(str(form, "block"));
  if (wake === null || sleep === null) return fail("Время в формате ЧЧ:ММ, например 07:30.");
  if (sleep <= wake) sleep += 1440; // going to bed after midnight
  if (sleep - wake < 8 * 60) return fail("День получается короче 8 часов, проверь время подъёма и сна.");
  if (!(focusHours >= 1 && focusHours <= 12)) return fail("Фокус в день: от 1 до 12 часов.");
  if (!(block >= 25 && block <= 90)) return fail("Длина блока: от 25 до 90 минут.");
  await getDb()
    .update(settings)
    .set({ wakeMin: wake, sleepMin: sleep, focusBudgetMin: Math.round(focusHours * 60), blockMin: Math.round(block / 5) * 5, updatedAt: new Date() })
    .where(eq(settings.id, 1));
  refresh();
  return { saved: true };
}

export async function addFixedBlock(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  await requireOwner();
  const title = str(form, "title").slice(0, 80);
  const kind = str(form, "kind") as FixedKind;
  const start = parseHm(str(form, "start"));
  const end = parseHm(str(form, "end"));
  const days = form.getAll("weekday").map(Number).filter((d) => d >= 1 && d <= 7);
  const fail = (error: string): SettingsState => ({ error, values: valuesOf(form, ["title", "kind", "start", "end", "weekday"]) });
  if (!title) return fail("Название не может быть пустым.");
  if (!FIXED_KINDS.includes(kind)) return fail("Неизвестный тип блока.");
  if (start === null || end === null || end <= start) return fail("Конец должен быть позже начала, время в формате ЧЧ:ММ.");
  if (days.length === 0) return fail("Выбери хотя бы один день недели.");
  await getDb().insert(fixedBlocks).values({ title, kind, weekdays: [...new Set(days)].sort(), startMin: start, endMin: end });
  refresh();
  return { saved: true };
}

export async function deleteFixedBlock(form: FormData) {
  await requireOwner();
  const id = str(form, "id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await getDb().delete(fixedBlocks).where(eq(fixedBlocks.id, id));
  refresh();
}
