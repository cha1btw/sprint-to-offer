import { deleteFixedBlock, signOut } from "@/app/actions";
import { FixedBlockForm, RhythmForm } from "@/components/settings-forms";
import { ActionButton, Card } from "@/components/ui";
import { aiStatus, monthByFeature } from "@/lib/ai/budget";
import { getClaude } from "@/lib/ai/client";
import { getDb } from "@/lib/db";
import { fixedBlocks } from "@/lib/db/schema";
import { getSettings } from "@/lib/planner/service";
import { formatHm } from "@/lib/time";
import { asc } from "drizzle-orm";

const DAY_SHORT = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const AI_FEATURE_TEXT: Record<string, string> = { plan: "План дня", first_step: "Не могу начать", review: "Разбор дня", coach: "Коуч" };
const KIND_TEXT: Record<string, string> = { routine: "Рутина", meal: "Еда", study: "Учёба", sport: "Спорт", other: "Другое" };

function daysText(days: number[]) {
  if (days.length === 7) return "каждый день";
  if (days.join() === "1,2,3,4,5") return "по будням";
  if (days.join() === "6,7") return "по выходным";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}

export default async function SettingsPage() {
  const db = getDb();
  const [s, fixed, ai, usage] = await Promise.all([
    getSettings(db),
    db.select().from(fixedBlocks).orderBy(asc(fixedBlocks.startMin)),
    aiStatus(db, getClaude()),
    monthByFeature(db),
  ]);

  return (
    <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Настройки</p>
        <h1 className="text-2xl font-bold">Ритм дня</h1>
      </header>

      {s && (
        <Card>
          <h2 className="font-semibold">Подъём, сон и фокус</h2>
          <RhythmForm
            wake={formatHm(s.wakeMin)}
            sleep={formatHm(s.sleepMin)}
            focusHours={s.focusBudgetMin / 60}
            block={s.blockMin}
          />
        </Card>
      )}

      <Card>
        <h2 className="font-semibold">Фиксированные блоки</h2>
        <p className="text-sm text-muted">Лекции КНУ, еда, спорт: то, что не двигается. План раскладывает задачи вокруг них.</p>
        {fixed.length === 0 ? (
          <p className="text-muted">Пока ничего нет.</p>
        ) : (
          <ul className="grid">
            {fixed.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium">{f.title}</span>
                  <span className="text-sm text-muted">
                    <span className="num">{formatHm(f.startMin)}–{formatHm(f.endMin)}</span> · {daysText(f.weekdays)} · {KIND_TEXT[f.kind]}
                  </span>
                </span>
                <ActionButton action={deleteFixedBlock} fields={{ id: f.id }} variant="ghost" className="text-bad" label={`Удалить: ${f.title}`}>
                  Удалить
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-xl bg-surface-2 p-3">
          <summary className="cursor-pointer font-medium">Добавить блок</summary>
          <div className="pt-3">
            <FixedBlockForm />
          </div>
        </details>
      </Card>

      <Card>
        <h2 className="font-semibold">Claude</h2>
        {ai.reason === "no_key" ? (
          <p className="text-sm text-muted">Не подключён: без ANTHROPIC_API_KEY приложение планирует день без AI, кнопки Claude скрыты.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Токенов в этом месяце: <span className="num text-ink">{ai.used.toLocaleString("ru-RU")}</span> из{" "}
              <span className="num">{ai.cap.toLocaleString("ru-RU")}</span>
              {ai.reason === "cap" && ". Лимит исчерпан, AI-функции скрыты до начала месяца."}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <div className={`h-full ${ai.reason === "cap" ? "bg-bad" : "bg-accent"}`} style={{ width: `${ai.cap ? Math.min(100, (ai.used / ai.cap) * 100) : 100}%` }} />
            </div>
            {usage.length > 0 && (
              <ul className="grid gap-1 text-sm">
                {usage.map((u) => (
                  <li key={u.feature} className="flex justify-between gap-3">
                    <span>{AI_FEATURE_TEXT[u.feature]}</span>
                    <span className="num text-muted">{u.calls} × · {u.tokens.toLocaleString("ru-RU")}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Telegram</h2>
        <p className="text-sm text-muted">
          Напоминания приходят в бота. Команды: /now, /today, /replan, /review, /login. Если ссылка для входа потерялась, отправь боту /login.
        </p>
        <ActionButton action={signOut} variant="ghost" className="justify-self-start px-0">Выйти на этом устройстве</ActionButton>
      </Card>
    </>
  );
}
