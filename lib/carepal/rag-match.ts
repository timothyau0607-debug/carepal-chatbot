import { RAG_CHUNKS, type RagChunk } from "./rag-seeds";

function score(text: string, chunk: RagChunk): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const k of chunk.keywords) {
    if (t.includes(k.toLowerCase())) s += 2;
  }
  for (const word of ["失智", "症狀", "照顧", "家屬", "爺", "公", "母", "女"]) {
    if (t.includes(word) && chunk.text.includes(word)) s += 0.5;
  }
  return s;
}

export function matchRagChunks(
  userMessage: string,
  topK: number
): { chunk: RagChunk; score: number }[] {
  const scored = RAG_CHUNKS.map((chunk) => ({
    chunk,
    score: score(userMessage, chunk),
  })).sort((a, b) => b.score - a.score);

  const positive = scored.filter((x) => x.score > 0).slice(0, topK);
  if (positive.length > 0) return positive;

  // 無關鍵字命中時仍回傳前 K 段，讓模型至少有內部衛教可對照（相關性由 system 指示約束）
  return scored.slice(0, topK);
}

type RagLike = { source: string; text: string };

export function formatRagForPrompt(
  rows: { chunk: RagLike; score: number }[]
): string {
  if (rows.length === 0) return "（本輪沒有匹配到內部衛教片段。）";
  return rows
    .map(
      (r, i) =>
        `[${i + 1}] 出處：${r.chunk.source}\n內容：${r.chunk.text}`
    )
    .join("\n\n");
}

/** formatRagForPrompt 在無資料時會含此語；供路由判斷是否強制引用 RAG。 */
export function isRagPromptProbablyEmpty(formattedRag: string): boolean {
  return formattedRag.includes("沒有匹配到內部衛教片段");
}
