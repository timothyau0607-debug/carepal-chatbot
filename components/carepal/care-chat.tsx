"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
} from "react";
import { Loader2, Send, Volume2, VolumeX } from "lucide-react";
import { pickXiaoqingVoice, XIAOQING_TTS } from "@/lib/carepal/tts-voice-pick";
import {
  FormattedMessageBody,
  plainTextForSpeechFromAssistant,
} from "@/lib/carepal/chat-message-display";
import { initialAssistantWelcome } from "@/lib/carepal/hospital-welcome";
import type { UserRole } from "@/lib/carepal/user-role";
import type { LocalProfileSnapshot } from "@/lib/carepal/local-profile";

type ChatMsg = { role: "user" | "assistant"; content: string };

type Source = { source: string; snippet: string };

type ChatResponse = {
  reply: string;
  sources: Source[];
  mode: "llm" | "demo";
};

export type CareChatHandle = {
  /** 從語音轉寫等外部來源送出一則使用者訊息（走與表單相同邏輯） */
  submitUserText: (text: string) => Promise<void>;
};

type Props = {
  onRagUpdate: (sources: Source[]) => void;
  onActivityLine: (line: string) => void;
  /** 與 Supabase 長期記憶關聯的訪客識別（由父層 useCarePalIdentity 等提供） */
  userKey?: string | null;
  userRole: UserRole;
  clientProfile: LocalProfileSnapshot | null;
  /** 小晴回覆成功寫入後觸發（可重新載入左欄畫像） */
  onReplyComplete?: () => void;
  /** 系統朗讀小晴回覆之前觸發：應關閉麥克風，避免揚聲器被聽寫成輸入 */
  onBeforeTtsPlay?: () => void;
  /** 朗讀自然結束或失敗時觸發（可於此恢復先前方才關閉的麥克風） */
  onAfterTtsPlay?: () => void;
  /** 手機 Demo：隱藏開發說明、縮短欄位 */
  compact?: boolean;
};

