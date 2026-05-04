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
        <strong
          key={i}
          className="font-semibold text-stone-900"
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const LIST_RE = /^\d{1,2}\.\s*(.+)$/;

function isOrderedListBlock(block: string): boolean {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.every((l) => LIST_RE.test(l));
}

/**
 * 聊天氣泡內文：保留換行、條列、**粗體**（不當作 HTML 插入，僅此簡化語法）。
 */
export function FormattedMessageBody({
  role,
  content,
  /** 逐字顯示中：不重排區塊／清單、不用 text-wrap pretty，避免已出現的行反覆換行跳動 */
  streaming = false,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}): ReactNode {
  if (role === "assistant" && streaming) {
    return (
      <div className="min-w-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800 [overflow-wrap:anywhere]">
        {content}
      </div>
    );
  }

  const text =
    role === "assistant"
      ? normalizeAssistantTextForDisplay(content)
      : content;

  if (role === "user") {
    return (
      <span className="whitespace-pre-line break-words text-[15px] leading-relaxed text-stone-800">
        {text}
      </span>
    );
  }

  const blocks = text.split(/\n{2,}/);
  return (
    <div className="min-w-0 space-y-3 break-words text-[15px] leading-relaxed text-stone-800 [overflow-wrap:anywhere] [text-wrap:pretty]">
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        if (isOrderedListBlock(trimmed)) {
          const lines = trimmed
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          return (
            <ol
              key={bi}
              className="list-inside list-decimal space-y-2 pl-0 marker:font-medium marker:text-stone-600"
            >
              {lines.map((line, li) => {
                const m = line.match(LIST_RE);
                const item = m ? m[1] : line;
                return (
                  <li key={li} className="pl-0.5">
                    <span className="break-words">
                      {renderInlineBold(item)}
                    </span>
                  </li>
                );
              })}
            </ol>
          );
        }

        return (
          <p key={bi} className="mb-0 break-words last:mb-0">
            {trimmed.split("\n").map((line, li) => (
              <Fragment key={li}>
                {li > 0 ? <br /> : null}
                {renderInlineBold(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
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
