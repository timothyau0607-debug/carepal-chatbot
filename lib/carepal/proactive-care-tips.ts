import { DEMENTIA_POCKET_TIPS_100 } from "@/lib/carepal/dementia-pocket-tips";
import type { UserRole } from "@/lib/carepal/user-role";

const STORAGE_PREFIX = "carepal_proactive_tip_ix:";

/** 家屬／病友開場與中段錦囊皆由此百題隨機抽取（stable hash 或 session 固定）。 */
const CARE_TIPS_FAMILY: readonly string[] = DEMENTIA_POCKET_TIPS_100;
const CARE_TIPS_PATIENT: readonly string[] = DEMENTIA_POCKET_TIPS_100;

function hashVarietyKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickFromPool(pool: readonly string[], role: "family" | "patient"): string {
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

/** 「標題：正文」拆成聊天口吻；無標題時整段當正文。 */
export function formatPocketTipAsChat(role: UserRole, rawTip: string): string {
  const normalized = rawTip
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  if (!normalized) return "";

  const colonIdx = normalized.indexOf("：");
  let headline = "";
  let body = normalized;
  if (
    colonIdx > 0 &&
    colonIdx <= 56 &&
    colonIdx < normalized.length - 8
  ) {
    headline = normalized.slice(0, colonIdx).trim();
    body = normalized.slice(colonIdx + 1).trim();
  }

  const pocket = "照顧者小錦囊";

  if (role === "family") {
    if (headline) {
      return `對了～今天「${pocket}」跟你分享一下：「${headline}」。${body}`;
    }
    return `對了～今天「${pocket}」跟你聊聊——${body}`;
  }
  if (role === "patient") {
    if (headline) {
      return `順便跟你分享一小段「${pocket}」（很多跟照顧有關的心得其實也適合給自己打氣）：「${headline}」。${body}`;
    }
    return `順便跟你分享一小段「${pocket}」——${body}`;
  }

  return normalized;
}

/** 依 varietyKey 穩定選一則（供伺服器中段小錦囊與開場 variety） */
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

/** 將題庫正文包成開場／聊天區塊用的口吻（已是聊天句式，不含另加重複標題）。 */
export function formatProactiveTipLead(role: UserRole, excerpt: string): string {
  const normalized = excerpt
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
  if (!normalized) return "";
  if (role === "family" || role === "patient") {
    return formatPocketTipAsChat(role, normalized);
  }
  return normalized;
}
