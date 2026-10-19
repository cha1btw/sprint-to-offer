"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

// Time left until `endAt`. When the block ends the page refreshes, so the
// screen moves on to the next block by itself.
export function Countdown({ endAt }: { endAt: string }) {
  const router = useRouter();
  const end = new Date(endAt).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = end - Date.now();
      setLeft(ms);
      if (ms <= 0) router.refresh();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end, router]);

  if (left === null) return <span className="num">--:--</span>;
  const s = Math.max(0, Math.ceil(left / 1000));
  const h = Math.floor(s / 3600);
  const text = h > 0 ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  return <span className="num">{text}</span>;
}
