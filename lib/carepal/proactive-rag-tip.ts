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
 * 去掉衛教 chunk 裡不宜朗讀／不像錦囊的 meta：PDF 出處、頁碼、撰文、OCR 頁眉頁腳等。
 * 可重複套用；不負責萃取「答：」（見 extractAnswerBodyForTip）。
 */
function stripRagMetadataNoiseForTip(input: string): string {
  let s = input.replace(/\r\n/g, "\n");

  s = s.replace(
    /[（(]\s*摘自\s*[《「][^》」\n]+[》」][^）\n]*?第\s*\d+\s*頁[^）\n]*[）)]/g,
    " "
  );
  s = s.replace(/[（(]\s*摘自[^）\n]{1,240}[）)]/g, " ");
  s = s.replace(/《[^》\n]{0,200}\.pdf[^》\n]{0,80}》/gi, " ");
  s = s.replace(/\.pdf\b/gi, " ");
  s = s.replace(/已壓縮/g, " ");

  s = s.replace(
    /(?:^|[\n。；])\s*\d{0,4}\s*撰文\s*[／\/╱]\s*[^\n]+/gm,
    (m) => (m.includes("\n") ? "\n" : " ")
  );
  s = s.replace(/撰文\s*[／\/╱]\s*[^\n。；!！?？]{1,80}/g, " ");

  s = s.replace(/(?:^|[\n\s，。；])(?:\d{1,4}\s*伍\s*)+/g, " ");
  s = s.replace(/(?:^|\s)\d{2,4}\s+(?=撰文)/g, " ");
  s = s.replace(/(?:^|[\s，。；])(?:\d{1,4}\s+){2,5}(?=[\u4e00-\u9fff「『])/g, " ");

  s = s.replace(/(^|[。！？；\s\n])([A-Z])([\u4e00-\u9fff])/g, "$1$3");

  s = s.replace(/第\s*\d{1,4}\s*頁/g, " ");
  s = s.replace(/[ \t\f\v\u00a0]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function stillLooksLikeSourceDump(s: string): boolean {
  return /摘自|\.pdf\b|撰文\s*[／\/╱]|第\s*\d{1,4}\s*頁|\d{1,3}\s*伍\b/.test(s);
}

function cleanTipPointFragment(p: string): string {
  return stripRagMetadataNoiseForTip(p).replace(/^\d+[).、．]\s*/, "").trim();
}

function isUsableTipPoint(p: string): boolean {
  const t = cleanTipPointFragment(p);
  if (t.length < 14) return false;
  if (stillLooksLikeSourceDump(t)) return false;
  const digitRatio =
    (t.match(/\d/g) ?? []).length / Math.max(1, t.replace(/\s/g, "").length);
  if (digitRatio > 0.35) return false;
  return true;
}

/** 從 RAG 片段取出「答：」正文，並去掉常見 Q&A／分類標籤。 */
function extractAnswerBodyForTip(raw: string): string {
  let s = stripRagMetadataNoiseForTip(raw.replace(/\r\n/g, "\n")).trim();
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
  return stripRagMetadataNoiseForTip(s);
}

function stripLeadingEnumeration(text: string): string {
  return text.replace(/^\s*\d+[).、．]\s*/, "").trim();
}

