import { readLocalProfile, writeLocalProfile } from "@/lib/carepal/local-profile";
import type { LocalProfileSnapshot } from "@/lib/carepal/local-profile";
import type { UserRole } from "@/lib/carepal/user-role";

/** 將單行回饋併入醫護互動欄；先試雲端 PATCH，失敗則寫回本機快照（與 PATCH 同源合併邏輯）。 */
export async function persistStaffCheerSnippet(params: {
  userKey: string;
  userRole: UserRole;
  clientProfile: LocalProfileSnapshot;
  line: string;
}): Promise<{ ok: boolean; via: "cloud" | "local" | "none" }> {
  const { userKey, userRole, clientProfile, line } = params;
  const frag = line.replace(/\r\n/g, "\n").trim();
  if (!frag) return { ok: false, via: "none" };

  const prev = clientProfile.staff_interaction_satisfaction.trim();
  const nextBlock = `${prev}${prev ? "\n" : ""}${frag}`.slice(0, 2000);

  try {
    const res = await fetch("/api/carepal/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userKey,
        userRole,
        staff_interaction_satisfaction: nextBlock,
      }),
    });
    if (res.ok) return { ok: true, via: "cloud" };
  } catch {
    /* fallback local */
  }

  try {
    const saved = readLocalProfile(userKey, userRole);
    const base = saved ?? clientProfile;
    writeLocalProfile(userKey, userRole, {
      ...base,
      staff_interaction_satisfaction: nextBlock,
    });
    return { ok: true, via: "local" };
  } catch {
    return { ok: false, via: "none" };
  }
}
