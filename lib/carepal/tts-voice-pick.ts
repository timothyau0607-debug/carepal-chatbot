/**
 * 在 speechSynthesis.getVoices() 內，依「繁中台灣偏女聲、較像真人」的啟發式挑選單一 Voice。
 * 實際聽感仍完全取決於 OS／瀏覽器內建引擎；要固定「小晴」人設需改接雲端 TTS（Azure / Google / ElevenLabs 等）。
 */

const MALE_STRONG =
  /男|Yunyang|Kangkang|Dmitri|male|Kumar|Bryant|Microsoft George|Microsoft Raul|Kang|Kuan/i;
const TW_FEMALE_HINT =
  /曉臻|HsiaoChen|曉雨|Hazel|Fiona|Yating|Xiaorou|Xiaomeng|台灣|Traditional Chinese|Chinese \(Taiwan\)|Mandarin.*Taiwan|zh-TW|cmn-TW|國語.*台|Natural.*繁/i;

function score(v: SpeechSynthesisVoice): number {
  let s = 0;
  const lang = (v.lang || "").toLowerCase();
  if (lang.startsWith("zh-tw") || lang === "zh_tw") s += 120;
  else if (lang.includes("tw") && lang.startsWith("zh-")) s += 90;
  else if (lang.startsWith("zh-hk") || lang.startsWith("yue-hk")) s += 35;
  else if (lang.startsWith("zh-cn") || lang === "cmn-cn") s += 50;
  else if (lang.startsWith("cmn") || lang.startsWith("zh")) s += 45;

  const blob = `${v.name} ${v.voiceURI ?? ""}`;
  if (MALE_STRONG.test(blob)) s -= 150;
  if (TW_FEMALE_HINT.test(blob)) s += 40;
  if (/neural|natural|wavenet|google|apple siri|microsoft/i.test(blob)) s += 8;

  return s;
}

export function pickXiaoqingVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** 人設：溫柔、年輕語感；可依實聽在檔內再微調 rate / pitch */
export const XIAOQING_TTS = {
  /** 1 = 系統預設；略大於 1 稍快一點 */
  rate: 1.03,
  /** 1 = 預設；略高可偏年輕，過高易失真 */
  pitch: 1.15,
} as const;
