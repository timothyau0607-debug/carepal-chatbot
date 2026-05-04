"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquarePlus,
  Send,
  ThumbsUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import { pickXiaoqingVoice, XIAOQING_TTS } from "@/lib/carepal/tts-voice-pick";
import {
  FormattedMessageBody,
  normalizeAssistantTextForDisplay,
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
import { shouldShowStaffFooterBar } from "@/lib/carepal/staff-cheer-offer";
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
  /** 與 messages 同步，避免 submit 閉包讀到較舊的開場白內容 */
  const messagesRef = useRef<ChatMsg[]>(messages);
  messagesRef.current = messages;
  const welcomeInitRef = useRef(false);
  /** 第一輪逐字顯示為開場白，完成時不觸發 onReplyComplete */
  const skipNextReplyCompleteRef = useRef(true);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  /** 小晴逐字輸入／載入等非同步發話鎖（須宣告在 welcome effect 之前） */
  const [assistantTyping, setAssistantTyping] = useState(false);
  const [typewriterTarget, setTypewriterTarget] = useState<string | null>(
    null
  );
  const listRef = useRef<HTMLDivElement>(null);
  /** 使用者送出後：下一幀將其氣泡捲至清單頂緣（小晴在下面長出） */
  const pendingAlignLatestUserBubbleRef = useRef(false);
  /** 自使用者送出後、小晴開始打字前：不要自動捲到底（避免蓋過「問題置頂」） */
  const suppressScrollBottomUntilAssistantTypingRef = useRef(false);
  /** 只要對話區曾出現過使用者：小晴該輪打字結束後不要自動捲到底（長文閱讀） */
  const suppressScrollBottomAfterAssistantDoneRef = useRef(false);
  const ttsIndexRef = useRef(-1);
  const onBeforeTtsRef = useRef(onBeforeTtsPlay);
  const onAfterTtsRef = useRef(onAfterTtsPlay);
  const readAloudRef = useRef(readAloud);
  /** 上一次伺服器在對話中段注入小錦囊時的 user 訊息則數；0 表示尚無 */
  const lastProactiveTipUserCountRef = useRef(0);
  /** 上一次顯示醫護打氣／按讚區時的 user 訊息則數；0 表示尚無 */
  const lastStaffCheerOfferUserCountRef = useRef(0);
  /** 近端伺服器曾建議開啟「醫護打氣」後：此時間內對話自動辨識可併入致醫護留言 */
  const staffLetterPromptOpenedAtMsRef = useRef(0);
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
      /** 非同步載入 briefing 期間視同小晴發話中，避免送出時 API 拿不到開場正文 */
      setAssistantTyping(true);
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

  useEffect(() => {
    if (!typewriterTarget) return;
    let i = 0;
    const rawFull = typewriterTarget;
    if (!rawFull) {
      setTypewriterTarget(null);
      setAssistantTyping(false);
      return;
    }
    /** 先對完整回覆做一次顯示正規化後再切片；輸出的段落與完稿後 FormattedMessageBody 同一套 pre-wrap（不再切換版面）。 */
    const displayFull = normalizeAssistantTextForDisplay(rawFull);
    if (displayFull.length === 0) {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const c = [...prev];
        const last = c.length - 1;
        if (c[last]?.role !== "assistant") return prev;
        c[last] = { role: "assistant", content: "" };
        return c;
      });
      setTypewriterTarget(null);
      setAssistantTyping(false);
      if (skipNextReplyCompleteRef.current) {
        skipNextReplyCompleteRef.current = false;
      } else {
        onReplyCompleteRef.current?.();
      }
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
        c[last] = {
          role: "assistant",
          content: displayFull.slice(0, Math.min(i, displayFull.length)),
        };
        return c;
      });
      if (i < displayFull.length) {
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

  const alignLatestUserMessageToTop = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(
      "[data-carepal-latest-user-pin]"
    );
    if (!row) return;

    /** 對齊到最近捲動父層的可視區頂部，再細調留白 */
    row.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });

    const insetPx = compact ? 6 : 8;
    const dy =
      row.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      insetPx;
    const nextTop = list.scrollTop + dy;
    const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTo({
      top: Math.max(0, Math.min(nextTop, maxTop)),
      behavior: "auto",
    });
  }, [compact]);

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

  const persistStaffLike = useCallback(async () => {
    if (!clientProfile || !userKey?.trim()) return;
    const stamp = formatCarepalStaffSignalStamp();
    const line = `[介面紀錄｜${stamp}] 經對話區對醫護／團隊「按讚」肯定。`;
    await persistStaffCheerSnippet({
      userKey,
      userRole,
      clientProfile,
      line,
    });
    onReplyComplete?.();
  }, [clientProfile, onReplyComplete, userKey, userRole]);

  const persistStaffDedicatedLetter = useCallback(
    async (noteRaw: string) => {
      const key = userKey?.trim();
      const trimmed = noteRaw.trim();
      if (!key || !clientProfile || !trimmed.length) return false;
      const line = `[對話區留言（給醫護／團隊）｜${formatCarepalStaffSignalStamp()}] ${trimmed.slice(
        0,
        1500
      )}`;
      const r = await persistStaffCheerSnippet({
        userKey: key,
        userRole,
        clientProfile,
        line,
      });
      if (r.ok) onReplyComplete?.();
      return r.ok;
    },
    [clientProfile, onReplyComplete, userKey, userRole]
  );

  const submitUserText = useCallback(
    async (raw: string) => {
      const t = raw.trim();
      if (!t || loading || assistantTyping) return;
      const snapshot = messagesRef.current;
      const last = snapshot.length > 0 ? snapshot[snapshot.length - 1] : null;
      /** 開場白尚未寫入（例如醫護端非同步載入 briefing）、或小晴回覆氣泡仍空白時，不要送出，否則 API 缺少上一則小晴內容 */
      if (last?.role === "assistant" && !last.content.trim()) return;
      setError(null);
      setText("");

      onActivityLine(
        `剛剛：${t.length > 36 ? t.slice(0, 36) + "…" : t}`
      );

      const next: ChatMsg[] = [...snapshot, { role: "user", content: t }];
      setMessages(next);
      pendingAlignLatestUserBubbleRef.current = true;
      suppressScrollBottomUntilAssistantTypingRef.current = true;
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
          suppressScrollBottomUntilAssistantTypingRef.current = false;
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
          if (
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
        suppressScrollBottomUntilAssistantTypingRef.current = false;
      }
    },
    [
      loading,
      assistantTyping,
      onRagUpdate,
      onActivityLine,
      userKey,
      userRole,
      clientProfile,
      playReadAloudForFullReply,
      onReplyComplete,
    ]
  );

  const lastUserMessageIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]?.role === "user") idx = i;
    }
    return idx;
  }, [messages]);

  useLayoutEffect(() => {
    if (!pendingAlignLatestUserBubbleRef.current) return;
    pendingAlignLatestUserBubbleRef.current = false;
    alignLatestUserMessageToTop();
    queueMicrotask(() => {
      alignLatestUserMessageToTop();
    });
    window.requestAnimationFrame(() => {
      alignLatestUserMessageToTop();
      window.requestAnimationFrame(() => alignLatestUserMessageToTop());
    });
  }, [messages, loading, alignLatestUserMessageToTop]);

  useEffect(() => {
    const hasAnyUserBubble = messages.some((m) => m.role === "user");
    if (assistantTyping) {
      suppressScrollBottomUntilAssistantTypingRef.current = false;
      if (hasAnyUserBubble) {
        suppressScrollBottomAfterAssistantDoneRef.current = true;
      }
      return;
    }
    if (suppressScrollBottomUntilAssistantTypingRef.current) {
      return;
    }
    if (suppressScrollBottomAfterAssistantDoneRef.current) {
      suppressScrollBottomAfterAssistantDoneRef.current = false;
      return;
    }
    scrollListToEnd(messages.some((m) => m.role === "user") ? "smooth" : "auto");
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
            ? "relative min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-xl border border-stone-200/90 bg-white/95 p-2.5 text-sm text-stone-800 shadow-inner"
            : "relative h-80 min-h-0 shrink-0 space-y-3 overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth rounded-xl border border-stone-200/90 bg-white/90 p-3 text-sm text-stone-800 shadow-inner [scrollbar-gutter:stable]"
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
            {...(m.role === "user" &&
            i === lastUserMessageIndex &&
            lastUserMessageIndex >= 0
              ? { "data-carepal-latest-user-pin": "" }
              : {})}
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
                <FormattedMessageBody
                  role={m.role}
                  content={m.content}
                  assistantNormalizedPrefix={
                    m.role === "assistant" &&
                    assistantTyping &&
                    i === messages.length - 1
                  }
                />
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

      {shouldShowStaffFooterBar({ userRole, messages }) ? (
        <StaffSignalsFooter
          compact={compact}
          canPersist={Boolean(userKey?.trim() && clientProfile)}
          onPersistLike={persistStaffLike}
          onPersistStaffLetter={persistStaffDedicatedLetter}
        />
      ) : null}

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
          placeholder={
            compact
              ? "輸入照護問題或想說的話…"
              : "輸入想問的照護問題…"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={800}
          disabled={loading || assistantTyping}
          aria-label="訊息輸入"
          enterKeyHint="send"
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

type StaffSignalsFooterProps = {
  compact: boolean;
  canPersist: boolean;
  onPersistLike: () => Promise<void>;
  onPersistStaffLetter: (note: string) => Promise<boolean>;
};

function StaffSignalsFooter({
  compact,
  canPersist,
  onPersistLike,
  onPersistStaffLetter,
}: StaffSignalsFooterProps) {
  const [likeDone, setLikeDone] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  /** 成功送出過「留言打氣」 */
  const [letterDone, setLetterDone] = useState(false);
  const [letterExpanded, setLetterExpanded] = useState(false);
  const [letterText, setLetterText] = useState("");
  const [letterBusy, setLetterBusy] = useState(false);
  const [letterOkHint, setLetterOkHint] = useState(false);
  /** false = 已按讚且已留言後收納成細列 */
  const [dockOpen, setDockOpen] = useState(true);
  /** 雙達成或手動收納時：往下離場後再換小橫列 */
  const [dismissAnimating, setDismissAnimating] = useState(false);

  const completeDismissIntoMiniStrip = useCallback(() => {
    setDismissAnimating(false);
    setDockOpen(false);
  }, []);

  const beginCollapseWithExitAnimation = useCallback(() => {
    setLetterExpanded(false);
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      completeDismissIntoMiniStrip();
      return;
    }
    setDismissAnimating(true);
  }, [completeDismissIntoMiniStrip]);

  useEffect(() => {
    if (!dismissAnimating) return;
    const t = window.setTimeout(() => {
      completeDismissIntoMiniStrip();
    }, 660);
    return () => window.clearTimeout(t);
  }, [dismissAnimating, completeDismissIntoMiniStrip]);

  const btnBase =
    compact
      ? "min-h-[2.85rem] flex-col gap-0.5 rounded-lg px-2 py-2 text-[0.7rem] font-medium leading-tight sm:flex-row sm:gap-1 sm:text-[0.68rem]"
      : "min-h-[2.875rem] flex-col gap-1 rounded-xl px-3 py-2 text-xs font-medium sm:flex-row sm:gap-1.5";

  const runLike = async () => {
    if (likeBusy || !canPersist || likeDone) return;
    setLikeBusy(true);
    try {
      await onPersistLike();
      setLikeDone(true);
      if (letterDone) {
        beginCollapseWithExitAnimation();
      }
    } finally {
      setLikeBusy(false);
    }
  };

  const submitLetter = async () => {
    const t = letterText.trim();
    if (!canPersist || !t || letterBusy) return;
    setLetterBusy(true);
    setLetterOkHint(false);
    try {
      const ok = await onPersistStaffLetter(t);
      if (ok) {
        setLetterDone(true);
        setLetterText("");
        setLetterOkHint(true);
        setLetterExpanded(false);
        if (likeDone) {
          beginCollapseWithExitAnimation();
        }
        window.setTimeout(() => setLetterOkHint(false), 3200);
      }
    } finally {
      setLetterBusy(false);
    }
  };

  const bothDone = likeDone && letterDone;

  if (bothDone && !dockOpen) {
    return (
      <div
        className={`shrink-0 rounded-xl border border-stone-200/85 bg-teal-50/50 shadow-inner backdrop-blur-[2px] ${
          compact ? "mt-1.5 px-2 py-1" : "mt-2 px-2.5 py-1.5"
        }`}
        role="region"
        aria-label="對醫護團隊按讚與留言打氣（已收納）"
      >
        <button
          type="button"
          aria-expanded={false}
          aria-controls="staff-footer-full-panel"
          onClick={() => setDockOpen(true)}
          className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg text-left text-stone-700 transition hover:bg-white/75 ${
            compact ? "py-1 text-[0.68rem]" : "py-0.5 text-xs"
          }`}
        >
          <span className="min-w-0 truncate">
            <span aria-hidden className="text-teal-600">
              ✓
            </span>{" "}
            已向醫護按讚並送出留言，
            <span className="whitespace-nowrap text-teal-800">點此展開區塊</span>
          </span>
          <ChevronDown
            className={`${compact ? "size-4" : "size-[1.125rem]"} shrink-0 text-teal-600`}
            aria-hidden
          />
        </button>
      </div>
    );
  }

  return (
    <div
      id="staff-footer-full-panel"
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!String(e.animationName ?? "").includes("carepal-staff-footer-dismiss-down")) return;
        completeDismissIntoMiniStrip();
      }}
      className={`shrink-0 rounded-xl border border-stone-200/90 bg-gradient-to-br from-teal-50/35 via-white to-stone-50/80 shadow-inner ${
        dismissAnimating
          ? "carepal-staff-footer-dismiss-down"
          : "carepal-staff-footer-enter"
      } ${compact ? "mt-2 px-2 py-2" : "px-3 py-2"}`}
      role="region"
      aria-label="對醫護團隊按讚與留言打氣"
    >
      {bothDone ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => beginCollapseWithExitAnimation()}
            className={`inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 font-medium text-stone-600 transition hover:border-stone-200/90 hover:bg-stone-50/90 ${
              compact ? "text-[0.65rem]" : "text-xs"
            }`}
          >
            <ChevronUp className="size-3.5 shrink-0" aria-hidden />
            收納區塊
          </button>
        </div>
      ) : null}

      <p
        className={
          compact
            ? "text-sm leading-snug text-stone-600"
            : "text-sm leading-relaxed text-stone-700"
        }
      >
        我們一起來為醫護打氣點讚，您的一個簡單的暖心動作，是對醫護的很大鼓勵〜！！
      </p>

      {!canPersist ? (
        <p className="mt-1.5 text-[0.65rem] leading-snug text-amber-800/90">
          載入訪客識別與畫像後才可寫進紀錄。
        </p>
      ) : null}

      <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canPersist || likeBusy || likeDone}
          aria-label="按讚肯定醫護"
          onClick={() => void runLike()}
          className={`inline-flex min-w-0 items-center justify-center border border-teal-200/90 bg-teal-50 text-teal-950 shadow-sm transition hover:bg-teal-100 disabled:pointer-events-none disabled:opacity-45 ${btnBase}`}
        >
          <ThumbsUp
            className={`${compact ? "size-4" : "size-[1.125rem]"} shrink-0 text-teal-600`}
            aria-hidden
          />
          <span>{likeDone ? "已按讚" : "按讚"}</span>
        </button>
        <button
          type="button"
          aria-expanded={letterExpanded}
          aria-controls="staff-dedicated-letter-panel"
          aria-label="展開或收合留言打氣（非跟小晴對話）"
          onClick={() =>
            setLetterExpanded((prev) => {
              const next = !prev;
              if (next)
                queueMicrotask(() =>
                  document
                    .getElementById("staff-dedicated-letter-input")
                    ?.focus()
                );
              return next;
            })
          }
          className={`inline-flex min-w-0 items-center justify-center shadow-sm transition ${btnBase} ${
            letterExpanded
              ? "border-2 border-amber-500/90 bg-amber-50 text-amber-950"
              : "border border-stone-200/90 bg-white text-stone-800 hover:bg-stone-50"
          }`}
        >
          <MessageSquarePlus
            className={`${compact ? "size-4" : "size-[1.125rem]"} shrink-0 text-amber-700`}
            aria-hidden
          />
          <span>留言打氣</span>
        </button>
      </div>

      {letterExpanded ? (
        <div
          id="staff-dedicated-letter-panel"
          className={`mt-2 space-y-2 rounded-lg border border-dashed border-amber-200/90 bg-amber-50/40 p-2.5 ${
            compact ? "text-[0.68rem]" : "text-[0.8rem]"
          }`}
          role="group"
          aria-label="獨立的留言打氣"
        >
          <p className="font-semibold leading-snug text-amber-950">
            留言／打氣（存紀錄，不是問小晴）
          </p>
          <p className="leading-relaxed text-stone-700">
            衛教問題請改用下方對話輸入框跟小晴談。
          </p>
          <label className="block">
            <span className="sr-only">給醫護團隊的留言或打氣</span>
            <textarea
              id="staff-dedicated-letter-input"
              className={`min-h-0 w-full resize-y rounded-lg border border-stone-200/90 bg-white px-2 py-2 text-stone-800 shadow-inner placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/30 ${
                compact ? "min-h-[4rem]" : "min-h-[4.75rem]"
              }`}
              maxLength={1500}
              rows={compact ? 3 : 4}
              placeholder="打氣、感謝、想說的一句話⋯"
              value={letterText}
              onChange={(e) => setLetterText(e.target.value)}
              disabled={!canPersist || letterBusy}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                !canPersist || letterBusy || !letterText.trim().length
              }
              onClick={() => void submitLetter()}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {letterBusy ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin"
                  aria-hidden
                />
              ) : null}
              {letterBusy ? "送出中⋯" : "送出"}
            </button>
            {letterOkHint ? (
              <span className="text-xs font-medium text-teal-800">
                已寫進「與醫護互動」紀錄，謝謝你～
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const CareChat = CareChatInner;
CareChat.displayName = "CareChat";
