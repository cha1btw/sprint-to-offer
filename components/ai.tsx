"use client";

import { useFormStatus } from "react-dom";
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
