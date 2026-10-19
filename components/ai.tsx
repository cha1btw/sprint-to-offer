"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { CoachState, FirstStepState } from "@/app/actions";
import { BUTTON, VARIANT, type Variant } from "@/components/ui";

function Submit({ children, pendingText, variant, className }: { children: React.ReactNode; pendingText: string; variant: Variant; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${BUTTON} ${VARIANT[variant]} disabled:opacity-60 ${className}`}>
      {pending ? pendingText : children}
    </button>
  );
}

// Like ActionButton, but shows that Claude is working: a call takes 5 to 60 seconds.
export function AiActionButton({
  action,
  fields = {},
  children,
  pendingText = "Claude думает…",
  variant = "default",
  className = "",
}: {
  action: (form: FormData) => Promise<void>;
  fields?: Record<string, string | number>;
  children: React.ReactNode;
  pendingText?: string;
  variant?: Variant;
  className?: string;
}) {
  return (
    <form action={action} className="contents">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <Submit pendingText={pendingText} variant={variant} className={className}>
        {children}
      </Submit>
    </form>
  );
}

export function FirstStep({ blockId, action }: { blockId: string; action: (prev: FirstStepState, form: FormData) => Promise<FirstStepState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <div className="grid gap-2">
      <form action={formAction} className="contents">
        <input type="hidden" name="id" value={blockId} />
        <Submit pendingText="Claude думает…" variant="ghost" className="justify-self-start px-0 text-accent">
          🧩 Не могу начать
        </Submit>
      </form>
      {state.text && <p role="status" className="rounded-xl bg-accent-soft p-3">{state.text}</p>}
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </div>
  );
}

export function CoachForm({ action }: { action: (prev: CoachState, form: FormData) => Promise<CoachState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    // A new key after each answer clears the textarea.
    <form action={formAction} key={state.sent ?? 0} className="grid gap-2">
      <label htmlFor="coach-text" className="sr-only">Сообщение коучу</label>
      <textarea
        id="coach-text"
        name="text"
        rows={3}
        maxLength={2000}
        required
        placeholder="Например: не успеваю CV до вечера, что выкинуть из плана?"
        className="w-full rounded-xl border border-line bg-surface p-3"
      />
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <Submit pendingText="Claude печатает…" variant="primary" className="justify-self-start">
        Отправить
      </Submit>
    </form>
  );
}
