import type OpenAI from "openai";

function looksLikeSourceDump(s: string): boolean {
  return /摘自|\.pdf\b|撰文\s*[／\/╱]|第\s*\d{1,4}\s*頁|\d{1,3}\s*伍\b/.test(s);
}

function stripCodeFences(s: string): string {
  let t = s.replace(/\r\n/g, "\n").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }
  return t;
}

/**
 * 將模型輸出收成純條列；失敗時回 null 以便走備援 shaping。
 */
export function normalizeLlmCareTipOutput(raw: string): string | null {
  let s = stripCodeFences(raw);
  s = s.replace(/^今天先分享[^\n]*/u, "").trim();
  s = s.replace(/^\*+\s*/gm, "").replace(/\*+/g, "");
  if (s.length < 24 || looksLikeSourceDump(s)) return null;

  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const numbered = lines.filter((l) => /^\d{1,2}\.\s/.test(l));
  if (numbered.length >= 2) {
    const joined = numbered
      .slice(0, 4)
      .map((l) => l.replace(/[．]/, ".").replace(/^(\d{1,2})\.\s*/, "$1. "))
      .join("\n");
    if (
      /(?:爸爸|媽媽|老爸|老媽|阿公|阿嬤|爺爺|奶奶|兒子|女兒|孫子|孫女)/.test(
        joined
      )
    ) {
      return null;
    }
    return joined;
  }
  if (numbered.length === 1 && numbered[0]!.length >= 28) {
    const one = numbered[0]!.replace(/[．]/, ".").replace(/^(\d{1,2})\.\s*/, "$1. ");
    if (
      /(?:爸爸|媽媽|老爸|老媽|阿公|阿嬤|爺爺|奶奶|兒子|女兒|孫子|孫女)/.test(
        one
      )
    ) {
      return null;
    }
    return one;
  }
  return null;
}

/**
 * 依衛教參考文字改寫為中性、條列式「小錦囊」正文（不含開場前綴）。
 */
export async function rewriteProactiveCareTipWithLlm(
  client: OpenAI,
  model: string,
  role: "family" | "patient",
  referenceAnswerBody: string
): Promise<string | null> {
  const trimmed = referenceAnswerBody.replace(/\r\n/g, "\n").trim();
  const compact = trimmed.replace(/\s+/g, " ").slice(0, 2400);
  if (compact.length < 18) return null;

  const roleGuide =
    role === "family"
      ? "受眾是**照顧者／家屬**：用「照顧者、您照顧的家人、長輩、對方」等說法；不要假定一定是父母或子女。"
      : "受眾是**病友本人**：以「您」為主，必要時可輕帶「家人／照顧您的人」，不要臆測具體家庭角色。";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: [
            "你是衛教文案編輯，要把參考內容改寫成給聊天機器人用的「照顧小錦囊」條列。",
            "輸出規則（必須遵守）：",
            "- 只輸出 2～4 行，每行以半形「1. 」「2. 」這種格式開頭（數字、英文句點、半形空格、再接正文）。",
            "- 每點**一句**，簡短、清晰、好記，避免堆疊從句與長篇解釋。",
            "- 禁止：書名、檔名、PDF、頁碼、（摘自…）、問答格式、撰文人名、出處、引用符號。",
            "- **禁止**具體家庭稱謂：爸爸、媽媽、爸、媽、兒女、孫、阿公、阿嬤、爺爺、奶奶等；改成照顧者、長輩、家人、對方。",
            roleGuide,
            "- 只依參考內容整理衛教要點，不新增診斷、不誇大療效、不取代醫囑；不補充參考未提及的醫療處置。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `以下為參考衛教片段（可能含案例角色或雜訊，請改寫成中立條列）：\n\n${compact}`,
        },
      ],
    });
    const out = completion.choices[0]?.message?.content?.trim() ?? "";
    return normalizeLlmCareTipOutput(out);
  } catch (e) {
    console.error("[carepal] rewriteProactiveCareTipWithLlm", e);
    return null;
  }
}
