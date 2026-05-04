import { Fragment, type ReactNode } from "react";

/** 模型有時把整段條列擠成一行，於顯示前補上換行（不影響原始儲存）。 */
export function normalizeAssistantTextForDisplay(input: string): string {
  let s = input.replace(/\r\n/g, "\n").trim();
  // 句號、驚嘆等之後接「1. 」「2. 」
  s = s.replace(/([。！？；])\s*(\d{1,2}\.\s)/g, "$1\n\n$2");
  // 冒號後直接接編號（如「建議：1.」）
  s = s.replace(/([：:])\s*(\d{1,2}\.\s)/g, "$1\n\n$2");
  // 「**一條說明**」後接「2. 」「3.」等下一條（模型常寫成同一行）
  s = s.replace(/(\*\*[^*]*\*\*)\s+(\d{1,2}\.\s)/g, "$1\n\n$2");
  return s;
}

function renderInlineBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.length >= 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-stone-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * 聊天氣泡內文：保留換行、**粗體**。
 * 小晴一律 whitespace-pre-wrap，與打字動畫過程一致，避免完稿改用 &lt;p&gt; 後段落黏成一整塊。
 */
export function FormattedMessageBody({
  role,
  content,
  /** 逐字顯示中：content 已是 normalizeAssistantTextForDisplay(完整回覆) 的前綴，勿再跑 normalize，避免前綴被改寫而跳動 */
  assistantNormalizedPrefix = false,
}: {
  role: "user" | "assistant";
  content: string;
  assistantNormalizedPrefix?: boolean;
}): ReactNode {
  if (role === "user") {
    return (
      <span className="whitespace-pre-line break-words text-[15px] leading-relaxed text-stone-800">
        {content}
      </span>
    );
  }

  const text = assistantNormalizedPrefix
    ? content
    : normalizeAssistantTextForDisplay(content);
  return (
    <div className="min-w-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800 [overflow-wrap:anywhere]">
      {renderInlineBold(text)}
    </div>
  );
}

/** 供朗讀：去掉 ** 等標記，聽起來自然一點 */
export function plainTextForSpeechFromAssistant(raw: string): string {
  return raw
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "。");
}
