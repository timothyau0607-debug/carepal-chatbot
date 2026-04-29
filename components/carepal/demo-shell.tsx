"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, HeartPulse, StickyNote, Trash2, Users } from "lucide-react";
import { VoicePanel } from "./voice-panel";
import { ApiStatus } from "./api-status";
import { useCarePalIdentity } from "@/hooks/use-carepal-identity";
import { useCarePalDevMode } from "@/hooks/use-carepal-dev-mode";
import {
  USER_ROLES,
  USER_ROLE_LABEL,
  type UserRole,
} from "@/lib/carepal/user-role";
import {
  readLocalProfile,
  writeLocalProfile,
  type LocalProfileSnapshot,
} from "@/lib/carepal/local-profile";

const EMPTY_CLIENT_PROFILE: LocalProfileSnapshot = {
  display_name: "訪客",
  family_notes: "",
  mood_note: "",
  inferred_profile: "",
  preferences: "",
  traits: "",
  visit_context: "",
  staff_interaction_satisfaction: "",
  memory_lines: [],
};

const defaultRag = [
  {
    source: "衛福部失智症防治宣導",
    snippet: "（預設）尚未送出問題前，顯示示範出處。送出後會依關鍵字帶入右欄。",
  },
  {
    source: "台灣失智症協會衛教",
    snippet: "（預設）可嘗試問：「傍晚煩躁」「吃藥」「家屬壓力」等關鍵字。",
  },
];

type RagRow = { source: string; snippet: string };

type ProfileView = {
  supabase: boolean;
  display_name: string;
  family_notes: string;
  mood_note: string;
  inferred_profile: string;
  preferences: string;
  traits: string;
  visit_context: string;
  staff_interaction_satisfaction: string;
  memory_lines: { content: string }[];
  loading: boolean;
  error: string | null;
  /** 雲端暫不同步時的說明（非致命，用琥珀色顯示） */
  info: string | null;
};

const emptyProfile = (): ProfileView => ({
  supabase: false,
  display_name: "訪客",
  family_notes: "",
  mood_note: "",
  inferred_profile: "",
  preferences: "",
  traits: "",
  visit_context: "",
  staff_interaction_satisfaction: "",
  memory_lines: [],
  loading: true,
  error: null,
  info: null,
});

function focusFieldLabel(role: UserRole): string {
  if (role === "family") return "家屬重點";
  if (role === "patient") return "自覺重點或想記的事";
  return "臨床／團隊備註";
}

function focusDisplayLabel(role: UserRole): string {
  if (role === "family") return "家屬提到的重點";
  if (role === "patient") return "提到的重點";
  return "專業備註";
}

function emptyFocusPlaceholder(role: UserRole): string {
  if (role === "family")
    return "（可於左欄編輯「家屬重點」或新增條目，會併入小晴的長期脈絡。）";
  if (role === "patient")
    return "（可於左欄記下您在意的事，會併入小晴的長期脈絡。）";
  return "（可於左欄寫上臨床或教學上需留意的要點。）";
}

