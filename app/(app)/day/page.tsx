import { buildToday, changeBlock, replanToday, reviewWithClaude, toggleTask, updateNote } from "@/app/actions";
import { AiActionButton } from "@/components/ai";
import { ActionButton, Card, KIND_STRIPE, TRACK_LABEL, kindLabel, span } from "@/components/ui";
import { aiStatus } from "@/lib/ai/budget";
import { getClaude } from "@/lib/ai/client";
import { getDb } from "@/lib/db";
import { getBlocks, getDayLog, getDayPlan, getWeekFor, getWeekTasks } from "@/lib/planner/service";
import { formatDayRu, kyivDate } from "@/lib/time";

const STATUS_TEXT: Record<string, string> = { doing: "идёт", done: "сделано", skipped: "пропущено" };

export default async function DayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = getDb();
  const now = new Date();
  const date = kyivDate(now);
  const [blocks, log, week, plan, ai, params] = await Promise.all([
    getBlocks(db, date),
    getDayLog(db, date),
    getWeekFor(db, date),
    getDayPlan(db, date),
    aiStatus(db, getClaude(), now),
    searchParams,
  ]);
  const tasks = week ? await getWeekTasks(db, week.n) : [];
  const t = now.getTime();

  return (
    <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">План дня</p>
        <h1 className="text-2xl font-bold first-letter:uppercase">{formatDayRu(date)}</h1>
        {plan?.source === "ai" && blocks.length > 0 && (
          <p className="pt-1 text-sm text-muted">✨ План составил Claude{plan.aiComment ? `: ${plan.aiComment}` : ""}</p>
        )}
      </header>

      <Card>
        {blocks.length === 0 ? (
          <>
            <p className="text-muted">План ещё не собран.</p>
            <ActionButton action={buildToday} variant="primary">Собрать день</ActionButton>
          </>
        ) : (
          <>
            <ol className="grid">
              {blocks.map((b) => {
                const isNow = b.startAt.getTime() <= t && t < b.endAt.getTime();
                const past = b.endAt.getTime() <= t;
                return (
                  <li
                    key={b.id}
                    className={`relative grid grid-cols-[88px_1fr] gap-3 border-t border-line py-2.5 pl-3 first:border-t-0 ${past && b.status !== "done" ? "opacity-55" : ""} ${isNow ? "rounded-xl bg-accent-soft" : ""}`}
                  >
                    <span className={`absolute inset-y-2 left-0 w-1 rounded-full ${KIND_STRIPE[b.kind]}`} aria-hidden="true" />
                    <span className="num pt-0.5 text-sm text-muted">{span(b)}</span>
                    <div className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                        {kindLabel(b)}
                        {STATUS_TEXT[b.status] ? ` · ${STATUS_TEXT[b.status]}` : ""}
                      </span>
                      <span className={`${b.kind === "focus" ? "font-semibold" : ""} ${b.status === "done" ? "line-through decoration-muted" : ""}`}>{b.title}</span>
                      {b.kind === "focus" && !past && b.status === "planned" && (
                        <div className="flex gap-2 pt-1">
                          <ActionButton action={changeBlock} fields={{ id: b.id, status: "doing" }} className="min-h-9 py-1 text-sm">Начать</ActionButton>
                          <ActionButton action={changeBlock} fields={{ id: b.id, status: "skipped" }} variant="ghost" className="min-h-9 py-1 text-sm">Пропустить</ActionButton>
                        </div>
                      )}
                      {b.kind === "focus" && b.status === "doing" && (
                        <div className="pt-1">
                          <ActionButton action={changeBlock} fields={{ id: b.id, status: "done" }} variant="primary" className="min-h-9 py-1 text-sm">Готово</ActionButton>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap gap-2">
              <ActionButton action={replanToday} fields={{ delay: 0 }}>🔁 Пересобрать с текущего момента</ActionButton>
            </div>
          </>
        )}
      </Card>

      {week && (
        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Задачи недели {week.n}</h2>
            <span className="num text-sm text-muted">
              {tasks.filter((x) => x.done).length}/{tasks.length}
            </span>
          </div>
          <p className="text-sm text-muted">
            {week.theme} · LeetCode: {week.lcTopic}
          </p>
          <ul className="grid">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-3 border-t border-line py-2 first:border-t-0">
                <ActionButton
                  action={toggleTask}
                  fields={{ id: task.id, done: task.done ? 0 : 1 }}
                  className={`mt-0.5 grid h-7 min-h-7 w-7 place-items-center rounded-lg p-0 text-sm ${task.done ? "border-good bg-good text-surface" : ""}`}
                  label={task.done ? `Вернуть задачу: ${task.title}` : `Отметить задачу: ${task.title}`}
                >
                  {task.done ? "✓" : ""}
                </ActionButton>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{TRACK_LABEL[task.track]}</span>
                  <span className={task.done ? "text-muted line-through" : ""}>{task.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {plan && (plan.review || ai.enabled) && (
        <Card>
          <h2 className="font-semibold">Разбор дня</h2>
          {plan.review ? (
            <>
              <p>{plan.review.summary}</p>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Цели на завтра</h3>
              <ol className="grid list-decimal gap-1 pl-5">
                {plan.review.goals.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-muted">Вечером, в блок разбора, Claude подведёт итог дня и предложит три цели на завтра. Можно запросить раньше.</p>
          )}
          {params.ai === "review-failed" && <p role="alert" className="text-sm text-bad">Claude не смог сделать разбор, попробуй позже.</p>}
          {ai.enabled && (
            <AiActionButton action={reviewWithClaude} className="justify-self-start">
              {plan.review ? "✨ Обновить разбор" : "✨ Разбор с Claude"}
            </AiActionButton>
          )}
        </Card>
      )}

      <Card>
        <h2 className="font-semibold">Заметка дня</h2>
        <form action={updateNote} className="grid gap-2">
          <textarea
            name="note"
            defaultValue={log.note}
            rows={4}
            placeholder="Что сделал, что мешало, что понял"
            className="w-full rounded-xl border border-line bg-surface p-3"
          />
          <button type="submit" className="min-h-11 justify-self-start rounded-xl border border-line px-4 font-medium">
            Сохранить
          </button>
        </form>
      </Card>
    </>
  );
}
