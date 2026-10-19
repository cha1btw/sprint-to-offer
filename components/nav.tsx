"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Сейчас", icon: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></> },
  { href: "/day", label: "День", icon: <><path d="M5 6h14M5 12h14M5 18h9" /></> },
  { href: "/coach", label: "Коуч", icon: <><path d="M5 5h14v10H10l-4 4v-4H5z" /></>, ai: true },
  { href: "/settings", label: "Настройки", icon: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></> },
];

// The coach tab is shown only while Claude is available.
export function Nav({ ai = false }: { ai?: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((item) => ai || !item.ai);
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className={`mx-auto grid h-16 max-w-xl ${items.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {items.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`grid place-items-center content-center gap-1 text-xs font-medium ${active ? "text-accent" : "text-muted"}`}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
