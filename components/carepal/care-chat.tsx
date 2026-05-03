"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { Loader2, Send, Sparkles, ThumbsUp, Volume2, VolumeX } from "lucide-react";
import { pickXiaoqingVoice, XIAOQING_TTS } from "@/lib/carepal/tts-voice-pick";
import {
  FormattedMessageBody,
  plainTextForSpeechFromAssistant,
} from "@/lib/carepal/chat-message-display";
import { initialAssistantWelcome } from "@/lib/carepal/hospital-welcome";
import { pickProactiveCareTipForVariety } from "@/lib/carepal/proactive-care-tips";
import { persistStaffCheerSnippet } from "@/lib/carepal/persist-staff-cheer-snippet";
import { formatCarepalStaffSignalStamp } from "@/lib/carepal/staff-signal-stamp";
import {
  looksLikeDirectedStaffLetter,
  STAFF_LETTER_RECALL_WINDOW_MS,
} from "@/lib/carepal/staff-letter-from-chat";
import type { UserRole } from "@/lib/carepal/user-role";
import type { LocalProfileSnapshot } from "@/lib/carepal/local-profile";

type ChatMsg = { role: "user" | "assistant"; content: string };

type Source = { source: string; snippet: string };

type ChatResponse = {
  reply: string;
  sources: Source[];
  mode: "llm" | "demo";
  /** 本輪有注入「對話中段小錦囊」時，為當時的使用者訊息則數 */
  midTipOfferedAt?: number;
  /** 本輪在主答後顯示「醫護打氣／按讚」互動區 */
  staffCheerOffer?: boolean;
  /** 對應顯示區塊節流用的使用者訊息則數 */
  staffCheerOfferAt?: number;
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
  const welcomeInitRef = useRef(false);
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
  /** 上一次伺服器在對話中段注入小錦囊時的 user 訊息則數；0 表示尚無 */
  const lastProactiveTipUserCountRef = useRef(0);
  /** 上一次顯示醫護打氣／按讚區時的 user 訊息則數；0 表示尚無 */
  const lastStaffCheerOfferUserCountRef = useRef(0);
  /** 哪些 assistant 氣泡底下要顯示打氣／按讚區（key = messages 索引） */
  const [staffCheerOfferByAssistantIdx, setStaffCheerOfferByAssistantIdx] =
    useState<Record<number, true>>({});
  /** 近端曾顯示打氣區：此時間後一段時間內，符合語意的輸入可自動寫入醫護互動 */
  const staffLetterPromptOpenedAtMsRef = useRef(0);
  /** 由上方面板開啟：下一則輸入一併寫入「與醫護互動」 */
  const [captureNextLineForStaff, setCaptureNextLineForStaff] = useState(false);
  useEffect(() => {
    onBeforeTtsRef.current = onBeforeTtsPlay;
  }, [onBeforeTtsPlay]);
  useEffect(() => {
    onAfterTtsRef.current = onAfterTtsPlay;
  }, [onAfterTtsPlay]);
  useEffect(() => {
    readAloudRef.current = readAloud;
  }, [readAloud]);

  useEffect(() => {
    if (clientProfile === null) return;
    if (welcomeInitRef.current) return;
    welcomeInitRef.current = true;

    if (userRole === "staff") {
      const baseWelcome = initialAssistantWelcome(userRole, clientProfile);
      setMessages([{ role: "assistant", content: "" }]);
      void (async () => {
        try {
          const res = await fetch("/api/carepal/staff-opening");
          const j = (await res.json()) as { briefing?: string };
          const b =
            typeof j.briefing === "string" ? j.briefing.trim() : "";
          setTypewriterTarget(
            b.length > 0 ? `${baseWelcome}\n\n${b}` : baseWelcome
          );
        } catch {
          setTypewriterTarget(baseWelcome);
        }
      })();
      return;
    }

    if (userRole !== "family" && userRole !== "patient") {
      const welcome = initialAssistantWelcome(userRole, clientProfile);
      setMessages([{ role: "assistant", content: "" }]);
      setTypewriterTarget(welcome);
      return;
    }

    setMessages([{ role: "assistant", content: "" }]);

    const welcomeTipNonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    let welcomeOpts:
      | { tipVarietyKey: string }
      | undefined;

    if (userRole === "family") {
      const pocketRaw = pickProactiveCareTipForVariety(
        userRole,
        welcomeTipNonce
      ).trim();
      if (pocketRaw) {
        onRagUpdate([
          {
            source: "照顧者小錦囊",
            snippet:
              pocketRaw.length > 150
                ? pocketRaw.slice(0, 150) + "…"
                : pocketRaw,
          },
        ]);
      }
      welcomeOpts = { tipVarietyKey: welcomeTipNonce };
    }

    const welcome = initialAssistantWelcome(userRole, clientProfile, welcomeOpts);
    setTypewriterTarget(welcome);
  }, [userRole, clientProfile, onRagUpdate]);

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

  const persistStaffReaction = useCallback(
    async (kind: "cheer" | "like") => {
      if (!clientProfile || !userKey?.trim()) return;
      const stamp = formatCarepalStaffSignalStamp();
      const line =
        kind === "cheer"
          ? `[介面紀錄｜${stamp}] 經對話區向醫護／團隊「打氣」。`
          : `[介面紀錄｜${stamp}] 經對話區對醫護／團隊「按讚」肯定。`;
      await persistStaffCheerSnippet({
        userKey,
        userRole,
        clientProfile,
        line,
      });
      onReplyComplete?.();
    },
    [clientProfile, onReplyComplete, userKey, userRole]
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
      const assistantBubbleIndex = next.length;
      setMessages(next);
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next,
            userRole,
            lastProactiveTipUserCount: lastProactiveTipUserCountRef.current,
            lastStaffCheerOfferUserCount: lastStaffCheerOfferUserCountRef.current,
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
        if (typeof data.midTipOfferedAt === "number") {
          lastProactiveTipUserCountRef.current = data.midTipOfferedAt;
        }
        if (
          typeof data.staffCheerOfferAt === "number" &&
          data.staffCheerOffer === true
        ) {
          lastStaffCheerOfferUserCountRef.current = data.staffCheerOfferAt;
        }

        const key = userKey?.trim();
        let staffLetterMerged = false;
        if (key && clientProfile) {
          if (captureNextLineForStaff) {
            const line = `[對話區留言（已標記紀錄）｜${formatCarepalStaffSignalStamp()}] ${t.slice(
              0,
              1500
            )}`;
            const r = await persistStaffCheerSnippet({
              userKey: key,
              userRole,
              clientProfile,
              line,
            });
            if (r.ok) {
              setCaptureNextLineForStaff(false);
              staffLetterMerged = true;
            }
          } else if (
            staffLetterPromptOpenedAtMsRef.current > 0 &&
            Date.now() - staffLetterPromptOpenedAtMsRef.current <=
              STAFF_LETTER_RECALL_WINDOW_MS &&
            looksLikeDirectedStaffLetter(t)
          ) {
            const line = `[對話區留言（自動辨識致醫護／團隊）｜${formatCarepalStaffSignalStamp()}] ${t.slice(
              0,
              1500
            )}`;
            const r = await persistStaffCheerSnippet({
              userKey: key,
              userRole,
              clientProfile,
              line,
            });
            if (r.ok) staffLetterMerged = true;
          }
          if (staffLetterMerged) onReplyComplete?.();
        }

        if (data.staffCheerOffer === true) {
          staffLetterPromptOpenedAtMsRef.current = Date.now();
          setStaffCheerOfferByAssistantIdx((prev) => ({
            ...prev,
            [assistantBubbleIndex]: true,
          }));
        }

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
      onReplyComplete,
      captureNextLineForStaff,
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
        {(() => {
          const lastIdx = messages.length > 0 ? messages.length - 1 : -1;
          /** 上一則小晴內容仍逐字顯示／排程中時，不在該格掛載打氣區 */
          const hideCheerOnLastBubbleWhileTyping =
            lastIdx >= 0 &&
            messages[lastIdx]?.role === "assistant" &&
            (assistantTyping || typewriterTarget != null);
          return messages.map((m, i) => (
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
              {m.role === "assistant" &&
                m.content.trim().length > 0 &&
                (userRole === "family" || userRole === "patient") &&
                staffCheerOfferByAssistantIdx[i] &&
                !(hideCheerOnLastBubbleWhileTyping && i === lastIdx) ? (
                <StaffCheerBar
                  compact={compact}
                  canPersist={Boolean(userKey?.trim() && clientProfile)}
                  captureNextLineForStaff={captureNextLineForStaff}
                  onCaptureNextLineForStaffChange={setCaptureNextLineForStaff}
                  onPick={(kind) => persistStaffReaction(kind)}
                />
              ) : null}
            </div>
          </div>
        ));
        })()}
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
          className={
            compact
              ? "min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-base leading-snug text-stone-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-teal-500"
              : "min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-2 py-2 text-sm text-stone-800 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-teal-500 sm:px-3"
          }
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
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-xl bg-teal-600 font-medium text-white shadow-sm transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "min-h-[2.75rem] px-3 py-2 text-base" : "px-3 py-2 text-sm"}`}
        >
          <Send className="size-4 shrink-0" aria-hidden />
          <span className={compact ? "sr-only" : undefined}>送出</span>
        </button>
      </form>
    </div>
  );
});

type StaffCheerBarProps = {
  compact: boolean;
  /** 有可寫入的 userKey／畫像時為 true（否則僅示意） */
  canPersist: boolean;
  /** 下一則輸入框文字寫入醫護互動欄 */
  captureNextLineForStaff: boolean;
  onCaptureNextLineForStaffChange: (next: boolean) => void;
  onPick: (kind: "cheer" | "like") => Promise<void>;
};

function StaffCheerBar({
  compact,
  canPersist,
  captureNextLineForStaff,
  onCaptureNextLineForStaffChange,
  onPick,
}: StaffCheerBarProps) {
  const [cheerDone, setCheerDone] = useState(false);
  const [likeDone, setLikeDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (kind: "cheer" | "like") => {
    if (busy) return;
    if (!canPersist) return;
    setBusy(true);
    try {
      await onPick(kind);
      if (kind === "cheer") setCheerDone(true);
      else setLikeDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-3 border-t border-dashed border-stone-200/90 pt-2.5"
      role="group"
      aria-label="醫護打氣與按讚"
    >
      <p
        className={
          compact
            ? "text-[0.7rem] leading-snug text-stone-600"
            : "text-xs leading-relaxed text-stone-600"
        }
      >
        若你也想替院內醫護／團隊打氣或默默按讚，可以點下面圖示；想多謝幾句，也歡迎用
        <strong className="font-medium text-stone-800">下面的輸入框</strong>
        留言給小晴帶著走～都量力就好，沒有任何壓力。具體感謝醫護／團隊的句子，在你送出後也會盡量寫進畫像裡；或點「下一則一併紀錄」更保險。
      </p>
      {!canPersist ? (
        <p className="mt-1.5 text-[0.65rem] text-amber-700/90">
          取得訪客識別並載入畫像後，再點選即可一併寫進「與醫護互動」紀錄。
        </p>
      ) : (
        <button
          type="button"
          onClick={() =>
            onCaptureNextLineForStaffChange(!captureNextLineForStaff)
          }
          className={
            captureNextLineForStaff
              ? compact
                ? "mt-2 w-full rounded-lg border-2 border-teal-500 bg-teal-50/90 px-2 py-1.5 text-left text-[0.65rem] font-medium text-teal-900"
                : "mt-2 w-full rounded-lg border-2 border-teal-500 bg-teal-50/90 px-2.5 py-2 text-left text-xs font-medium text-teal-900"
              : compact
                ? "mt-2 w-full rounded-lg border border-stone-200/90 bg-white/80 px-2 py-1.5 text-left text-[0.65rem] text-stone-600 hover:bg-stone-50"
                : "mt-2 w-full rounded-lg border border-stone-200/90 bg-white/80 px-2.5 py-2 text-left text-xs text-stone-600 hover:bg-stone-50"
          }
        >
          {captureNextLineForStaff
            ? "已開啟：下一則你在輸入框打的字，送出後會一併寫進「與醫護互動」。再點可取消。"
            : "下一則輸入：一併紀錄到「與醫護互動」（畫像）"}
        </button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canPersist || busy || cheerDone}
          onClick={() => void run("cheer")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-900 shadow-sm transition hover:bg-amber-100/90 disabled:pointer-events-none disabled:opacity-45"
          aria-label="向醫護打氣"
        >
          <Sparkles className="size-4 shrink-0 text-amber-600" aria-hidden />
          {cheerDone ? "已傳達打氣" : "打氣"}
        </button>
        <button
          type="button"
          disabled={!canPersist || busy || likeDone}
          onClick={() => void run("like")}
          className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200/90 bg-teal-50/80 px-3 py-2 text-xs font-medium text-teal-900 shadow-sm transition hover:bg-teal-100/90 disabled:pointer-events-none disabled:opacity-45"
          aria-label="按讚肯定醫護"
        >
          <ThumbsUp className="size-4 shrink-0 text-teal-600" aria-hidden />
          {likeDone ? "已按讚紀錄" : "按讚"}
        </button>
      </div>
    </div>
  );
}

export const CareChat = CareChatInner;
CareChat.displayName = "CareChat";
