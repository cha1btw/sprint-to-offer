import { bump, buildToday, changeBlock, replanToday, toggleAlgo } from "@/app/actions";
import { Countdown } from "@/components/countdown";
import { ActionButton, Card, KIND_STRIPE, kindLabel, span } from "@/components/ui";
import { getDb } from "@/lib/db";
import { MINIMUM } from "@/lib/planner/demand";
import { currentAndNext, getBlocks, getDayLog, getSettings, getWeekFor, type Block } from "@/lib/planner/service";
import { daysBetween, formatDayRu, kyivDate } from "@/lib/time";

export default async function NowPage() {
  const db = getDb();
  const now = new Date();
  const date = kyivDate(now);
  const [s, blocks, log, week] = await Promise.all([getSettings(db), getBlocks(db, date), getDayLog(db, date), getWeekFor(db, date)]);

  if (!s) {
    return (
      <Card>
        <h1 className="text-lg font-semibold">База пустая</h1>
        <p className="text-muted">Загрузи план: <code className="num">npm run db:seed</code>.</p>
      </Card>
    );
  }

  const { current, next } = currentAndNext(blocks, now);
  const deadlineLeft = Math.max(0, daysBetween(date, s.deadline));
  const minimum = [
    { done: log.algo || log.lc > 0, label: `${MINIMUM.algoMin} минут алгоритмов` },
    { done: log.trainer >= MINIMUM.trainer, label: `${MINIMUM.trainer} вопросов в тренажёре (${log.trainer})` },
    { done: log.apps >= MINIMUM.apps, label: `${MINIMUM.apps} отклик (${log.apps})` },
  ];
  const minimumDone = minimum.every((m) => m.done);

  return (
    <>
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{formatDayRu(date)}</p>
          <h1 className="text-2xl font-bold">{week ? `Неделя ${week.n} · ${week.theme}` : "Спринт"}</h1>
        </div>
        <p className="shrink-0 whitespace-nowrap text-right text-sm text-muted">
          <span className="num block text-2xl font-semibold text-ink">{deadlineLeft}</span>дней до 28.02
        </p>
      </header>

      {blocks.length === 0 ? (
        <Card>
          <h2 className="text-lg font-semibold">План на сегодня ещё не собран</h2>
          <p className="text-muted">Соберу день из твоего расписания, минимального дня и задач недели. Потом можно пересобрать в любой момент.</p>
          <ActionButton action={buildToday} variant="primary">Собрать день</ActionButton>
        </Card>
      ) : (
        <CurrentCard current={current} next={next} />
      )}

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Минимальный день</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${minimumDone ? "bg-good-soft text-good" : "bg-surface-2 text-muted"}`}>
            {minimumDone ? "закрыт" : `${minimum.filter((m) => m.done).length} из 3`}
          </span>
        </div>
        <ul className="grid gap-2">
          {minimum.map((m) => (
            <li key={m.label} className="flex items-center gap-3">
              <span className={`grid h-6 w-6 place-items-center rounded-full border-2 text-xs ${m.done ? "border-good bg-good text-surface" : "border-line"}`} aria-hidden="true">
                {m.done ? "✓" : ""}
              </span>
              <span className={m.done ? "text-muted" : ""}>{m.label}</span>
            </li>
          ))}
        </ul>
        {!log.algo && log.lc === 0 && (
          <ActionButton action={toggleAlgo} fields={{ done: 1 }}>Алгоритмы сделал</ActionButton>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Счётчики дня</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Counter field="lc" label="LeetCode" value={log.lc} />
          <Counter field="apps" label="Отклики" value={log.apps} />
          <Counter field="trainer" label="Вопросы" value={log.trainer} step={5} />
          <Counter field="net" label="Нетворкинг" value={log.net} />
          <Counter field="mock" label="Mock" value={log.mock} />
          <div className="grid content-center rounded-xl bg-surface-2 p-3 text-center">
            <span className="text-xs text-muted">Фокус сегодня</span>
            <span className="num text-xl font-semibold">{Math.floor(log.focusMin / 60)}:{String(log.focusMin % 60).padStart(2, "0")}</span>
          </div>
        </div>
      </Card>
    </>
  );
}

function CurrentCard({ current, next }: { current: Block | null; next: Block | null }) {
  return (
    <Card className="relative overflow-hidden">
      {current ? (
        <>
          <span className={`absolute inset-y-0 left-0 w-1.5 ${KIND_STRIPE[current.kind]}`} aria-hidden="true" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Сейчас · {kindLabel(current)}</span>
            <span className="num text-sm text-muted">{span(current)}</span>
          </div>
          <h2 className="text-2xl font-bold leading-tight text-balance">{current.title}</h2>
          <p className="text-muted">
            Осталось <span className="text-lg font-semibold text-ink"><Countdown endAt={current.endAt.toISOString()} /></span>
            {current.status === "doing" && " · идёт"}
            {current.status === "done" && " · сделано"}
          </p>
          {current.kind === "focus" && (
            <div className="flex flex-wrap gap-2">
              {current.status === "planned" && (
                <>
                  <ActionButton action={changeBlock} fields={{ id: current.id, status: "doing" }} variant="primary" className="flex-1">▶️ Начать</ActionButton>
                  <ActionButton action={changeBlock} fields={{ id: current.id, status: "skipped" }}>Пропустить</ActionButton>
                </>
              )}
              {current.status === "doing" && (
                <ActionButton action={changeBlock} fields={{ id: current.id, status: "done" }} variant="primary" className="flex-1">✅ Готово</ActionButton>
              )}
            </div>
          )}
          {current.kind === "rest" && <p className="text-sm text-muted">Это запланированный отдых: можно ютуб, без чувства вины. Когда он закончится, придёт напоминание.</p>}
        </>
      ) : (
        <h2 className="text-lg font-semibold">Сейчас в плане ничего нет</h2>
      )}
      {next && (
        <p className="border-t border-line pt-3 text-sm text-muted">
          Дальше в <span className="num text-ink">{span(next).split("–")[0]}</span>: <span className="text-ink">{next.title}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ActionButton action={replanToday} fields={{ delay: 30 }}>⏱ Сдвинуть на 30 мин</ActionButton>
        <ActionButton action={replanToday} fields={{ delay: 0 }}>🔁 Пересобрать</ActionButton>
      </div>
    </Card>
  );
}

function Counter({ field, label, value, step = 1 }: { field: string; label: string; value: number; step?: number }) {
  return (
    <div className="grid justify-items-center gap-1 rounded-xl bg-surface-2 p-3 text-center">
      <span className="text-xs text-muted">{label}</span>
      <span className="num text-2xl font-semibold">{value}</span>
      <div className="flex gap-1.5">
        <ActionButton action={bump} fields={{ field, delta: -1 }} className="h-9 min-h-9 w-9 px-0" label={`${label}: минус один`}>−</ActionButton>
        <ActionButton action={bump} fields={{ field, delta: step }} className="h-9 min-h-9 w-9 px-0" label={`${label}: плюс ${step}`}>+</ActionButton>
      </div>
    </div>
  );
}
