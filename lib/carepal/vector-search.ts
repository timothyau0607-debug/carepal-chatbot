import type { RagIndexChunk } from "./rag-index-types";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export function vectorTopK(
  chunks: RagIndexChunk[],
  queryVec: number[],
  k: number
): { chunk: RagIndexChunk; score: number }[] {
  const ranked = chunks
    .map((chunk) => ({
      chunk,
      score: cosine(queryVec, chunk.vector),
    }))
    .sort((x, y) => y.score - x.score);
  return ranked.slice(0, k);
}

/** 無 embedding 金鑰時的簡易關鍵字命中（不經模型）。 */
export function keywordTopK(
  chunks: RagIndexChunk[],
  query: string,
  k: number
): { chunk: RagIndexChunk; score: number }[] {
  const q = query.trim();
  if (!q) return [];
  const terms = [
    ...new Set(
      q
        .split(/[\s，。、？！；：\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 1)
    ),
  ];
  if (terms.length === 0) return [];

  const scored = chunks.map((c) => {
    let s = 0;
    for (const t of terms) {
      if (c.text.includes(t)) s += 2;
      if (c.source.includes(t)) s += 0.5;
    }
    if (q.length >= 2 && c.text.includes(q)) s += 3;
    return { chunk: c, score: s };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
