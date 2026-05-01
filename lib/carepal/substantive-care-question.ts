/**
 * 判斷本輪使用者是否在問「失智／照護」實質問題（有別於純寒暄、單純情緒宣洩）。
 * 僅作啟發式；與 model 自判並用。
 */
export function isSubstantiveDementiaCareQuestion(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 4) return false;

  const topic =
    /失智|痴呆|阿茲海默|記憶力|記憶差|健忘|認知|長照|照護技巧|照護|家屬|照顧者|衛教|症狀|用藥|服藥|吃藥|藥物|劑量|藥盒|處方|黃昏|日落|症候群|遊走|妄想|幻覺|暴躁|煩躁|不安|行為問題|BPSD|嗆咳|吞嚥|便秘|腹瀉|失眠|睡不著|跌倒|走失|預防走失|輔具|約束|洗澡|拒食|餵食|喂食|復健|營養|喘息|安寧|病程|分期|早期|中期|晚期|診斷|MCI|輕度認知|認知障礙|溝通|防跌|日常作息|照顧技巧/;

  const kinCare =
    /阿公|阿嬤|爺爺|奶奶|外公|外婆|爸爸|媽媽|爸媽|患者|病友|病人|我媽|我爸|家裡長輩/;

  const asksDetail =
    /怎麼(辦|做|處理)|如何|什麼(是|叫|原因)|為什麼|為何|要不要|能不能|可以嗎|建議|注意|要注意|該注意|步驟|方式|差在哪|分別|哪裡|哪種|哪些|該不該|需不需要|重點(是|有)|完整說|說清楚|講清楚|[？?]/;

  const nightBehavior =
    /晚上|半夜|夜裡|睡覺|睡不著|吵|鬧|尖叫|摔東西|要回家|想外出/;

  if (topic.test(t)) {
    if (t.length >= 6 || asksDetail.test(t) || /[？?]/.test(t)) return true;
    return false;
  }

  if (kinCare.test(t) && asksDetail.test(t) && t.length >= 8) return true;

  if (nightBehavior.test(t) && (asksDetail.test(t) || t.length >= 12))
    return true;

  return false;
}

/** 使用者明確希望單則內盡量說完、偏資訊深度（非純情緒）。 */
export function wantsInformationalDepth(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 4) return false;
  return /一次(說完|講完|說明)|說完整|講完整|盡量詳|詳細(一點|說|講)|重點(有哪些|是什麼|整理)|該注意什麼|要注意什麼|懶人包|整理給我|越完整越好|請說明|多講一點|別只講一點/.test(
    t
  );
}

/**
 * 有 RAG 命中時，較寬鬆的「像在問照護／衛教」判斷，用於拉高輸出上限以免有資料卻塞不下。
 */
export function isLikelyCareTeachingQuestion(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 6) return false;

  const topic =
    /失智|痴呆|阿茲海默|記憶|認知|長照|照護|照顧|衛教|症狀|用藥|服藥|吃藥|藥物|黃昏|日落|遊走|妄想|幻覺|煩躁|BPSD|嗆咳|吞嚥|便秘|失眠|跌倒|走失|輔具|洗澡|餵食|復健|營養|MCI|認知障礙/;

  const asksOrSubstantive =
    /怎麼|如何|什麼|為什麼|要不要|能不能|建議|注意|要注意|該注意|重點|步驟|哪些|哪種|該不該|[？?]|整理|說明/;

  if (!topic.test(t)) return false;
  return asksOrSubstantive.test(t) || t.length >= 14;
}
