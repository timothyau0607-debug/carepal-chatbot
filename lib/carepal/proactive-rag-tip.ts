import { retrieveRag } from "@/lib/carepal/rag-retrieve";
import { todayDateTaipei } from "@/lib/carepal/staff-feed";

/** 每日輪換用：家屬／照顧者取向的 RAG 查詢種子（取 top 片段再摘錄） */
const PROACTIVE_TIP_SEED_QUERIES_FAMILY: string[] = [
  "失智症家屬 照顧者 日常作息 安全 環境",
  "黃昏症候群 傍晚 煩躁 照顧技巧",
  "失智症 溝通 家屬 怎麼說話比較不會衝突",
  "遊走 想出門 失智 照顧 安全",
  "用藥 服藥 家屬 照顧 注意",
  "嗆咳 吞嚥 進食 照顧",
  "跌倒 預防 居家 失智",
  "照顧者 壓力 喘息 求助",
  "便秘 失眠 身體不適 行為",
  "失智症 早期 症狀 家屬可留意",
  "行為情緒 失智 照顧者 怎麼回應",
  "走失 預防 身分手環 戶政",
  "營養 進食 拒食 長輩",
  "口腔 清潔 刷牙 照顧",
];

/** 病友本人取向的查詢種子 */
const PROACTIVE_TIP_SEED_QUERIES_PATIENT: string[] = [
  "記憶力 下降 日常生活 可怎麼調整",
  "失智症 看診 跟醫師溝通 要準備什麼",
  "睡不著 白天活動 作息建議",
  "心情 焦慮 門診 可問醫護",
  "吃藥 忘記 吃藥時間 怎麼辦",
  "走路 平衡 居家 安全",
  "吞嚥 吃東西 嗆到 何時該說",
  "黃昏 傍晚 情緒煩 可試著",
  "復健 活動 肌力 長輩安全",
  "頭暈 服藥 看診 要跟醫師說",
  "家屬陪伴 壓力 如何談感受",
];

function hashDateString(dateYmd: string): number {
  let h = 0;
  for (let i = 0; i < dateYmd.length; i++) {
    h = (h * 33 + dateYmd.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function pickProactiveTipSeedQuery(
  role: "family" | "patient",
  dateYmd: string,
  varietySalt: string
): string {
  const pool =
    role === "family"
      ? PROACTIVE_TIP_SEED_QUERIES_FAMILY
      : PROACTIVE_TIP_SEED_QUERIES_PATIENT;
  if (pool.length === 0) return "失智症 照顧 衛教";
  const key = `${dateYmd}:${role}:${varietySalt}`;
  const ix = hashDateString(key) % pool.length;
  return pool[ix]!;
}

type RankedTip = {
  chunk: { id?: string; source: string; text: string };
  score: number;
};

/** 依 varietySalt 在 top-k 命中裡穩定擇一則，避免每次都同一條 chunk */
export function pickTipChunkFromRanked(
  ranked: RankedTip[],
  varietySalt: string,
  topK = 3
): RankedTip | null {
  if (ranked.length === 0) return null;
  const k = Math.min(topK, ranked.length);
  const slice = ranked.slice(0, k);
  const idStr = slice
    .map(
      (r) =>
        (r.chunk.id && String(r.chunk.id)) ||
        `${r.chunk.source}\0${r.chunk.text.slice(0, 40)}`
    )
    .join("|");
  const ix = hashDateString(`${varietySalt}:chunk:${idStr}`) % k;
  return slice[ix] ?? slice[0] ?? null;
}

/**
 * 將 RAG 片段收成開場小錦囊用的一句話（偏好「答：」後正文；去 **、壓縮空白）。
 */
export function ragChunkTextToTipExcerpt(
  raw: string,
  maxLen: number
): string {
  let s = raw.replace(/\r\n/g, "\n").trim();
  const qLine = s.match(/^問[：:]\s*(.+)$/m);
  const aLine = s.match(/答[：:]\s*([\s\S]+)/);
  if (aLine) {
    s = aLine[1]!.trim();
  } else if (qLine && s.includes("答")) {
    const afterQ = s.split(/答[：:]/);
    if (afterQ.length > 1) s = afterQ.slice(1).join("答：").trim();
  }
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const puncts = ["。", "！", "？", "；"];
    let best = -1;
    for (const p of puncts) {
      const j = cut.lastIndexOf(p);
      if (j > best) best = j;
    }
    if (best >= Math.floor(maxLen * 0.45)) {
      return cut.slice(0, best + 1);
    }
    return cut.trimEnd() + "…";
  }
  return s;
}

export async function buildProactiveTipFromRag(
  role: "family" | "patient",
  varietySalt: string
): Promise<{
  excerpt: string;
  source: string;
} | null> {
  const dateYmd = todayDateTaipei();
  const query = pickProactiveTipSeedQuery(role, dateYmd, varietySalt);
  const ranked = await retrieveRag(query, 5);
  if (ranked.length === 0) return null;
  const picked = pickTipChunkFromRanked(ranked, varietySalt, 5);
  if (!picked) return null;
  const excerpt = ragChunkTextToTipExcerpt(picked.chunk.text, 320);
  if (excerpt.replace(/…/g, "").trim().length < 20) return null;
  return { excerpt, source: picked.chunk.source };
}
