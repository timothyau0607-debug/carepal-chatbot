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
  const listeningRef = useRef(false);
  const sessionOpenRef = useRef(false);
  const userCancelledRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginRoundRef = useRef<() => void>(() => {});

  useEffect(() => {
    queueMicrotask(() => setClientReady(true));
  }, []);

  useEffect(() => {
    onFinalRef.current = onFinal;
    onErrorRef.current = onError;
  }, [onFinal, onError]);

  const beginListeningRound = useCallback(() => {
    if (!recRef.current) return;
    if (!sessionOpenRef.current) return;
    if (listeningRef.current) return;
    try {
      userCancelledRef.current = false;
      finalsRef.current = [];
      setInterim("");
      setStatus("listening");
      listeningRef.current = true;
      recRef.current.start();
    } catch {
      setStatus("error");
      listeningRef.current = false;
      sessionOpenRef.current = false;
      setSessionOpen(false);
      onErrorRef.current?.("無法啟動語音辨識。請關閉後再開啟收一次。");
    }
  }, []);

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
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const part = e.results[i]!;
        const piece = part[0].transcript;
        if (part.isFinal) {
          finalsRef.current.push(piece);
        } else {
          inter += piece;
        }
      }
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
      setInterim("");
      setStatus("idle");
      const text = finalsRef.current.join("").replace(/\s+/g, " ").trim();
      finalsRef.current = [];

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
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try {
        r.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  const startSession = useCallback(() => {
    if (!recRef.current) return;
    if (sessionOpenRef.current) return;
    sessionOpenRef.current = true;
    setSessionOpen(true);
    beginListeningRound();
  }, [beginListeningRound]);

  const endSession = useCallback(() => {
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
  }, []);

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
