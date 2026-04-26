import OpenAI from "openai";

const OPENROUTER_BASE_DEFAULT = "https://openrouter.ai/api/v1";

/** 優先使用 OpenRouter；否則使用 OpenAI 官方。皆未設定則回傳 null（走 Demo）。 */
export function createChatLlm(): { client: OpenAI; model: string } | null {
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
        process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      client: new OpenAI({ apiKey: openaiKey }),
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    };
  }

  return null;
}
