"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type State = "loading" | "ok" | "err";

export function ApiStatus() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { ok?: boolean };
        if (!cancelled) setState(j.ok ? "ok" : "err");
      } catch {
        if (!cancelled) setState("err");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        檢查 API…
      </span>
    );
  if (state === "ok")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
        <CheckCircle2 className="size-4" aria-hidden />
        API 已連線
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-rose-700">
      <XCircle className="size-4" aria-hidden />
      API 無法連線
    </span>
  );
}
