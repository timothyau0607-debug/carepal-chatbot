/**
 * 判斷本輪使用者是否在問「失智／照護」實質問題（有別於純寒暄、單純情緒宣洩）。
 * 僅作啟發式；與 model 自判並用。
 */
export function isSubstantiveDementiaCareQuestion(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 4) return false;

  const topic =
    /失智|痴呆|阿茲海默|記憶力|記憶差|健忘|認知|長照|照護技巧|照護|家屬|照顧者|衛教|症狀|用藥|服藥|吃藥|藥物|劑量|藥盒|處方|黃昏|日落|症候群|遊走|妄想|幻覺|暴躁|煩躁|不安|行為問題|BPSD|嗆咳|吞嚥|便秘|腹瀉|失眠|睡不著|跌倒|走失|預防走失|輔具|約束|洗澡|拒食|餵食|喂食|復健|營養|喘息|安寧|病程|分期|早期|中期|晚期|診斷|MCI|輕度認知|認知障礙/;

  const kinCare =
    /阿公|阿嬤|爺爺|奶奶|外公|外婆|爸爸|媽媽|爸媽|患者|病友|病人|我媽|我爸|家裡長輩/;

  const asksDetail =
    /怎麼(辦|做|處理)|如何|什麼(是|叫|原因)|為什麼|為何|要不要|能不能|可以嗎|建議|注意|步驟|方式|差在哪|分別|哪裡|哪種|哪些|該不該|需不需要|[？?]/;

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
