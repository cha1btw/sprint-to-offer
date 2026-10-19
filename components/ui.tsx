import type { Block } from "@/lib/planner/service";
import { formatHm } from "@/lib/time";

export const TRACK_LABEL: Record<string, string> = {
  fund: "Фундамент",
  algo: "Алгоритмы",
  proj: "Проект",
  job: "Поиск работы",
  prep: "Собеседования",
  py: "Python",
  misc: "Разное",
};

export function kindLabel(b: Pick<Block, "kind" | "track">): string {
  if (b.kind === "focus") return b.track ? TRACK_LABEL[b.track] ?? "Фокус" : "Фокус";
  return { fixed: "По расписанию", break: "Перерыв", rest: "Отдых", review: "Разбор" }[b.kind] ?? b.kind;
}

// Left stripe colour by block kind.
export const KIND_STRIPE: Record<string, string> = {
  focus: "bg-accent",
  fixed: "bg-muted",
  break: "bg-line",
  rest: "bg-rest",
  review: "bg-warn",
};

export const span = (b: Pick<Block, "startMin" | "endMin">) => `${formatHm(b.startMin)}–${formatHm(b.endMin)}`;

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`grid min-w-0 gap-3 rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export const BUTTON = "min-h-11 rounded-xl border px-4 py-2 font-medium transition active:scale-[0.98]";

export type Variant = "primary" | "default" | "ghost";
export const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border-accent",
  default: "bg-surface border-line",
  ghost: "bg-transparent border-transparent text-muted",
};

// A button that runs a server action with a few hidden fields. Works without JS.
export function ActionButton({
  action,
  fields = {},
  children,
  variant = "default",
  className = "",
  label,
}: {
  action: (form: FormData) => Promise<void>;
  fields?: Record<string, string | number>;
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  label?: string;
}) {
  return (
    <form action={action} className="contents">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <button
        type="submit"
        aria-label={label}
        className={`${BUTTON} ${VARIANT[variant]} ${className}`}
      >
        {children}
      </button>
    </form>
  );
}
