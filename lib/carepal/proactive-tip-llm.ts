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

/** 解法句是否像「可做的一步」而非純口號（長度或含具體行為線索）。 */
function solutionLineLooksActionable(body: string): boolean {
  const t = body.trim();
  if (t.length >= 30) return true;
  return /可試|可先|建議|試著|準備(?:好)?|安排|調整|固定|減少|避免|保留|改用|記錄|留意|前往|就醫|門診|掛號|諮詢|評估|打給|開燈|留一盞|走道|扶手|門鈴|感應|分裝|藥袋|姿勢|質地|水分|如廁|伸展|散步|活動|音樂|曬太陽|小睡|作息|睡眠|起床|用餐|洗澡|環境|光線|噪音|刺激|轉移|同理|短句|一次只問/.test(
    t
  );
}

function solutionsAreTooVague(numberedLines: string[]): boolean {
  const bodies = numberedLines.map((l) =>
    l.replace(/^\d{1,2}\.\s*/, "").replace(/[．]/g, ".").trim()
  );
  const need = Math.min(2, bodies.length);
  const actionable = bodies.filter((b) => solutionLineLooksActionable(b)).length;
  return actionable < need;
}

const TOPIC_LINE_RE =
  /^(?:題|主題)[:：]\s*(.+)$|^【題】\s*(.+)$/i;

/**
 * 收成「題：…」+ 2～3 條可執行解法；失敗時回 null。
 */
export function normalizeLlmCareTipOutput(raw: string): string | null {
  let s = stripCodeFences(raw);
  s = s.replace(/^今天先分享[^\n]*/u, "").trim();
  s = s.replace(/^\*+\s*/gm, "").replace(/\*+/g, "");
  if (s.length < 28 || looksLikeSourceDump(s)) return null;

  const lines = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const first = lines[0] ?? "";
  const tm = first.match(TOPIC_LINE_RE);
  if (!tm) return null;
  const topicBody = (tm[1] ?? tm[2] ?? "").trim();
  if (topicBody.length < 8 || topicBody.length > 76) return null;
  const topicLine = `題：${topicBody}`;

  const numberedRaw = lines
    .slice(1)
    .filter((l) => /^\d{1,2}\.\s/.test(l));
  if (numberedRaw.length < 2) return null;
  const numbered = numberedRaw.slice(0, 3);

  const normalized = numbered.map((l, i) => {
    const content = l
      .replace(/^\d{1,2}\.\s*/, "")
      .replace(/[．]/g, ".")
      .trim();
    return `${i + 1}. ${content}`;
  });

  if (solutionsAreTooVague(normalized)) return null;

  const joined = `${topicLine}\n\n${normalized.join("\n")}`;
  if (
    /(?:爸爸|媽媽|老爸|老媽|阿公|阿嬤|爺爺|奶奶|兒子|女兒|孫子|孫女)/.test(
      joined
    )
  ) {
    return null;
  }
  return joined;
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
      temperature: 0.28,
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content: [
            "你是衛教文案編輯，要把參考內容改成「一則照顧小錦囊」：**一個清楚題目（情境／痛點）**加上**可照著做**的解法，給聊天機器人開場用。",
            "輸出格式（必須嚴格遵守，共 4 行）：",
            '- 第 1 行且僅一行：「題：」開頭，後接**一句話的具體主題**（像小標題：讀完就知道在談哪種狀況或想解決什麼；不要空泛如「照顧很不容易」「要有耐心」）。',
            "- 第 2～4 行：剛好 **3 行**，每行以半形「1. 」「2. 」「3. 」開頭（數字、英文句點、半形空格、正文）。",
            "解法行必須遵守：",
            "- 每一點都要寫出**可執行的一步或具體作法**（例如環境怎麼調、作息怎麼排、說話怎麼縮短、何時該記錄或洽醫護），讀的人明天就做得到其中一件。",
            "- **禁止**整行只有態度口號：如「耐心是關鍵」「持續陪伴很重要」「多給支持」而沒有「做什麼」。",
            "- 每點一句、簡短有力，不要長篇教條。",
            "其他禁止：書名、檔名、PDF、頁碼、（摘自…）、問答格式、撰文人名、出處、「本題」「解答」等字樣。",
            "**禁止**具體家庭稱謂：爸爸、媽媽、兒女、阿公、阿嬤、爺爺、奶奶等；改用照顧者、長輩、家人、對方。",
            roleGuide,
            "事實邊界：只依參考內容整理，不新增診斷、不誇大療效、不取代醫囑；不憑空發明參考未提及的處置或藥物。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `以下為參考衛教片段（可能含案例口吻或雜訊）。請先歸納**這一則想處理的具體情境**寫成「題：」一行，再寫 3 條**具體作法**：\n\n${compact}`,
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
