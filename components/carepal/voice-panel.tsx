"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { CareChat, type CareChatHandle } from "./care-chat";
import { useBrowserStt } from "@/hooks/use-browser-stt";
import type { UserRole } from "@/lib/carepal/user-role";
import type { LocalProfileSnapshot } from "@/lib/carepal/local-profile";

type Source = { source: string; snippet: string };

type Props = {
  onRagUpdate: (sources: Source[]) => void;
  onActivityLine: (line: string) => void;
  userKey: string | null;
  userRole: UserRole;
  /** 本機或已載入畫像，供對話併入脈絡（未接雲端時仍有效） */
  clientProfile: LocalProfileSnapshot | null;
  onReplyComplete?: () => void;
  /** false = 對外 Demo：對話優先、版面緊湊 */
  compact?: boolean;
};

const RESUME_MIC_AFTER_TTS_MS = 450;

export function VoicePanel({
  onRagUpdate,
  onActivityLine,
  userKey,
  userRole,
  clientProfile,
  onReplyComplete,
  compact = false,
}: Props) {
  const chatRef = useRef<CareChatHandle>(null);
  const [sttError, setSttError] = useState<string | null>(null);
  /** 朗讀前若麥克風為開，朗讀結束後自動 startSession */
  const resumeSttAfterTtsRef = useRef(false);
  const resumeSttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFinal = useCallback((transcript: string) => {
    setSttError(null);
    void chatRef.current?.submitUserText(transcript);
  }, []);

  const stt = useBrowserStt({
    onFinal,
    onError: (m) => setSttError(m),
  });

  const pauseMicForTts = useCallback(() => {
    if (stt.sessionOpen) resumeSttAfterTtsRef.current = true;
    stt.endSession();
  }, [stt.endSession, stt.sessionOpen]);

  const resumeMicAfterTts = useCallback(() => {
    if (!resumeSttAfterTtsRef.current) return;
    resumeSttAfterTtsRef.current = false;
    if (resumeSttTimerRef.current) {
      clearTimeout(resumeSttTimerRef.current);
    }
    resumeSttTimerRef.current = setTimeout(() => {
      resumeSttTimerRef.current = null;
      stt.startSession();
    }, RESUME_MIC_AFTER_TTS_MS);
  }, [stt.startSession]);

  useEffect(
    () => () => {
      if (resumeSttTimerRef.current) clearTimeout(resumeSttTimerRef.current);
    },
    []
  );

  const micBlock = (
    <>
      {!compact && (
        <p className="text-center text-sm text-stone-500">
          麥克風使用
          <strong>瀏覽器語音辨識</strong>（以 Chrome / Edge 為佳），需
          <strong> HTTPS 或本機</strong>。按一次開啟
          <strong>連續收音</strong>：每說完一句、停頓後會
          <strong>自動傳送</strong>，並
          <strong>繼續聽下一句</strong>，直到再按一次
          <strong>關閉收音</strong>。
        </p>
      )}

      <div
        className={`carepal-orb shrink-0 ${compact ? "scale-90" : ""}`}
        data-active={stt.sessionOpen}
        aria-hidden
      />

      {stt.interim && (
        <p
          className={
            compact
              ? "max-w-full truncate rounded-lg border border-dashed border-teal-300/80 bg-white/60 px-2 py-1 text-center text-xs text-stone-600"
              : "max-w-md rounded-lg border border-dashed border-teal-300/80 bg-white/60 px-3 py-1.5 text-center text-sm text-stone-600"
          }
        >
          辨識中：{stt.interim}
        </p>
      )}

      {sttError && (
        <p className="text-center text-xs text-rose-600" role="status">
          {sttError}
        </p>
      )}

      <div className={`flex flex-col items-center gap-2 ${compact ? "gap-1" : ""}`}>
        {!stt.clientReady ? (
          <>
            <div
              className={`inline-flex items-center justify-center rounded-full bg-stone-200 text-stone-500 ${compact ? "h-11 w-11" : "h-14 w-14"}`}
              aria-hidden
            >
              <MicOff className={compact ? "size-5" : "size-6"} />
            </div>
            <span className="text-center text-xs text-stone-400">
              載入語音模組中…
            </span>
          </>
        ) : stt.supported ? (
          <>
            <button
              type="button"
              onClick={() => {
                setSttError(null);
                stt.toggleSession();
              }}
              className={`inline-flex items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/30 transition hover:bg-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${compact ? "h-11 w-11" : "h-14 w-14"}`}
              aria-pressed={stt.sessionOpen}
            >
              {stt.sessionOpen ? (
                <Mic className={compact ? "size-5" : "size-6"} />
              ) : (
                <MicOff className={compact ? "size-5" : "size-6"} />
              )}
            </button>
            <span
              className={
                compact
                  ? "max-w-[280px] text-center text-[0.65rem] leading-snug text-stone-500"
                  : "max-w-xs text-center text-xs text-stone-500"
              }
            >
              {stt.sessionOpen
                ? stt.isListening
                  ? compact
                    ? "辨識中，停頓後送出"
                    : "本句辨識中，停頓後自動送出並繼續下一句；再點鈕關閉收音"
                  : compact
                    ? "聽下一句…"
                    : "接續下一句中…可再點鈕關閉收音"
                : compact
                  ? "連續收音：開／關"
                  : "按一下開啟連續收音；再按關閉"}
            </span>
          </>
        ) : (
          <p className="max-w-sm text-center text-xs text-amber-800">
            此瀏覽器不支援 Web Speech
            語音轉寫。請改以<strong>文字</strong>輸入，或使用 Chrome / Edge
            開啟本頁。
          </p>
        )}
      </div>
    </>
  );

  const chatEl = (
    <CareChat
      key={`${userKey ?? "k"}-${userRole}`}
      ref={chatRef}
      onRagUpdate={onRagUpdate}
      onActivityLine={onActivityLine}
      userKey={userKey}
      userRole={userRole}
      clientProfile={clientProfile}
      onReplyComplete={onReplyComplete}
      onBeforeTtsPlay={pauseMicForTts}
      onAfterTtsPlay={resumeMicAfterTts}
      compact={compact}
    />
  );

  if (compact) {
    return (
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">{chatEl}</div>
        <div className="shrink-0 border-t border-stone-200/80 bg-teal-50/50 px-3 pb-4 pt-2">
          <p className="mb-1.5 text-center text-[0.65rem] text-stone-500">
            語音（Chrome／Edge／HTTPS）
          </p>
          <div className="flex flex-col items-center">{micBlock}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center gap-3 overflow-hidden px-4 py-6">
      {micBlock}
      {chatEl}
    </div>
  );
}
