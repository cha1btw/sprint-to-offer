import { InlineKeyboard } from "grammy";
import type { Block } from "../planner/service.ts";
import { escapeTelegramHtml as esc } from "../telegram.ts";
import { formatDayRu, formatHm } from "../time.ts";

const STATUS_MARK: Record<string, string> = { planned: "", doing: "▶️ ", done: "✅ ", skipped: "⏭ " };

export const span = (b: Pick<Block, "startMin" | "endMin">) => `${formatHm(b.startMin)}–${formatHm(b.endMin)}`;

export function blockLine(b: Block): string {
  const title = b.kind === "break" ? `<i>${esc(b.title)}</i>` : b.kind === "focus" ? `<b>${esc(b.title)}</b>` : esc(b.title);
  return `${span(b)}  ${STATUS_MARK[b.status] ?? ""}${title}`;
}

export function dayText(date: string, blocks: Block[]): string {
  if (blocks.length === 0) return `План на ${esc(formatDayRu(date))} ещё не собран. Отправь /replan.`;
  const lines = blocks.filter((b) => b.kind !== "break").map(blockLine);
  return [`<b>План на ${esc(formatDayRu(date))}</b>`, "", ...lines].join("\n");
}

export function nowText(current: Block | null, next: Block | null): string {
  const parts: string[] = [];
  if (current) parts.push(`<b>Сейчас:</b> ${esc(current.title)}\n${span(current)}`);
  else parts.push("Сейчас в плане ничего нет.");
  if (next) parts.push(`Дальше: ${esc(next.title)} в ${formatHm(next.startMin)}`);
  return parts.join("\n\n");
}

// `ai` adds the Claude buttons; it is false without a key or over the monthly cap.
export function blockKeyboard(b: Block | null, ai = false): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (b && b.kind === "focus" && b.status === "planned") kb.text("▶️ Начать", `start:${b.id}`).text("⏭ Пропустить", `skip:${b.id}`).row();
  if (b && b.kind === "focus" && b.status === "doing") kb.text("✅ Готово", `done:${b.id}`).row();
  if (ai && b && b.kind === "focus" && (b.status === "planned" || b.status === "doing")) kb.text("🧩 Не могу начать", `stuck:${b.id}`).row();
  return kb.text("⏱ Сдвинуть на 30 мин", "later").text("🔁 Пересобрать", "replan");
}

export function driftKeyboard(b: Block, ai = false): InlineKeyboard {
  const kb = new InlineKeyboard().text("▶️ Начать сейчас", `start:${b.id}`);
  if (ai) kb.text("🧩 Не могу начать", `stuck:${b.id}`);
  return kb.row().text("⏱ Сдвинуть на 30 мин", "later").text("🔁 Пересобрать", "replan");
}
