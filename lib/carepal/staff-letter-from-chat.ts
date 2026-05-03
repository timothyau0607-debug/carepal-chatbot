/** 出現過打氣／按讚區後，可自動將「對醫護／團隊」的口述納入畫像的有效時間視窗（毫秒）。 */
export const STAFF_LETTER_RECALL_WINDOW_MS = 25 * 60 * 1000;

/**
 * 判斷使用者輸入是否像對院內人員／團隊致謝或託捎話，而非單謝小晴衛教；
 * 用於自動寫進「醫護互動」欄時取捨。
 */
export function looksLikeDirectedStaffLetter(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length > 800) return false;

  // 純向小晴道謝、未指涉院方人員者不寫入醫護欄（避免衛教對答被誤收）
  if (
    !/(護理師|護士|醫師|醫生|護理站|護理|掛號|批價|櫃台|檢驗|院方|診間|門診|醫護|團隊|同仁|護佐|衛教師)/.test(
      t
    )
  ) {
    const onlyXiaoqing =
      /謝謝小晴|^謝謝你[,，]?\s*小晴|感謝小晴|謝謝妳[,，]?\s*小晴|謝謝您[,，]?\s*小晴/.test(t);
    if (onlyXiaoqing) return false;
  }

  // 多半是照護發問而未提院方場合，自動不收（使用者可改用「下一則一併紀錄」）
  const looksFaqlike =
    /[？?].{0,80}$|[？?](\s|$)/.test(t) &&
    !/(謝謝|感謝|道謝|辛苦)/.test(t) &&
    /怎(麼|樣)|如何|請問要不要|可不可以|可以吃嗎|要注意什麼|有什麼建議/.test(t);
  if (
    looksFaqlike &&
    !/(醫護|護理師|護士|醫師|院方|櫃台|團隊|同仁)/.test(t)
  ) {
    return false;
  }

  if (
    /(感謝|謝謝|道謝|謝謝您|謝謝妳|辛苦了|很不容易|替我謝|幫我向|請轉達|麻煩轉達|想跟.+說聲謝謝)/.test(
      t
    ) &&
    /(護理師|護士|醫師|醫生|醫護|院方|櫃台|門診|診間|團隊|同仁|護理站|護理佐|護佐|護理師們)/.test(
      t
    )
  ) {
    return true;
  }

  if (/幫我(跟|向).+(醫護|護理|醫師|護士)/.test(t)) return true;
  if (/想(跟|對).+(醫護|護理站|護理師)/.test(t) && /(謝謝|感謝|打氣|按讚|肯定)/.test(t)) {
    return true;
  }

  return false;
}