export function DemoShell() {
  const { userKey, userRole, setUserRole } = useCarePalIdentity();
  const { devMode, setDevMode } = useCarePalDevMode();
  const [ragRows, setRagRows] = useState<RagRow[] | null>(null);
  const [activityLine, setActivityLine] = useState("剛剛：尚未開始對話");
  const [profile, setProfile] = useState<ProfileView>(() => emptyProfile());
  const [editName, setEditName] = useState("");
  const [editInferred, setEditInferred] = useState("");
  const [editPreferences, setEditPreferences] = useState("");
  const [editTraits, setEditTraits] = useState("");
  const [editVisit, setEditVisit] = useState("");
  const [editStaffSat, setEditStaffSat] = useState("");
  const [editFamily, setEditFamily] = useState("");
  const [editMood, setEditMood] = useState("");
  const [newMemoryLine, setNewMemoryLine] = useState("");
  const [saving, setSaving] = useState(false);
  /** 切換身分或新載入時遞增，捨棄過期的 loadProfile 回寫（避免家屬資料寫回護士 UI） */
  const profileLoadGenerationRef = useRef(0);

  const resetProfileFormsForIdentitySwitch = useCallback(() => {
    setProfile(emptyProfile());
    setRagRows(null);
    setEditName("");
    setEditInferred("");
    setEditPreferences("");
    setEditTraits("");
    setEditVisit("");
    setEditStaffSat("");
    setEditFamily("");
    setEditMood("");
    setNewMemoryLine("");
    setActivityLine("剛剛：尚未開始對話");
  }, []);

  const handleRoleChange = useCallback(
    (id: UserRole) => {
      profileLoadGenerationRef.current += 1;
      resetProfileFormsForIdentitySwitch();
      setUserRole(id);
    },
    [resetProfileFormsForIdentitySwitch, setUserRole]
  );

  const loadProfile = useCallback(async () => {
    if (!userKey) return;
    const token = ++profileLoadGenerationRef.current;
    await Promise.resolve();
    if (token !== profileLoadGenerationRef.current) return;
    setProfile(emptyProfile());
    const local = readLocalProfile(userKey, userRole);
    try {
      const res = await fetch(
        `/api/carepal/profile?userKey=${encodeURIComponent(userKey)}&userRole=${encodeURIComponent(userRole)}`
      );
      if (token !== profileLoadGenerationRef.current) return;
      const data = (await res.json()) as {
        error?: string;
        syncWarning?: string;
        supabase?: boolean;
        profile?: {
          user_role?: string;
          display_name: string;
          family_notes: string;
          mood_note: string;
          inferred_profile?: string;
          preferences?: string;
          traits?: string;
          visit_context?: string;
          staff_interaction_satisfaction?: string;
          memory_lines: { content: string }[];
        };
      };
      if (token !== profileLoadGenerationRef.current) return;
      const cloudHint = data.syncWarning ?? null;
      if (!res.ok) {
        if (local) {
          setProfile({
            supabase: false,
            display_name: local.display_name,
            family_notes: local.family_notes,
            mood_note: local.mood_note,
            inferred_profile: local.inferred_profile,
            preferences: local.preferences,
            traits: local.traits,
            visit_context: local.visit_context,
            staff_interaction_satisfaction: local.staff_interaction_satisfaction,
            memory_lines: local.memory_lines,
            loading: false,
            error: `雲端讀取失敗：${data.error ?? res.status}。已顯示本機已儲存的內容。`,
            info: null,
          });
          setEditName(local.display_name);
          setEditInferred(local.inferred_profile);
          setEditPreferences(local.preferences);
          setEditTraits(local.traits);
          setEditVisit(local.visit_context);
          setEditStaffSat(local.staff_interaction_satisfaction);
          setEditFamily(local.family_notes);
          setEditMood(local.mood_note);
        } else {
          setProfile((p) => ({
            ...p,
            loading: false,
            error: data.error ?? "無法讀取畫像",
            info: null,
          }));
        }
        return;
      }
      if (!data.profile) {
        setProfile((p) => ({
          ...p,
          loading: false,
          error: "回應格式錯誤",
          info: null,
        }));
        return;
      }
      const supabaseOn = data.supabase ?? false;
      if (supabaseOn) {
        setProfile({
          supabase: true,
          display_name: data.profile.display_name,
          family_notes: data.profile.family_notes,
          mood_note: data.profile.mood_note,
          inferred_profile: data.profile.inferred_profile ?? "",
          preferences: data.profile.preferences ?? "",
          traits: data.profile.traits ?? "",
          visit_context: data.profile.visit_context ?? "",
          staff_interaction_satisfaction:
            data.profile.staff_interaction_satisfaction ?? "",
          memory_lines: data.profile.memory_lines ?? [],
          loading: false,
          error: null,
          info: null,
        });
        setEditName(data.profile.display_name);
        setEditInferred(data.profile.inferred_profile ?? "");
        setEditPreferences(data.profile.preferences ?? "");
        setEditTraits(data.profile.traits ?? "");
        setEditVisit(data.profile.visit_context ?? "");
        setEditStaffSat(data.profile.staff_interaction_satisfaction ?? "");
        setEditFamily(data.profile.family_notes);
        setEditMood(data.profile.mood_note);
        return;
      }
      if (local) {
        setProfile({
          supabase: false,
          display_name: local.display_name,
          family_notes: local.family_notes,
          mood_note: local.mood_note,
          inferred_profile: local.inferred_profile,
          preferences: local.preferences,
          traits: local.traits,
          visit_context: local.visit_context,
          staff_interaction_satisfaction: local.staff_interaction_satisfaction,
          memory_lines: local.memory_lines,
          loading: false,
          error: null,
          info: cloudHint,
        });
        setEditName(local.display_name);
        setEditInferred(local.inferred_profile);
        setEditPreferences(local.preferences);
        setEditTraits(local.traits);
        setEditVisit(local.visit_context);
        setEditStaffSat(local.staff_interaction_satisfaction);
        setEditFamily(local.family_notes);
        setEditMood(local.mood_note);
        return;
      }
      setProfile({
        supabase: false,
        display_name: data.profile.display_name,
        family_notes: data.profile.family_notes,
        mood_note: data.profile.mood_note,
        inferred_profile: data.profile.inferred_profile ?? "",
        preferences: data.profile.preferences ?? "",
        traits: data.profile.traits ?? "",
        visit_context: data.profile.visit_context ?? "",
        staff_interaction_satisfaction:
          data.profile.staff_interaction_satisfaction ?? "",
        memory_lines: data.profile.memory_lines ?? [],
        loading: false,
        error: null,
        info: cloudHint,
      });
      setEditName(data.profile.display_name);
      setEditInferred(data.profile.inferred_profile ?? "");
      setEditPreferences(data.profile.preferences ?? "");
      setEditTraits(data.profile.traits ?? "");
      setEditVisit(data.profile.visit_context ?? "");
      setEditStaffSat(data.profile.staff_interaction_satisfaction ?? "");
      setEditFamily(data.profile.family_notes);
      setEditMood(data.profile.mood_note);
    } catch {
      if (token !== profileLoadGenerationRef.current) return;
      if (local) {
        setProfile({
          supabase: false,
          display_name: local.display_name,
          family_notes: local.family_notes,
          mood_note: local.mood_note,
          inferred_profile: local.inferred_profile,
          preferences: local.preferences,
          traits: local.traits,
          visit_context: local.visit_context,
          staff_interaction_satisfaction: local.staff_interaction_satisfaction,
          memory_lines: local.memory_lines,
          loading: false,
          error: "網路錯誤。已顯示本機已儲存的內容。",
          info: null,
        });
        setEditName(local.display_name);
        setEditInferred(local.inferred_profile);
        setEditPreferences(local.preferences);
        setEditTraits(local.traits);
        setEditVisit(local.visit_context);
        setEditStaffSat(local.staff_interaction_satisfaction);
        setEditFamily(local.family_notes);
        setEditMood(local.mood_note);
      } else {
        setProfile((p) => ({
          ...p,
          loading: false,
          error: "網路錯誤",
          info: null,
        }));
      }
    }
  }, [userKey, userRole]);

  useEffect(() => {
    if (!userKey) return;
    const t = setTimeout(() => {
      void loadProfile();
    }, 0);
    return () => clearTimeout(t);
  }, [userKey, userRole, loadProfile]);

  const saveProfile = async () => {
    if (!userKey) return;
    setSaving(true);
    try {
      if (profile.supabase) {
        const res = await fetch("/api/carepal/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userKey,
            userRole,
            display_name: editName,
            family_notes: editFamily,
            mood_note: editMood,
            inferred_profile: editInferred,
            preferences: editPreferences,
            traits: editTraits,
            visit_context: editVisit,
            staff_interaction_satisfaction: editStaffSat,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setProfile((p) => ({ ...p, error: data.error ?? "儲存失敗" }));
          return;
        }
        await loadProfile();
        return;
      }
      writeLocalProfile(userKey, userRole, {
        display_name: editName,
        family_notes: editFamily,
        mood_note: editMood,
        inferred_profile: editInferred,
        preferences: editPreferences,
        traits: editTraits,
        visit_context: editVisit,
        staff_interaction_satisfaction: editStaffSat,
        memory_lines: profile.memory_lines,
      });
      setProfile((p) => ({
        ...p,
        display_name: editName,
        family_notes: editFamily,
        mood_note: editMood,
        inferred_profile: editInferred,
        preferences: editPreferences,
        traits: editTraits,
        visit_context: editVisit,
        staff_interaction_satisfaction: editStaffSat,
        error: null,
        info: p.info,
      }));
    } finally {
      setSaving(false);
    }
  };

  const addMemoryLine = async () => {
    const t = newMemoryLine.trim();
    if (!userKey || !t) return;
    if (!profile.supabase) {
      const next = [...profile.memory_lines, { content: t }];
      writeLocalProfile(userKey, userRole, {
        display_name: editName,
        family_notes: editFamily,
        mood_note: editMood,
        inferred_profile: editInferred,
        preferences: editPreferences,
        traits: editTraits,
        visit_context: editVisit,
        staff_interaction_satisfaction: editStaffSat,
        memory_lines: next,
      });
      setProfile((p) => ({
        ...p,
        memory_lines: next,
        error: null,
        info: p.info,
      }));
      setNewMemoryLine("");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/carepal/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userKey, userRole, content: t }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setProfile((p) => ({ ...p, error: data.error ?? "加入失敗" }));
        return;
      }
      setNewMemoryLine("");
      await loadProfile();
    } finally {
      setSaving(false);
    }
  };

  const runResetTrio = async () => {
    if (!userKey) return;
    if (
      !window.confirm(
        "確定要清除「歸納畫像、偏好、性格、到院情境、醫護互動」等歸納欄？\n不影響稱呼、家屬重點、情緒欄位與手動記憶條目。"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      if (profile.supabase) {
        const res = await fetch("/api/carepal/profile/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userKey, userRole, scope: "inferred_trio" }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setProfile((p) => ({ ...p, error: data.error ?? "清除失敗" }));
          return;
        }
        await loadProfile();
        return;
      }
      setEditInferred("");
      setEditPreferences("");
      setEditTraits("");
      setEditVisit("");
      setEditStaffSat("");
      writeLocalProfile(userKey, userRole, {
        display_name: editName,
        family_notes: editFamily,
        mood_note: editMood,
        inferred_profile: "",
        preferences: "",
        traits: "",
        visit_context: "",
        staff_interaction_satisfaction: "",
        memory_lines: profile.memory_lines,
      });
      setProfile((p) => ({
        ...p,
        inferred_profile: "",
        preferences: "",
        traits: "",
        visit_context: "",
        staff_interaction_satisfaction: "",
        error: null,
        info: p.info,
      }));
    } finally {
      setSaving(false);
    }
  };

  const runResetChatTurns = async () => {
    if (!userKey || !profile.supabase) {
      setProfile((p) => ({
        ...p,
        error: "刪除對話稽核需已連上 Supabase。",
      }));
      return;
    }
    if (
      !window.confirm(
        "確定刪除雲端儲存的所有「對話稽核」列（不影響手動加入的條目）？此動作無法還原。"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/carepal/profile/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userKey, userRole, scope: "chat_turns" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setProfile((p) => ({ ...p, error: data.error ?? "刪除失敗" }));
        return;
      }
      await loadProfile();
    } finally {
      setSaving(false);
    }
  };

  const runResetTrioAndChat = async () => {
    if (!userKey) return;
    if (!profile.supabase) {
      if (
        !window.confirm(
          "未連上 Supabase，將只清除本裝置的歸納欄位；對話稽核僅存於雲端。是否繼續？"
        )
      ) {
        return;
      }
      setSaving(true);
      try {
        setEditInferred("");
        setEditPreferences("");
        setEditTraits("");
        setEditVisit("");
        setEditStaffSat("");
        writeLocalProfile(userKey, userRole, {
          display_name: editName,
          family_notes: editFamily,
          mood_note: editMood,
          inferred_profile: "",
          preferences: "",
          traits: "",
          visit_context: "",
          staff_interaction_satisfaction: "",
          memory_lines: profile.memory_lines,
        });
        setProfile((p) => ({
          ...p,
          inferred_profile: "",
          preferences: "",
          traits: "",
          visit_context: "",
          staff_interaction_satisfaction: "",
          error: null,
          info: p.info,
        }));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (
      !window.confirm(
        "確定一併清除：歸納欄位 ＋ 雲端對話稽核？\n不刪家屬重點、情緒、稱呼與手動條目。"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/carepal/profile/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userKey,
          userRole,
          scope: "inferred_trio_and_chat_turns",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setProfile((p) => ({ ...p, error: data.error ?? "清除失敗" }));
        return;
      }
      await loadProfile();
    } finally {
      setSaving(false);
    }
  };

  const displayedRag = ragRows && ragRows.length > 0 ? ragRows : defaultRag;

  const longTermNote = profile.family_notes.trim()
    ? profile.family_notes
    : emptyFocusPlaceholder(userRole);
  const memoryExtra =
    profile.memory_lines.length > 0
      ? profile.memory_lines.map((l) => l.content).join("；")
      : null;

  const devToggle = (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 shadow-sm select-none">
      <input
        type="checkbox"
        className="rounded border-stone-400"
        checked={devMode}
        onChange={(e) => setDevMode(e.target.checked)}
      />
      <span className="font-medium">開發模式</span>
    </label>
  );

  if (!devMode) {
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-teal-50/50 to-stone-50">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-200/80 bg-white/95 px-3 py-2.5 shadow-sm">
          <h1 className="truncate text-base font-semibold text-stone-900">
            CarePal · 小晴
          </h1>
          {devToggle}
        </header>

        <div className="shrink-0 border-b border-stone-100 bg-white/80 px-3 py-2">
          <p className="mb-2 text-[0.65rem] text-stone-500">身分（示範）</p>
          <div
            className="grid grid-cols-3 gap-1.5"
            role="group"
            aria-label="目前使用者身分"
          >
            {USER_ROLES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => handleRoleChange(id)}
                className={
                  userRole === id
                    ? "rounded-lg border-2 border-teal-600 bg-teal-50 px-1 py-1.5 text-center text-[0.7rem] font-medium text-teal-900"
                    : "rounded-lg border border-stone-200 bg-white px-1 py-1.5 text-center text-[0.7rem] font-medium text-stone-600 shadow-sm"
                }
              >
                {USER_ROLE_LABEL[id].short}
              </button>
            ))}
          </div>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <VoicePanel
            compact
            onRagUpdate={setRagRows}
            onActivityLine={setActivityLine}
            userKey={userKey}
            userRole={userRole}
            onReplyComplete={
              profile.supabase && !profile.loading
                ? () => {
                    window.setTimeout(() => void loadProfile(), 1600);
                  }
                : undefined
            }
            clientProfile={
              !userKey
                ? EMPTY_CLIENT_PROFILE
                : !profile.loading
                  ? {
                      display_name: profile.display_name,
                      family_notes: profile.family_notes,
                      mood_note: profile.mood_note,
                      inferred_profile: profile.inferred_profile,
                      preferences: profile.preferences,
                      traits: profile.traits,
                      visit_context: profile.visit_context,
                      staff_interaction_satisfaction:
                        profile.staff_interaction_satisfaction,
                      memory_lines: profile.memory_lines,
                    }
                  : null
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-stone-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-stone-900 md:text-xl">
              CarePal · 失智症照護語音助理（Web Demo）
            </h1>
            <p className="text-sm text-stone-500">
              已串接 <code className="rounded bg-stone-200/60 px-1">/api/chat</code>、
              向量 RAG 與瀏覽器語音；長期記憶可經由 Supabase 儲存（見 .env）。
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            {devToggle}
            <ApiStatus />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-0 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-0">
        <aside className="order-2 border-stone-200/80 bg-stone-50/50 p-4 md:p-5 lg:order-1 lg:border-r">
          <div className="mb-3 flex items-center gap-2 text-stone-700">
            <Users className="size-4 shrink-0" aria-hidden />
            <h2 className="text-sm font-semibold">你是誰在問？</h2>
          </div>
            <p className="mb-2 text-xs text-stone-500">
            多數在醫院使用。小晴會依身分問候；畫像可記到院情境與和醫護互動感受（條目另存）。
            </p>
          <div
            className="mb-4 grid grid-cols-3 gap-1.5"
            role="group"
            aria-label="目前使用者身分"
          >
            {USER_ROLES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => handleRoleChange(id)}
                className={
                  userRole === id
                    ? "rounded-lg border-2 border-teal-600 bg-teal-50 px-1.5 py-2 text-center text-xs font-medium text-teal-900"
                    : "rounded-lg border border-stone-200/90 bg-white px-1.5 py-2 text-center text-xs font-medium text-stone-600 shadow-sm transition hover:border-stone-300"
                }
              >
                {USER_ROLE_LABEL[id].short}
                <span className="mt-0.5 block text-[0.65rem] font-normal leading-tight text-stone-500">
                  {id === "family"
                    ? "照顧者"
                    : id === "patient"
                      ? "本人"
                      : "專業"}
                </span>
              </button>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2 text-stone-700">
            <StickyNote className="size-4 shrink-0" aria-hidden />
            <h2 className="text-sm font-semibold">長期記憶與畫像</h2>
          </div>
          {!userKey || profile.loading ? (
            <p className="text-sm text-stone-500">載入中…</p>
          ) : (
            <>
              <ul className="space-y-3 text-sm text-stone-600">
                <li>
                  <span className="text-stone-400">稱呼／識別</span>
                  <p className="font-medium text-stone-800">
                    {profile.display_name}
                  </p>
                </li>
                <li>
                  <span className="text-stone-400">
                    從互動歸納的畫像（系統更新）
                  </span>
                  <p className="whitespace-pre-wrap text-stone-700">
                    {profile.inferred_profile.trim() || "—"}
                  </p>
                </li>
                <li>
                  <span className="text-stone-400">偏好、習慣</span>
                  <p className="whitespace-pre-wrap text-stone-700">
                    {profile.preferences.trim() || "—"}
                  </p>
                </li>
                <li>
                  <span className="text-stone-400">性格、表達風格</span>
                  <p className="whitespace-pre-wrap text-stone-700">
                    {profile.traits.trim() || "—"}
                  </p>
                </li>
                <li>
                  <span className="text-stone-400">
                    到院／陪診情境（歸納或手填）
                  </span>
                  <p className="whitespace-pre-wrap text-stone-700">
                    {profile.visit_context.trim() || "—"}
                  </p>
                </li>
                <li>
                  <span className="text-stone-400">與醫護互動滿意度</span>
                  <p className="whitespace-pre-wrap text-stone-700">
                    {profile.staff_interaction_satisfaction.trim() || "—"}
                  </p>
                </li>
                <li>
                  <span className="text-stone-400">
                    {focusDisplayLabel(userRole)}
                  </span>
                  <p>{longTermNote}</p>
                  {memoryExtra && (
                    <p className="mt-1 text-xs text-stone-500">
                      條目彙整：{memoryExtra}
                    </p>
                  )}
                </li>
                <li className="flex items-start gap-2">
                  <HeartPulse
                    className="mt-0.5 size-4 shrink-0 text-rose-500"
                    aria-hidden
                  />
                  <div>
                    <span className="text-stone-400">情緒／觀察</span>
                    <p className="font-medium text-stone-800">
                      {profile.mood_note.trim() || "—"}
                    </p>
                    <p className="text-xs text-stone-500">{activityLine}</p>
                  </div>
                </li>
              </ul>

              {profile.error && (
                <p className="mt-2 text-xs text-rose-600" role="status">
                  {profile.error}
                </p>
              )}

              {profile.info && !profile.error && (
                <p
                  className="mt-2 text-xs leading-relaxed text-amber-900/90"
                  role="status"
                >
                  {profile.info}
                </p>
              )}

              <div className="mt-4 space-y-2 rounded-lg border border-stone-200/80 bg-white/70 p-3 text-xs text-stone-600">
                <p className="font-medium text-stone-700">
                  {profile.supabase
                    ? "編輯畫像（寫入 Supabase，對話時會併入脈絡）"
                    : "未連上 Supabase 時：可按「儲存畫像」將內容存於本裝置瀏覽器，對話仍會帶入稱呼與筆記（換裝置不會同步）。"}
                </p>
                <label className="block">
                  稱呼
                  <input
                    className="mt-0.5 w-full rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={200}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  從互動歸納的畫像（有 LLM
                  與雲端時，每回對話後會嘗試更新；亦可手動刪改）
                  <textarea
                    className="mt-0.5 w-full min-h-[4rem] rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editInferred}
                    onChange={(e) => setEditInferred(e.target.value)}
                    maxLength={3000}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  偏好、飲食與溝通習慣（自填，會併入脈絡）
                  <textarea
                    className="mt-0.5 w-full min-h-[2.5rem] rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editPreferences}
                    onChange={(e) => setEditPreferences(e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  性格、表達方式（自填，會併入脈絡）
                  <textarea
                    className="mt-0.5 w-full min-h-[2.5rem] rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editTraits}
                    onChange={(e) => setEditTraits(e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  到院／陪診（可寫：今日是否到院、陪誰看診等；對話歸納也會寫入）
                  <textarea
                    className="mt-0.5 w-full min-h-[2.5rem] rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editVisit}
                    onChange={(e) => setEditVisit(e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  與醫護互動滿意度（歸納＋可手改）
                  <textarea
                    className="mt-0.5 w-full min-h-[2.5rem] rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editStaffSat}
                    onChange={(e) => setEditStaffSat(e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  {focusFieldLabel(userRole)}
                  <textarea
                    className="mt-0.5 w-full min-h-[3.5rem] rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editFamily}
                    onChange={(e) => setEditFamily(e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  情緒或觀察
                  <input
                    className="mt-0.5 w-full rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                    value={editMood}
                    onChange={(e) => setEditMood(e.target.value)}
                    maxLength={2000}
                    disabled={saving}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={saving}
                  className="w-full rounded-lg bg-stone-800 py-1.5 text-stone-50 transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profile.supabase ? "儲存畫像" : "儲存於本裝置"}
                </button>
                <div className="pt-1">
                  <label className="block">新增一則記憶條目</label>
                  <div className="mt-0.5 flex gap-1">
                    <input
                      className="min-w-0 flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-stone-800"
                      value={newMemoryLine}
                      onChange={(e) => setNewMemoryLine(e.target.value)}
                      maxLength={2000}
                      placeholder="例：兒子週六會回來"
                      disabled={saving}
                    />
                    <button
                      type="button"
                      onClick={() => void addMemoryLine()}
                      disabled={saving || !newMemoryLine.trim()}
                      className="shrink-0 rounded-lg bg-teal-700 px-2 py-1 text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      加入
                    </button>
                  </div>
                </div>

                <div className="border-t border-stone-200/80 pt-3">
                  <p className="mb-1.5 flex items-center gap-1.5 font-medium text-stone-700">
                    <Trash2 className="size-3.5 shrink-0" aria-hidden />
                    清除與刪除
                  </p>
                  <p className="mb-2 text-[0.7rem] leading-relaxed text-stone-500">
                    歸納內文若需重來可清三欄；「對話稽核」是每輪聊天寫入的備查，可單獨刪除（需
                    Supabase）。
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => void runResetTrio()}
                      disabled={saving}
                      className="w-full rounded-lg border border-amber-200/90 bg-amber-50/80 py-1.5 text-amber-950 transition hover:bg-amber-100/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      清除歸納欄位
                    </button>
                    <button
                      type="button"
                      onClick={() => void runResetChatTurns()}
                      disabled={saving || !profile.supabase}
                      title={
                        profile.supabase
                          ? "刪除 carepal_memory_entries 中 kind=chat_turn 的列"
                          : "需已連上 Supabase"
                      }
                      className="w-full rounded-lg border border-stone-200 bg-white py-1.5 text-stone-800 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      刪除雲端對話稽核
                    </button>
                    <button
                      type="button"
                      onClick={() => void runResetTrioAndChat()}
                      disabled={saving}
                      className="w-full rounded-lg border border-rose-200/90 bg-rose-50/70 py-1.5 text-rose-950 transition hover:bg-rose-100/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      歸納欄位 ＋ 對話稽核 一併清除
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="order-1 flex min-h-[420px] flex-col overflow-hidden border-stone-200/80 bg-gradient-to-b from-teal-50/40 to-stone-50/30 lg:order-2 lg:min-h-0">
          <VoicePanel
            onRagUpdate={setRagRows}
            onActivityLine={setActivityLine}
            userKey={userKey}
            userRole={userRole}
            onReplyComplete={
              profile.supabase && !profile.loading
                ? () => {
                    /* profile-infer 另一輪 LLM，晚於本 API 回傳；延遲讀畫像才含新稱呼 */
                    window.setTimeout(() => void loadProfile(), 1600);
                  }
                : undefined
            }
            clientProfile={
              !userKey
                ? EMPTY_CLIENT_PROFILE
                : !profile.loading
                  ? {
                      display_name: profile.display_name,
                      family_notes: profile.family_notes,
                      mood_note: profile.mood_note,
                      inferred_profile: profile.inferred_profile,
                      preferences: profile.preferences,
                      traits: profile.traits,
                      visit_context: profile.visit_context,
                      staff_interaction_satisfaction:
                        profile.staff_interaction_satisfaction,
                      memory_lines: profile.memory_lines,
                    }
                  : null
            }
          />
        </section>

        <aside className="order-3 border-stone-200/80 bg-amber-50/30 p-4 md:p-5 lg:border-l">
          <div className="mb-3 flex items-center gap-2 text-stone-700">
            <BookOpen className="size-4 shrink-0" aria-hidden />
            <h2 className="text-sm font-semibold">RAG 參考出處</h2>
          </div>
          <ul className="space-y-3">
            {displayedRag.map((row, i) => (
              <li
                key={`${row.source}-${i}`}
                className="rounded-xl border border-amber-200/80 bg-white/80 p-3 text-sm shadow-sm"
              >
                <p className="text-xs font-medium text-amber-900/80">
                  {row.source}
                </p>
                <p className="mt-1 text-stone-600">{row.snippet}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