function splitBodyIntoTipPoints(body: string): string[] {
  const maxPoints = 4;

  const inlineChunks = body.split(
    /\s+\d{1,2}\.\s+(?=[\u4e00-\u9fff「『《])/
  );
  if (inlineChunks.length >= 2) {
    const pts = inlineChunks
      .map((c) => cleanTipPointFragment(c.trim()))
      .filter(isUsableTipPoint);
    if (pts.length >= 2) return pts.slice(0, maxPoints);
  }

  const listy = body.match(
    /(?:可(?:以)?嘗試|可以試著|建議|不妨|小提醒)[：:]\s*(.+)/
  );
  if (listy) {
    const tail = listy[1]!;
    const parts = tail
      .split(/[、；;，,]/)
      .map((p) => cleanTipPointFragment(stripLeadingEnumeration(p.trim())))
      .filter(isUsableTipPoint);
    if (parts.length >= 2) return parts.slice(0, maxPoints);
  }

  const bySentence = body
    .split(/(?<=[。！？])\s*/)
    .map((x) =>
      cleanTipPointFragment(
        stripLeadingEnumeration(x.replace(/[。！？\s]+$/g, "").trim())
      )
    )
    .filter(isUsableTipPoint);
  if (bySentence.length >= 2) return bySentence.slice(0, maxPoints);

  const bySemi = body
    .split(/[；;]/)
    .map((x) =>
      cleanTipPointFragment(stripLeadingEnumeration(x.trim()))
    )
    .filter(isUsableTipPoint);
  if (bySemi.length >= 2) return bySemi.slice(0, maxPoints);

  const one = cleanTipPointFragment(
    stripLeadingEnumeration(body.replace(/[。；]+$/g, "").trim())
  );
  return isUsableTipPoint(one) ? [one] : [];
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

  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const allNumbered =
    lines.length >= 2 &&
    lines.every((l) => /^\d{1,2}\.\s/.test(l));
  if (allNumbered) {
    let kept = [...lines];
    while (kept.join("\n").length > maxLen && kept.length > 1) {
      kept = kept.slice(0, -1);
    }
    let joined = kept.join("\n");
    if (joined.length <= maxLen) return joined;
    const lastLine = kept[kept.length - 1]!;
    const m = lastLine.match(/^(\d{1,2}\.\s)([\s\S]*)$/);
    if (m) {
      const prefix = m[1]!;
      const content = m[2]!;
      const budget = Math.max(
        24,
        maxLen - (joined.length - content.length)
      );
      const trunc = softTruncateAtPunctuation(content, budget);
      kept = [...kept.slice(0, -1), prefix + trunc];
      return kept.join("\n");
    }
    return softTruncateAtPunctuation(joined, maxLen);
  }

  const sep = "\n\n";
  const i = body.indexOf(sep);
  if (i === -1) return softTruncateAtPunctuation(body, maxLen);
  const head = body.slice(0, i);
  let tail = body.slice(i + sep.length);
  while (head.length + sep.length + tail.length > maxLen) {
    const tailLines = tail.split("\n").filter(Boolean);
    if (tailLines.length <= 1) break;
    tailLines.pop();
    tail = tailLines.join("\n");
  }
  const room = maxLen - head.length - sep.length;
  if (room < 24) return softTruncateAtPunctuation(head, maxLen);
  tail = softTruncateAtPunctuation(tail.trim(), Math.max(24, room));
  return `${head}${sep}${tail}`.trim();
}

/**
 * 將 RAG Q&A 收成「錦囊正文」（**不含**「今天先分享…」前綴；由 formatProactiveTipLead 統一加）。
 * 僅條列或一段可讀衛教意涵，不帶 PDF 出處／問句標籤。
 */
export function shapeRagChunkAsCareTipNugget(
  raw: string,
  maxLen: number,
  _role: "family" | "patient"
): string {
  void _role;
  const body = extractAnswerBodyForTip(raw);
  if (body.replace(/…/g, "").trim().length < 15) return "";
  if (stillLooksLikeSourceDump(body)) return "";

  const points = splitBodyIntoTipPoints(body);

  let out: string;
  if (points.length >= 2) {
    const lines = points.map((p, i) => `${i + 1}. ${p}`);
    out = lines.join("\n");
  } else if (points.length === 1) {
    const p = points[0]!;
    out = p;
  } else {
    const fallback = stripRagMetadataNoiseForTip(body);
    if (!fallback || stillLooksLikeSourceDump(fallback)) return "";
    out = softTruncateAtPunctuation(fallback, maxLen);
  }

  const cleaned = stripRagMetadataNoiseForTip(out);
  if (!cleaned || stillLooksLikeSourceDump(cleaned)) return "";
  return fitCareTipToMaxLen(cleaned, maxLen);
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
  const top = ranked.slice(0, 5);
  const rot = hashDateString(`${varietySalt}:tiptry`) % top.length;
  const order = [...top.slice(rot), ...top.slice(0, rot)];

  for (const r of order) {
    const excerpt = shapeRagChunkAsCareTipNugget(r.chunk.text, 420, role);
    if (excerpt.replace(/…/g, "").trim().length >= 20) {
      return { excerpt, source: r.chunk.source };
    }
  }
  return null;
}
