"use client";

import { useActionState } from "react";
import { addFixedBlock, saveRhythm, type SettingsState } from "@/app/actions";

const input = "min-h-11 w-full rounded-xl border border-line bg-surface px-3";
const label = "grid gap-1 text-sm text-muted";
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function Status({ state, savedText }: { state: SettingsState; savedText: string }) {
  if (state.error) return <p role="alert" className="text-sm text-bad">{state.error}</p>;
  if (state.saved) return <p role="status" className="text-sm text-good">{savedText}</p>;
  return null;
}

const one = (state: SettingsState, key: string, fallback: string) => {
  const v = state.values?.[key];
  return typeof v === "string" ? v : fallback;
};

export function RhythmForm({ wake, sleep, focusHours, block }: { wake: string; sleep: string; focusHours: number; block: number }) {
  const [state, action, pending] = useActionState(saveRhythm, {});
  // A new key after each submit makes the inputs take the fresh defaults.
  const key = JSON.stringify(state.values ?? [wake, sleep, focusHours, block]);
  return (
    <form action={action} className="grid gap-3" key={key}>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Подъём
          <input name="wake" type="time" defaultValue={one(state, "wake", wake)} required className={input} />
        </label>
        <label className={label}>
          Сон
          <input name="sleep" type="time" defaultValue={one(state, "sleep", sleep)} required className={input} />
        </label>
        <label className={label}>
          Фокус в день, часов
          <input name="focus" type="number" min={1} max={12} step={0.5} defaultValue={one(state, "focus", String(focusHours))} required className={input} />
        </label>
        <label className={label}>
          Длина блока, минут
          <input name="block" type="number" min={25} max={90} step={5} defaultValue={one(state, "block", String(block))} required className={input} />
        </label>
      </div>
      <Status state={state} savedText="Сохранено. Новые настройки применятся при следующей сборке дня." />
      <button type="submit" disabled={pending} className="min-h-11 justify-self-start rounded-xl bg-accent px-4 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Сохраняю…" : "Сохранить"}
      </button>
    </form>
  );
}

export function FixedBlockForm() {
  const [state, action, pending] = useActionState(addFixedBlock, {});
  const days = state.values?.weekday;
  const checked = (d: number) => (Array.isArray(days) ? days.includes(String(d)) : d <= 5);
  return (
    <form action={action} className="grid gap-3" key={JSON.stringify(state)}>
      <label className={label}>
        Название
        <input name="title" required maxLength={80} placeholder="Лекция КНУ: Математический анализ" defaultValue={one(state, "title", "")} className={input} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className={label}>
          Начало
          <input name="start" type="time" required defaultValue={one(state, "start", "")} className={input} />
        </label>
        <label className={label}>
          Конец
          <input name="end" type="time" required defaultValue={one(state, "end", "")} className={input} />
        </label>
        <label className={label}>
          Тип
          <select name="kind" defaultValue={one(state, "kind", "study")} className={input}>
            <option value="study">Учёба</option>
            <option value="meal">Еда</option>
            <option value="routine">Рутина</option>
            <option value="sport">Спорт</option>
            <option value="other">Другое</option>
          </select>
        </label>
      </div>
      <fieldset className="grid gap-1">
        <legend className="text-sm text-muted">Дни недели</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3">
              <input type="checkbox" name="weekday" value={i + 1} defaultChecked={checked(i + 1)} className="accent-[var(--accent)]" />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <Status state={state} savedText="Блок добавлен. Пересобери день, чтобы он попал в сегодняшний план." />
      <button type="submit" disabled={pending} className="min-h-11 justify-self-start rounded-xl bg-accent px-4 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Добавляю…" : "Добавить"}
      </button>
    </form>
  );
}
