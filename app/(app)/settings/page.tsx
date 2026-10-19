import { deleteFixedBlock, signOut } from "@/app/actions";
import { FixedBlockForm, RhythmForm } from "@/components/settings-forms";
import { ActionButton, Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { fixedBlocks } from "@/lib/db/schema";
import { getSettings } from "@/lib/planner/service";
import { formatHm } from "@/lib/time";
import { asc } from "drizzle-orm";

const DAY_SHORT = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const KIND_TEXT: Record<string, string> = { routine: "Рутина", meal: "Еда", study: "Учёба", sport: "Спорт", other: "Другое" };

function daysText(days: number[]) {
  if (days.length === 7) return "каждый день";
  if (days.join() === "1,2,3,4,5") return "по будням";
  if (days.join() === "6,7") return "по выходным";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}

export default async function SettingsPage() {
  const db = getDb();
  const [s, fixed] = await Promise.all([getSettings(db), db.select().from(fixedBlocks).orderBy(asc(fixedBlocks.startMin))]);

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
        <h2 className="font-semibold">Telegram</h2>
        <p className="text-sm text-muted">
          Напоминания приходят в бота. Команды: /now, /today, /replan, /login. Если ссылка для входа потерялась, отправь боту /login.
        </p>
        <ActionButton action={signOut} variant="ghost" className="justify-self-start px-0">Выйти на этом устройстве</ActionButton>
      </Card>
    </>
  );
}
