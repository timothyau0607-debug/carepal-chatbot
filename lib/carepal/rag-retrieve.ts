import fs from "fs";
import path from "path";
import { createEmbeddingClient, embedText } from "./embeddings";
import { matchRagChunks } from "./rag-match";
import { vectorTopK, keywordTopK } from "./vector-search";
import type { CarepalRagIndexFile } from "./rag-index-types";

const FILE = "carepal-rag.index.json";

function getPath() {
  return path.join(process.cwd(), "data", FILE);
}

let cache: CarepalRagIndexFile | null | undefined;

export function clearRagIndexCache(): void {
  cache = undefined;
}

function loadIndex(): CarepalRagIndexFile | null {
  if (cache !== undefined) return cache;
  const p = getPath();
  if (!fs.existsSync(p)) {
    cache = null;
    return null;
  }
  const raw = fs.readFileSync(p, "utf-8");
  cache = JSON.parse(raw) as CarepalRagIndexFile;
  return cache;
}

/**
 * 優先讀 `data/carepal-rag.index.json` 做向量／關鍵字搜尋；
 * 未匯入時退回 `rag-seeds` 關鍵字集。
 */
export async function retrieveRag(
  userMessage: string,
  topK: number
): Promise<{ chunk: { id?: string; source: string; text: string }; score: number }[]> {
  const index = loadIndex();
  if (index?.chunks?.length) {
    const emb = createEmbeddingClient();
    if (emb) {
      try {
        const qv = await embedText(emb.client, emb.model, userMessage);
        return vectorTopK(index.chunks, qv, topK);
      } catch (e) {
        console.error(
          "[carepal] RAG 向量查詢失敗，改為關鍵字搜尋",
          e instanceof Error ? e.message : e
        );
        return keywordTopK(index.chunks, userMessage, topK);
      }
    }
    return keywordTopK(index.chunks, userMessage, topK);
  }
  return matchRagChunks(userMessage, topK);
}
