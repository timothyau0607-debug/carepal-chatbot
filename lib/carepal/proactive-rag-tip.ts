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

const CARE_TIP_HOOKS_FAMILY = [
  "今天先收一則照顧小錦囊：",
  "照護路上記一筆，之後用得到：",
  "給你帶一句實用提醒：",
  "先擱一則貼近日常的照顧心法：",
];

const CARE_TIP_HOOKS_PATIENT = [
  "先替你收一則小提醒：",
  "這則小錦囊給你參考：",
  "照顧自己時可以記著：",
  "給你一句可帶在身邊的提醒：",
];

function pickCareTipHook(role: "family" | "patient", raw: string): string {
  const pool =
    role === "patient" ? CARE_TIP_HOOKS_PATIENT : CARE_TIP_HOOKS_FAMILY;
  const ix = hashDateString(`hook:${raw.slice(0, 96)}`) % pool.length;
  return pool[ix]!;
}

/** 從 RAG 片段取出「答：」正文，並去掉常見 Q&A／分類標籤。 */
function extractAnswerBodyForTip(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n").trim();
  s = s.replace(/(?:^|\n)分類[：:][^\n]*/g, "\n").trim();
  const aLine = s.match(/答[：:]\s*([\s\S]+?)(?=\n問[：:]|$)/);
  if (aLine) {
    s = aLine[1]!.trim();
  } else {
    s = s.replace(/(?:^|\n)問[：:][^\n]*/g, "\n").trim();
    if (s.includes("答")) {
      const after = s.split(/答[：:]/);
      if (after.length > 1) s = after.slice(1).join(" ").trim();
    }
  }
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n+/g, " ").trim();
  return s;
}

function stripLeadingEnumeration(text: string): string {
  return text.replace(/^\s*\d+[).、．]\s*/, "").trim();
}

function splitBodyIntoTipPoints(body: string): string[] {
  const minSeg = 10;
  const maxPoints = 4;

  const listy = body.match(
    /(?:可(?:以)?嘗試|可以試著|建議|不妨|小提醒)[：:]\s*(.+)/
  );
  if (listy) {
    const tail = listy[1]!;
    const parts = tail
      .split(/[、；;，,]/)
      .map((p) => stripLeadingEnumeration(p.trim()))
      .filter((p) => p.length >= minSeg);
    if (parts.length >= 2) return parts.slice(0, maxPoints);
  }

  const bySentence = body
    .split(/(?<=[。！？])\s*/)
    .map((x) =>
      stripLeadingEnumeration(x.replace(/[。！？\s]+$/g, "").trim())
    )
    .filter((x) => x.length >= minSeg);
  if (bySentence.length >= 2) return bySentence.slice(0, maxPoints);

  const bySemi = body
    .split(/[；;]/)
    .map((x) => stripLeadingEnumeration(x.trim()))
    .filter((x) => x.length >= minSeg);
  if (bySemi.length >= 2) return bySemi.slice(0, maxPoints);

  const one = stripLeadingEnumeration(body.replace(/[。；]+$/g, "").trim());
  return one.length >= minSeg ? [one] : [];
}

function softTruncateAtPunctuation(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const puncts = ["。", "！", "？", "；", "，"];
  let best = -1;
  for (const p of puncts) {
    const j = cut.lastIndexOf(p);
    if (j > best) best = j;
  }
  if (best >= Math.floor(maxLen * 0.42)) {
    return cut.slice(0, best + 1).trim();
  }
  return cut.trimEnd() + "…";
}

function fitCareTipToMaxLen(body: string, maxLen: number): string {
  if (body.length <= maxLen) return body;
  const sep = "\n\n";
  const i = body.indexOf(sep);
  if (i === -1) return softTruncateAtPunctuation(body, maxLen);
  const head = body.slice(0, i);
  let tail = body.slice(i + sep.length);
  while (head.length + sep.length + tail.length > maxLen) {
    const lines = tail.split("\n").filter(Boolean);
    if (lines.length <= 1) break;
    lines.pop();
    tail = lines.join("\n");
  }
  const room = maxLen - head.length - sep.length;
  if (room < 24) return softTruncateAtPunctuation(head, maxLen);
  tail = softTruncateAtPunctuation(tail.trim(), Math.max(24, room));
  return `${head}${sep}${tail}`.trim();
}

/**
 * 將 RAG Q&A 改寫成「照顧小錦囊」口吻：錦囊式開頭 + 條列重點（非原文問句）。
 */
export function shapeRagChunkAsCareTipNugget(
  raw: string,
  maxLen: number,
  role: "family" | "patient"
): string {
  const body = extractAnswerBodyForTip(raw);
  if (body.replace(/…/g, "").trim().length < 15) return "";

  const hook = pickCareTipHook(role, raw);
  const points = splitBodyIntoTipPoints(body);

  let out: string;
  if (points.length >= 2) {
    const lines = points.map((p, i) => `${i + 1}. ${p}`);
    out = `${hook}\n\n${lines.join("\n")}`;
  } else if (points.length === 1) {
    const p = points[0]!;
    out = `${hook}\n\n${p}`;
  } else {
    out = `${hook}\n\n${softTruncateAtPunctuation(body, maxLen - hook.length - 2)}`;
  }

  return fitCareTipToMaxLen(out, maxLen);
}

/**
 * @deprecated Prefer {@link shapeRagChunkAsCareTipNugget}; 保留相容，預設家屬錦囊口吻。
 */
export function ragChunkTextToTipExcerpt(
  raw: string,
  maxLen: number
): string {
  return shapeRagChunkAsCareTipNugget(raw, maxLen, "family");
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
  const excerpt = shapeRagChunkAsCareTipNugget(
    picked.chunk.text,
    420,
    role
  );
  if (excerpt.replace(/…/g, "").trim().length < 20) return null;
  return { excerpt, source: picked.chunk.source };
}
