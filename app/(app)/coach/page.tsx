import { sendToCoach } from "@/app/actions";
import { CoachForm } from "@/components/ai";
import { Card } from "@/components/ui";
import { aiStatus } from "@/lib/ai/budget";
import { getClaude } from "@/lib/ai/client";
import { recentMessages } from "@/lib/ai/coach";
import { getDb } from "@/lib/db";

const timeFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Kyiv", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function CoachPage() {
  const db = getDb();
  const [ai, messages] = await Promise.all([aiStatus(db, getClaude()), recentMessages(db)]);

  return (
    <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Коуч</p>
        <h1 className="text-2xl font-bold">Чат с Claude</h1>
        <p className="pt-1 text-sm text-muted">Видит план дня, прогресс недели и последнюю заметку. Тот же чат идёт в Telegram-боте.</p>
      </header>

      <Card>
        {messages.length === 0 ? (
          <p className="text-muted">Сообщений пока нет. Спроси, с чего начать день или что выкинуть, если не успеваешь.</p>
        ) : (
          <ol className="grid gap-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`grid max-w-[85%] gap-1 rounded-2xl px-3 py-2 ${m.role === "user" ? "justify-self-end bg-accent-soft" : "justify-self-start bg-surface-2"}`}
              >
                <span className="whitespace-pre-wrap break-words">{m.content}</span>
                <span className="text-[11px] text-muted">
                  {m.role === "user" ? "Ты" : "Claude"} · {timeFormat.format(m.createdAt)}
                  {m.channel === "telegram" ? " · Telegram" : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        {ai.enabled ? (
          <CoachForm action={sendToCoach} />
        ) : (
          <p className="text-muted">
            {ai.reason === "cap" ? "Месячный лимит токенов Claude исчерпан, чат вернётся в начале месяца." : "Claude не подключён: добавь ANTHROPIC_API_KEY."}
          </p>
        )}
      </Card>
    </>
  );
}
