"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function isBrowserSttSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

type SttStatus = "idle" | "listening" | "error";

type Options = {
  onFinal: (transcript: string) => void;
  onError?: (message: string) => void;
};

const RESTART_MS = 220;

/** 收音開啟後若長時間無辨識輸入（無 onresult），自動關閉連續收音 */
const IDLE_SESSION_CLOSE_MS = 60_000;

/**
 * Web Speech API，zh-TW。`continuous: false` = 短暫停頓則一輪結束、可帶出文字。
 * **連續工作階段**：用戶按一下開啟「收音」→ 每完成一句即自動送出，並在短延遲後繼續聽下一句；
 * 直到用戶再按一次，才整段關閉收音。
 */
export function useBrowserStt({ onFinal, onError }: Options) {
  const [clientReady, setClientReady] = useState(false);
  const [status, setStatus] = useState<SttStatus>("idle");
  const [interim, setInterim] = useState("");
  const [sessionOpen, setSessionOpen] = useState(false);

  const onFinalRef = useRef(onFinal);
  const onErrorRef = useRef(onError);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const finalsRef = useRef<string[]>([]);
  /** iOS WebKit 常有辨識結果始終非 final、僅 interim，onend 時 finals 為空 — 備援此同步緩存 */
  const interimRef = useRef("");
  const listeningRef = useRef(false);
  const sessionOpenRef = useRef(false);
  const userCancelledRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginRoundRef = useRef<() => void>(() => {});
  const endSessionRef = useRef<() => void>(() => {});
  const scheduleIdleCloseTimerRef = useRef<() => void>(() => {});

  useEffect(() => {
    queueMicrotask(() => setClientReady(true));
  }, []);

  useEffect(() => {
    onFinalRef.current = onFinal;
    onErrorRef.current = onError;
  }, [onFinal, onError]);

  const clearIdleCloseTimer = useCallback(() => {
    if (idleCloseTimerRef.current) {
      clearTimeout(idleCloseTimerRef.current);
      idleCloseTimerRef.current = null;
    }
  }, []);

  const scheduleIdleCloseTimer = useCallback(() => {
    clearIdleCloseTimer();
    idleCloseTimerRef.current = setTimeout(() => {
      idleCloseTimerRef.current = null;
      if (!sessionOpenRef.current) return;
      endSessionRef.current();
    }, IDLE_SESSION_CLOSE_MS);
  }, [clearIdleCloseTimer]);

  const beginListeningRound = useCallback(() => {
    if (!recRef.current) return;
    if (!sessionOpenRef.current) return;
    if (listeningRef.current) return;
    try {
      userCancelledRef.current = false;
      finalsRef.current = [];
      interimRef.current = "";
      setInterim("");
      setStatus("listening");
      listeningRef.current = true;
      recRef.current.start();
    } catch {
      clearIdleCloseTimer();
      setStatus("error");
      listeningRef.current = false;
      sessionOpenRef.current = false;
      setSessionOpen(false);
      onErrorRef.current?.("無法啟動語音辨識。請關閉後再開啟收一次。");
    }
  }, [clearIdleCloseTimer]);

  useEffect(() => {
    scheduleIdleCloseTimerRef.current = scheduleIdleCloseTimer;
  }, [scheduleIdleCloseTimer]);

  useEffect(() => {
    beginRoundRef.current = beginListeningRound;
  }, [beginListeningRound]);

  useEffect(() => {
    if (!isBrowserSttSupported()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any;
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return;

    const r = new Ctor() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      start: () => void;
      stop: () => void;
      abort: () => void;
      onresult: ((e: {
        resultIndex: number;
        results: {
          length: number;
          [i: number]: { 0: { transcript: string }; isFinal: boolean };
        };
      }) => void) | null;
      onerror: ((e: { error: string }) => void) | null;
      onend: (() => void) | null;
    };
    r.lang = "zh-TW";
    r.interimResults = true;
    r.continuous = false;

    r.onresult = (e) => {
      scheduleIdleCloseTimerRef.current();
      // 非 final：掃描整個 results（iOS/WebKit 若只從 resultIndex 起算會漏字）
      let inter = "";
      for (let i = 0; i < e.results.length; i++) {
        const part = e.results[i]!;
        if (!part.isFinal) {
          inter += part[0].transcript;
        }
      }
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const part = e.results[i]!;
        if (part.isFinal) {
          finalsRef.current.push(part[0].transcript);
        }
      }
      interimRef.current = inter;
      setInterim(inter);
    };

    r.onerror = (e: { error: string }) => {
      if (e.error === "aborted") {
        listeningRef.current = false;
        setStatus("idle");
        return;
      }
      listeningRef.current = false;
      if (e.error === "not-allowed") {
        clearIdleCloseTimer();
        sessionOpenRef.current = false;
        setSessionOpen(false);
        setStatus("error");
        onErrorRef.current?.("麥克風權限被拒。請在瀏覽器允許本網站使用麥克風。");
        return;
      }
      if (e.error === "no-speech" || e.error === "audio-capture") {
        return;
      }
      setStatus("error");
      clearIdleCloseTimer();
      sessionOpenRef.current = false;
      setSessionOpen(false);
      onErrorRef.current?.(e.error);
    };

    r.onend = () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }

      listeningRef.current = false;
      const finalsPart = finalsRef.current.join("").replace(/\s+/g, " ").trim();
      finalsRef.current = [];
      const interimFallback = interimRef.current.replace(/\s+/g, " ").trim();
      interimRef.current = "";
      setInterim("");
      setStatus("idle");
      const text = finalsPart || interimFallback;

      if (userCancelledRef.current) {
        userCancelledRef.current = false;
        return;
      }

      if (text) onFinalRef.current(text);

      if (!sessionOpenRef.current) {
        return;
      }

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!sessionOpenRef.current) return;
        beginRoundRef.current();
      }, RESTART_MS);
    };

    recRef.current = r;
    return () => {
      clearIdleCloseTimer();
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try {
        r.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, [clearIdleCloseTimer]);

  const startSession = useCallback(() => {
    if (!recRef.current) return;
    if (sessionOpenRef.current) return;
    sessionOpenRef.current = true;
    setSessionOpen(true);
    beginListeningRound();
    scheduleIdleCloseTimer();
  }, [beginListeningRound, scheduleIdleCloseTimer]);

  const endSession = useCallback(() => {
    clearIdleCloseTimer();
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    sessionOpenRef.current = false;
    setSessionOpen(false);
    if (listeningRef.current && recRef.current) {
      userCancelledRef.current = true;
      try {
        recRef.current.abort();
      } catch {
        listeningRef.current = false;
        setStatus("idle");
        userCancelledRef.current = false;
      }
    } else {
      userCancelledRef.current = false;
    }
  }, [clearIdleCloseTimer]);

  useEffect(() => {
    endSessionRef.current = endSession;
  }, [endSession]);

  const toggleSession = useCallback(() => {
    if (sessionOpenRef.current) {
      endSession();
    } else {
      startSession();
    }
  }, [startSession, endSession]);

  return {
    /** 客戶端掛載完成前為 false，避免與伺服器端 HTML 水合不相符 */
    clientReady,
    /** 僅在 clientReady 之後再反映瀏覽器是否具備 Web Speech */
    supported: clientReady && isBrowserSttSupported(),
    status,
    interim,
    sessionOpen,
    isListening: status === "listening",
    startSession,
    endSession,
    toggleSession,
  };
}
