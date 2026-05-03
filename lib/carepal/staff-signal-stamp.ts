import { todayDateTaipei } from "@/lib/carepal/taipei-calendar";

/**
 * 寫入「與醫護互動」欄之打氣／按讚／留言行的標準時間戳（台北日曆 YYYY-MM-DD + 24h 時分）。
 */
export function formatCarepalStaffSignalStamp(): string {
  const d = todayDateTaipei();
  const hm = new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${d} ${hm}`;
}
