import OpenAI from "openai";

const OPENROUTER_BASE_DEFAULT = "https://openrouter.ai/api/v1";

/** 與聊天共用金鑰；embedding 可選獨立模型。 */
export function createEmbeddingClient():
  | { client: OpenAI; model: string }
  | null {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openrouterKey) {
    const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
    return {
      client: new OpenAI({
        apiKey: openrouterKey,
        baseURL:
          process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_DEFAULT,
        defaultHeaders: {
          ...(referer ? { "HTTP-Referer": referer } : {}),
          "X-Title":
            process.env.OPENROUTER_APP_TITLE?.trim() || "CarePal Chatbot",
        },
      }),
      model:
        process.env.EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-small",
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      client: new OpenAI({ apiKey: openaiKey }),
      model:
        process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    };
  }

  return null;
}

export async function embedTexts(
  client: OpenAI,
  model: string,
  inputs: string[]
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const res = await client.embeddings.create({ model, input: inputs });
  const data = res.data;
  if (!data || !Array.isArray(data)) {
    const detail =
      res && typeof res === "object" && "error" in res
        ? JSON.stringify((res as { error?: unknown }).error)
        : "";
    throw new Error(
      `Embedding API 回傳缺少 data 陣列（可能為模型不支援 embedding 或供應商回應格式不符）。${
        detail ? ` 詳情：${detail}` : ""
      } 請檢查 EMBEDDING_MODEL 與 OPENROUTER_BASE_URL 是否支援 /embeddings。`
    );
  }
  const byIndex = new Map(
    data.map((d) => [d.index, d.embedding] as const)
  );
  return inputs.map((_, i) => {
    const e = byIndex.get(i);
    if (!e) throw new Error("embedding 回傳筆數不符");
    return e;
  });
}

export async function embedText(
  client: OpenAI,
  model: string,
  text: string
): Promise<number[]> {
  const [v] = await embedTexts(client, model, [text]);
  return v;
}
