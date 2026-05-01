import type { UserRole } from "@/lib/carepal/user-role";

const STORAGE_PREFIX = "carepal_proactive_tip_ix:";

/** 短衛教提醒（不取代 RAG／醫囑；緊急或個別狀況仍應問醫護） */
const CARE_TIPS_FAMILY: string[] = [
  "固定起床、用餐與小睡時間，再加上白天溫和的活動與曬點太陽，常能讓長輩比較穩定、傍晚也比較不焦躁。",
  "跟長輩說話時**句子短、語氣慢**，一回只問一件事，往往比一直講道理或糾正記憶更能減少衝突。",
  "家裡走道淨空、地毯貼牢、廁所與夜裡留一盞小燈，是減少絆倒很實際的做法。",
  "若長輩一直堅持要外出或找已不在的人，先**同理心情**再試著轉移注意力（喝杯飲料、看照片），有時比直接說「不對」有效。",
  "用藥務必照醫師藥袋或藥盒，不要自己加減量；有任何副作用或疑惑，先諮詢醫護。",
  "黃昏或入夜特別煩躁時，可試著調暗環境噪音、放熟悉的音樂，避免在那一刻安排太複雜的事。",
  "照顧者也要留一點喘息—短暫托手、請家人輪班或打心理支持專線，都是保護自己的方式。",
  "若長輩拒吃或嗆咳變多，可請職能治療或語言治療評估吞嚥；質地與姿勢調整常有幫助。",
  "重要資料（診斷摘要、用藥、過敏）整理成一頁，急診或換醫院時很有用。",
  "日曆或大時鐘放在明顯處，有助減少「現在幾點、今天星期幾」的反覆詢問帶來的壓力。",
  "游走或想開門外出時，門鈴感應或柔性阻擋比大聲責怪安全；仍要依你家狀況與醫護建議調整。",
  "便秘、感染、疼痛有時會讓行為突然變差，身體不舒服先排查，有時比單純當成「又發脾氣」更實際。",
  "重大決定（約束、鼻胃管等）盡量**全家一起聽醫師說明**、記下問題下次追問，避免事後後悔。",
  "睡前兩小時減少刺激畫面與咖啡因，溫和的例行步驟（刷牙、聽同一首歌）有助入睡儀式。",
  "你已經很辛苦；若出現睡不著、一直自責或快撐不住，請務必向外求助，不是軟弱。",
];

const CARE_TIPS_PATIENT: string[] = [
  "白天有機會活動一下、曬一點溫和的太陽，常對心情和睡眠有幫助（仍要依你的身體狀況與醫囑）。",
  "若最近記名字或找東西比較吃力，把常用的東西固定放同一個抽屜，能減少找尋的挫折感。",
  "吃藥時間若常忘，可請家人或藥局幫忙用分裝盒；**不要**自己改劑量，有疑問問醫師或藥師。",
  "傍晚若特別煩或睡不穩，傍晚後試著環境安靜一點、少看刺激性的畫面，有時會比較好睡。",
  "跟醫護說話時，把你最困擾的一、兩件事先記在手機備忘錄，看診時比較不會漏講。",
  "走路若偶爾不稳，鞋子合腳、室內光線夠、地上少雜物，都是保護自己的小事。",
  "心情低落或一直自責時，**跟你信任的醫護或心理資源說**，不必一個人扛。",
  "若吞嚥或吃東西常嗆到，務必告訴醫護評估；質地調整可能比吃流質更適合長期營養。",
  "夜裡若要上廁所，床邊小燈或感應燈能減少絆倒；有需要可請家人或物理治療建議輔具。",
  "你對自己的身體與感受最清楚；有變化就問，沒有誰會嫌你問太多。",
  "固定作息、餐前少久坐、規律如廁，對腹脹或便秘常有幫助，嚴重時仍要問醫師。",
  "今天願意來醫院、願意打字或說出來，已經是很勇敢的一步了。",
];

function hashVarietyKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickFromPool(pool: string[], role: "family" | "patient"): string {
  if (pool.length === 0) return "";
  if (typeof window === "undefined") {
    return pool[Math.floor(Math.random() * pool.length)] ?? "";
  }
  const key = STORAGE_PREFIX + role;
  const stored = sessionStorage.getItem(key);
  if (stored != null) {
    const i = Number.parseInt(stored, 10);
    if (!Number.isNaN(i) && i >= 0 && i < pool.length) {
      return pool[i]!;
    }
  }
  const ix = Math.floor(Math.random() * pool.length);
  sessionStorage.setItem(key, String(ix));
  return pool[ix]!;
}

/** 依 varietyKey 穩定選一則（供伺服器中段小錦囊 RAG 失敗時） */
export function pickProactiveCareTipForVariety(
  role: UserRole,
  varietyKey: string
): string {
  if (role !== "family" && role !== "patient") return "";
  const pool =
    role === "family" ? CARE_TIPS_FAMILY : CARE_TIPS_PATIENT;
  if (pool.length === 0) return "";
  const ix = hashVarietyKey(`${role}:${varietyKey}`) % pool.length;
  return pool[ix]!;
}

/** 家屬／病友開場用的一段小錦囊（同一分頁工作階段固定同一則，避免重掛載亂跳） */
export function pickProactiveCareTip(role: UserRole): string {
  if (role === "family") return pickFromPool(CARE_TIPS_FAMILY, "family");
  if (role === "patient") return pickFromPool(CARE_TIPS_PATIENT, "patient");
  return "";
}

export function proactiveCareTipLeadForRole(role: UserRole): string {
  const tip = pickProactiveCareTip(role);
  if (!tip) return "";
  return formatProactiveTipLead(role, tip);
}

/** 將 RAG 或自訂摘錄包成與開場「小錦囊」相同口吻；多行正文保留換行（條列可正常顯示）。 */
export function formatProactiveTipLead(role: UserRole, excerpt: string): string {
  const normalized = excerpt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  if (!normalized) return "";
  const lead =
    role === "family"
      ? "今天先分享一個照顧小錦囊："
      : role === "patient"
        ? "今天先分享一個小錦囊："
        : "";
  if (!lead) return normalized;
  if (normalized.includes("\n")) return `${lead}\n\n${normalized}`;
  return `${lead}${normalized}`;
}