const CareChatInner = forwardRef<CareChatHandle, Props>(function CareChat(
  {
    onRagUpdate,
    onActivityLine,
    userKey,
    userRole,
    clientProfile,
    onReplyComplete,
    onBeforeTtsPlay,
    onAfterTtsPlay,
    compact = false,
  },
  ref
) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const didSeedWelcome = useRef(false);
  /** 第一輪逐字顯示為開場白，完成時不觸發 onReplyComplete */
  const skipNextReplyCompleteRef = useRef(true);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const ttsIndexRef = useRef(-1);
  const onBeforeTtsRef = useRef(onBeforeTtsPlay);
  const onAfterTtsRef = useRef(onAfterTtsPlay);
  const readAloudRef = useRef(readAloud);
  useEffect(() => {
    onBeforeTtsRef.current = onBeforeTtsPlay;
  }, [onBeforeTtsPlay]);
  useEffect(() => {
    onAfterTtsRef.current = onAfterTtsPlay;
  }, [onAfterTtsPlay]);
  useEffect(() => {
    readAloudRef.current = readAloud;
  }, [readAloud]);

  useLayoutEffect(() => {
    if (didSeedWelcome.current) return;
    if (clientProfile === null) return;
    didSeedWelcome.current = true;
    const welcome = initialAssistantWelcome(userRole, clientProfile);
    setMessages([{ role: "assistant", content: "" }]);
    setTypewriterTarget(welcome);
  }, [userRole, clientProfile]);

  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const onReplyCompleteRef = useRef(onReplyComplete);
  useEffect(() => {
    onReplyCompleteRef.current = onReplyComplete;
  }, [onReplyComplete]);

  /** 小晴回覆逐字顯示中（避免讀到一半就朗讀） */
  const [assistantTyping, setAssistantTyping] = useState(false);
  const [typewriterTarget, setTypewriterTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!typewriterTarget) return;
    let i = 0;
    const full = typewriterTarget;
    if (!full) {
      setTypewriterTarget(null);
      setAssistantTyping(false);
      return;
    }
    let cancelled = false;
    setAssistantTyping(true);
    const step = () => {
      if (cancelled) return;
      i += 1;
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const c = [...prev];
        const last = c.length - 1;
        if (c[last]?.role !== "assistant") return prev;
        c[last] = { role: "assistant", content: full.slice(0, i) };
        return c;
      });
      if (i < full.length) {
        window.setTimeout(step, 20);
      } else {
        setTypewriterTarget(null);
        setAssistantTyping(false);
        if (skipNextReplyCompleteRef.current) {
          skipNextReplyCompleteRef.current = false;
        } else {
          onReplyCompleteRef.current?.();
        }
      }
    };
    step();
    return () => {
      cancelled = true;
    };
  }, [typewriterTarget]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const syn = window.speechSynthesis;
    const sync = () => {
      const v = pickXiaoqingVoice(syn.getVoices());
      ttsVoiceRef.current = v;
    };
    sync();
    syn.addEventListener("voiceschanged", sync);
    return () => syn.removeEventListener("voiceschanged", sync);
  }, []);

  const scrollListToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  /** API 已取得完整回覆時立即播出（不依賴逐字顯示結束），較接近即時對話 */
  const playReadAloudForFullReply = useCallback(
    (rawReply: string, assistantMessageIndex: number) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      if (!readAloudRef.current) return;
      const ttsText = plainTextForSpeechFromAssistant(rawReply);
      if (!ttsText.trim()) {
        ttsIndexRef.current = assistantMessageIndex;
        return;
      }
      ttsIndexRef.current = assistantMessageIndex;
      window.speechSynthesis.cancel();
      onBeforeTtsRef.current?.();
      const u = new SpeechSynthesisUtterance(ttsText);
      const voice =
        ttsVoiceRef.current ??
        pickXiaoqingVoice(window.speechSynthesis.getVoices());
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang && voice.lang.length > 0 ? voice.lang : "zh-TW";
      } else {
        u.lang = "zh-TW";
      }
      u.rate = XIAOQING_TTS.rate;
      u.pitch = XIAOQING_TTS.pitch;
      u.onend = () => {
        if (readAloudRef.current) onAfterTtsRef.current?.();
      };
      u.onerror = () => {
        if (readAloudRef.current) onAfterTtsRef.current?.();
      };
      window.speechSynthesis.speak(u);
    },
    []
  );

  const submitUserText = useCallback(
    async (raw: string) => {
      const t = raw.trim();
      if (!t || loading || assistantTyping) return;
      setError(null);
      setText("");

      onActivityLine(
        `剛剛：${t.length > 36 ? t.slice(0, 36) + "…" : t}`
      );

      const next: ChatMsg[] = [...messages, { role: "user", content: t }];
      setMessages(next);
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next,
            userRole,
            ...(userKey ? { userKey } : {}),
            ...(clientProfile
              ? {
                  clientProfile: {
                    display_name: clientProfile.display_name,
                    family_notes: clientProfile.family_notes,
                    mood_note: clientProfile.mood_note,
                    inferred_profile: clientProfile.inferred_profile,
                    preferences: clientProfile.preferences,
                    traits: clientProfile.traits,
                    visit_context: clientProfile.visit_context,
                    staff_interaction_satisfaction:
                      clientProfile.staff_interaction_satisfaction,
                    memory_lines: clientProfile.memory_lines,
                  },
                }
              : {}),
          }),
        });
        const data = (await res.json()) as ChatResponse & { error?: string };
        if (!res.ok) {
          setError(data.error ?? `錯誤 ${res.status}`);
          setLoading(false);
          return;
        }
        onRagUpdate(data.sources);
        setLoading(false);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "" },
        ]);
        const reply = data.reply ?? "";
        setTypewriterTarget(reply);
        playReadAloudForFullReply(reply, next.length);
      } catch {
        setError("網路錯誤，請再試一次。");
        setLoading(false);
      }
    },
    [
      loading,
      assistantTyping,
      messages,
      onRagUpdate,
      onActivityLine,
      userKey,
      userRole,
      clientProfile,
      playReadAloudForFullReply,
    ]
  );

  useEffect(() => {
    scrollListToEnd("smooth");
  }, [messages, loading, assistantTyping, scrollListToEnd]);

  useImperativeHandle(
    ref,
    () => ({
      submitUserText,
    }),
    [submitUserText]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!readAloud) {
      window.speechSynthesis.cancel();
      ttsIndexRef.current = -1;
      return;
    }
    if (loading || assistantTyping) return;
    const last = messages.length - 1;
    if (last < 0) return;
    const m = messages[last];
    if (m?.role !== "assistant") return;
    if (ttsIndexRef.current === last) return;
    playReadAloudForFullReply(m.content, last);
  }, [messages, readAloud, loading, assistantTyping, playReadAloudForFullReply]);

  return (
    <div
      className={
        compact
          ? "flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-2 overflow-x-hidden px-1 pb-1"
          : "flex w-full max-w-lg min-w-0 shrink-0 flex-col gap-3 px-2 pb-4"
      }
    >
      {!compact && (
        <p className="shrink-0 text-center text-xs text-stone-500">
          已串接
          <strong className="font-medium"> 語音辨識（瀏覽器）</strong>
          與文字。LLM 需
          <code className="mx-0.5 rounded bg-stone-200/60 px-1">
            OPENROUTER_API_KEY
          </code>
          等，見 .env.local。
        </p>
      )}

      <div
        ref={listRef}
        role="log"
        aria-relevant="additions"
        aria-label="對話內容"
        className={
          compact
            ? "min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-xl border border-stone-200/90 bg-white/95 p-2.5 text-sm text-stone-800 shadow-inner"
            : "h-80 min-h-0 shrink-0 space-y-3 overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth rounded-xl border border-stone-200/90 bg-white/90 p-3 text-sm text-stone-800 shadow-inner [scrollbar-gutter:stable]"
        }
      >
        {messages.length === 0 && (
          <p className="text-stone-500">
            {compact
              ? "打字或語音問小晴。"
              : "可打字或點麥克風說話。例如：「阿公傍晚一直想出門怎麼辦？」"}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[min(22rem,calc(100%-0.25rem))] min-w-0 rounded-lg bg-teal-50/90 px-3 py-2 text-stone-800"
                  : "max-w-[min(22rem,calc(100%-0.25rem))] min-w-0 rounded-lg bg-stone-100/90 px-3 py-2.5 text-stone-800"
              }
            >
              <p className="text-xs text-stone-500">
                {m.role === "user" ? "你" : "小晴"} ·
              </p>
              <div className="mt-1 min-w-0">
                <FormattedMessageBody role={m.role} content={m.content} />
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <p className="flex items-center gap-2 text-stone-500">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            小晴正在整理思緒…
          </p>
        )}
      </div>

      {error && (
        <p className="text-center text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}

      <label
        className={
          compact
            ? "grid w-full min-w-0 shrink-0 cursor-pointer select-none grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-[0.7rem] text-stone-600"
            : "flex min-h-0 shrink-0 cursor-pointer select-none items-center justify-center gap-2 text-xs text-stone-600"
        }
      >
        <span className="flex shrink-0 items-start gap-2 pt-0.5">
          <input
            type="checkbox"
            className="rounded border-stone-300"
            checked={readAloud}
            onChange={(e) => {
              if (!e.target.checked) {
                ttsIndexRef.current = -1;
                if (typeof window !== "undefined" && "speechSynthesis" in window) {
                  window.speechSynthesis.cancel();
                }
              }
              setReadAloud(e.target.checked);
            }}
          />
          {readAloud ? (
            <Volume2 className="size-3 shrink-0 text-teal-600" />
          ) : (
            <VolumeX className="size-3 shrink-0 text-stone-400" />
          )}
        </span>
        {compact ? (
          <span className="min-w-0 leading-snug">
            朗讀小晴回覆（會暫停收音）
          </span>
        ) : (
          <>
            朗讀小晴最後一則回覆：會
            <strong>優先選繁中台灣女聲</strong>並微調節奏（仍依瀏覽器／
            OS 內建引擎）。若要人設穩定，日後可改接
            <strong>雲端 TTS</strong>。朗讀時會
            <strong>暫關麥克風</strong>；讀畢、且朗讀前本來有開連續收音者會
            <strong>自動再開</strong>（短暫間隔，減少回音）。
          </>
        )}
      </label>

      <form
        className="flex w-full min-w-0 shrink-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitUserText(text);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-teal-500 sm:px-3"
          placeholder="輸入想問的照護問題…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={800}
          disabled={loading || assistantTyping}
          aria-label="訊息輸入"
        />
        <button
          type="submit"
          disabled={loading || assistantTyping || !text.trim()}
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-xl bg-teal-600 font-medium text-white shadow-sm transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "px-2.5 py-2 text-sm" : "px-3 py-2 text-sm"}`}
        >
          <Send className="size-4 shrink-0" aria-hidden />
          <span className={compact ? "sr-only" : undefined}>送出</span>
        </button>
      </form>
    </div>
  );
});

export const CareChat = CareChatInner;
CareChat.displayName = "CareChat";
