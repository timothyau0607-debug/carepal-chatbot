import type { UserRole } from "@/lib/carepal/user-role";

const STAFF_MARKER = "與醫護互動感受（由對話歸納或手填）：";

/**
 * 佔位／尚未說寫入者：仍應**持續**併入「關心醫護互動滿意度」的 nudge，不可當成已問過。
 * 寫入：profile-infer 寫庫前亦會**改成空字串**避免長期佔用。
 */
export function isPlaceholderStaffSatisfaction(s: string): boolean {
  const t = s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (t.length === 0) return true;
  if (t.length < 2) return true;
  if (/^[\-—_…。．…\.。]{1,4}$/u.test(t)) return true;
  if (
    /^(（尚無[。．]?）|（尚?未。?）|尚無[。．]?|^\(尚無\))$/u.test(t) ||
    t === "尚無" ||
    t === "無"
  ) {
    return true;
  }
  if (
    t.length < 100 &&
    !/(滿意|不滿|體感|觀感|不錯|還(行|不錯|可以|好|算好)|還(挺)?好|差|爛|謝|感謝|讚|親(切)?|耐心|兇|冷|櫃台|掛(號)?|診(間|所)?|護(理|士)?|醫(師|生)|人員|院(方|內)?|照護)/.test(
      t
    ) &&
    (/(^|。)\s*尚[無未]|暫未|還(沒|沒有|未)|^無$|沒(有|什麼)特(別|別的)?(提|說|說明|表達|提及)|^本輪|^(此|本)次/.test(
        t
      ) ||
      /(尚未|沒(有|什麼)?).{0,16}(提|說|表(達|示)|言及|談(到|及)?).{0,30}(醫[護生師]|櫃台|院方|批價|掛號|看診|護理|診(間|所|室))/.test(
        t
      ) ||
      /(沒(有)?|不).{0,4}(針對|關(於|於))?.{0,6}(醫[護生師]|櫃台|院(方|內))/.test(t))
  ) {
    return true;
  }
  if (
    t.length < 200 &&
    /(尚未|沒(有|什麼)?|暫未|尚無(明(確|瞭)?)?).{0,40}(內容|說(明|要)|(表(達|示))|提及|針對).{0,40}(醫[護生師療櫃]|櫃台|院(方|內|務)|看診|就醫)/.test(
      t
    ) &&
    !/(好|不錯|差|可|不好|行|不滿|滿意|爛|值得|讚|謝|感謝)/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * 自記憶字串中取出「與醫護互動感受」欄位內文；若無此段則回 `null`。
 */
export function extractStaffSatisfactionFromMemory(
  memoryForPrompt: string
): string | null {
  const i = memoryForPrompt.indexOf(STAFF_MARKER);
  if (i < 0) return null;
  const rest = memoryForPrompt.slice(i + STAFF_MARKER.length);
  const nextH = rest.search(/\n{2,}【/);
  const end = nextH >= 0 ? nextH : rest.length;
  return rest.slice(0, end).replace(/\n+$/, "").trim() || null;
}

function shouldOmitNudge(
  useCloudMemory: boolean,
  memoryForPrompt: string,
  fromClient: string
): boolean {
  if (useCloudMemory) {
    const v = extractStaffSatisfactionFromMemory(memoryForPrompt);
    if (v == null) return false;
    return !isPlaceholderStaffSatisfaction(v);
  }
  const c = fromClient.trim();
  if (c.length === 0) return false;
  return !isPlaceholderStaffSatisfaction(c);
}

/** 畫像／本機**已有**實質醫護互動敘述時為 true，系統不應再硬套關心句。 */
export function hasRecordedStaffSatisfactionInPrompt(
  useCloudMemory: boolean,
  memoryForPrompt: string,
  clientProfile?: { staff_interaction_satisfaction?: string } | null
): boolean {
  const fromClient = clientProfile?.staff_interaction_satisfaction?.trim() ?? "";
  return shouldOmitNudge(useCloudMemory, memoryForPrompt, fromClient);
}

/** 到院、與院內人員/櫃台相關的關心或敘述（**不含**單純「醫療團隊」通才衛教句）。 */
export function replyMentionsVisitOrStaffCare(s: string): boolean {
  const t = s.replace(/[\r\n\t]+/g, " ");
  if (
    /(到院|來院|就醫|掛號|回診|到診(所|間)|在院(內|裡|返)?|醫護(人員|同仁)?|櫃台(人(員)?|服務)?|院方|批價(處|櫃)?|護(理(師|站)?|士|佐)|醫(師|生)|櫃檯|看診(?!斷))/.test(
      t
    )
  ) {
    return true;
  }
  if (/(今天|剛(才)?|剛|這(一)?次|一路|有沒有).{0,12}(到院|掛(號|門診|診|回診)|看診|就醫)/.test(t)) {
    return true;
  }
  if (/(和|跟).{0,4}(醫護|櫃台|院(方|裡)|掛(號|櫃))/.test(t)) {
    return true;
  }
  return false;
}

/**
 * 上則小晴**已**在問到院/醫護，且**本則**使用者是短句承接 → 不**再**硬加開頭，避免同句反覆問。
 */
export function shouldSkipHardStaffCareLead(
  lastUserText: string,
  lastAssistantText: string | undefined
): boolean {
  const u = lastUserText.trim();
  if (u.length > 24) return false;
  if (!lastAssistantText) return false;
  const a = lastAssistantText;
  if (!/到院|看診|就醫|掛(號)?|醫護|櫃台|院(方|內|裡).{0,4}(人|人員|服務|醫|那)|和(醫護|櫃台|院)|還(算)?順心|好嗎[？?]|還行嗎/.test(a)) {
    return false;
  }
  if (!/^(好[的呀哈]?[啊呀]?|行[啊呀哈]?|ok|明白[了]?[啊呀哈]?|了解[了]?[啊呀哈]?|知道[了]?[啊呀哈]?|恩|嗯|謝(謝|你)?|收到|清楚[了]?|ok)[\s。!！…]*$/i.test(
    u
  )) {
    return false;
  }
  return true;
}

/** 併在**主答之末**；含轉接語，避免在長段內容後**硬切**兩句問。 */
export const STAFF_CARE_LEAD =
  `另外，也想順道多關心一下：今天到院、看診還算順利嗎？和醫護、櫃台那邊都還行嗎？`;

/**
 * 累積到**約**此數則**使用者**訊息後，併入「到院＋醫護互動」關心（必要時在**主答之末**硬補一句）。
 * 第 1～2 則：只宜到院/流程，**勿**追問醫護道謝；**第 3 則左右**起再帶醫護互動滿意度。
 */
export const STAFF_PRAISE_NUDGE_MIN_USER_MESSAGES = 3;

/**
 * 家屬／病友且畫像裡**尚無**醫護互動感受時，併入 system，要求模型
 * 依對話深淺分階段：前幾則**不**主動追問醫護道謝；夠多輪後再併到院＋醫護互動。
 */
export function buildStaffSatisfactionNudge(
  userRole: UserRole,
  useCloudMemory: boolean,
  memoryForPrompt: string,
  userMessageCount: number,
  clientProfile?: { staff_interaction_satisfaction?: string } | null
): string {
  if (userRole !== "family" && userRole !== "patient") return "";

  const fromClient = clientProfile?.staff_interaction_satisfaction?.trim() ?? "";
  if (shouldOmitNudge(useCloudMemory, memoryForPrompt, fromClient)) {
    return "";
  }

  if (userMessageCount < STAFF_PRAISE_NUDGE_MIN_USER_MESSAGES) {
    return `【本則回覆（家屬/病友；對話尚**淺**，目前為**第 ${userMessageCount} 則**使用者訊息；尚**未**到「約**第三**則**來回」）】
畫像裡**尚無**與醫護互動之整理。**在**第**三**則**使用者**訊息**之前**（本輪**尚未**達成）：**本則禁止**主動追問**與醫護/櫃台互動、道謝、讚美團隊**等，以免**太刻意**。**可**在尚未問過、且主答**收束**後，以**有轉接**的短句關心（如「**另外，也想問一下**…」起頭）**今天到院/看診**、流程**還**順不順**；**先**回應本則內容與情緒。若**本則**使用者**主動**提醫護/感謝，**真誠承接**即可。

**例外**：
• 你**上一則**幾乎**只**在**釋字確認**稱呼 → **本則**不要同時夾**到院**與**醫護**；**可**於**下一則**再**只**帶**一句**到院/流程。
• 使用者**本則**在問**急症、用藥、處方**等 → 先**答**該問。`;
  }

  return `【本則回覆**必含**（家屬/病友專用；**已**到**約**第**三**則**使用者**訊息**左右**；仍**口語**）】
目前「已記得資訊」裡**還沒有**你與**醫護、院內櫃台**互動或溝通是否大致順心。請依下列**順序**（**極重要**）：
1. **先**用主要篇幅、**有條理地回覆**本則使用者的**具體提問**（照護、衛教、參考資料、條列均可），**讓對方先得到答案**；**不要**在**開場**、**兩段之間**或**一邊講一邊**突然插「今天到院…」「X先生今天行程…」—會打斷閱讀、很**不自然**。
2. **主答寫完**之後，在**全則最末**再帶**到院／醫護**關心前，**必須**先用**一個**短轉接（如「**另外，也想順道多關心一下**」「**也想問問你**」等），**不要**在衛教或承接句後**直接**接「今天到院…醫護…」而**沒有**轉折，讀者會覺得**斷裂**、不自然。轉接後用 **1～2 短句**：（1）**今天到院／看診**大致如何；（2）**和醫護、櫃台**那邊相處、溝通**還**順心**嗎**—兩點**可併**一句。若主答已盡力仍擠不下，**至少**在**最末**帶一點，**不要**在文中重複兩、三次**稱呼＋**到院。

**若**你從**本則**使用者**訊息**讀到**已**回覆上列，**不要**用同樣問句**重複**盤問。**若**最近一兩輪裡，使用者**已**答過到院/醫護**大致**狀況，也**不要**再套**同**兩句。

**例外**（依序判斷）：
• 你**上一則**幾乎**只**在**釋字確認**稱呼 → **下則**再帶上列兩點。
• 使用者**本則**在問**急症、用藥、劑量、處方**等 → 先**安全**、**針對**答完，**最末**可**一句**帶到院/醫護，**前**也宜有短轉接。`;
}
