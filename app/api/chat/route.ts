import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { xiaoqingSystemForRole } from "@/lib/carepal/persona";
import { createChatLlm } from "@/lib/carepal/llm";
import { formatRagForPrompt, isRagPromptProbablyEmpty } from "@/lib/carepal/rag-match";
import { retrieveRag } from "@/lib/carepal/rag-retrieve";
import {
  isSubstantiveDementiaCareQuestion,
  wantsInformationalDepth,
  isLikelyCareTeachingQuestion,
} from "@/lib/carepal/substantive-care-question";
import { isValidUserKey } from "@/lib/carepal/user-key";
import { audiencePreambleForRole, parseUserRole } from "@/lib/carepal/user-role";
import {
  appendChatTurn,
  buildLongTermSystemBlock,
} from "@/lib/carepal/memory-store";
import { mergeInferredProfileFromTurn } from "@/lib/carepal/profile-infer";
import { formatTodayStaffFeedForSystemPrompt, buildStaffPraiseTimingHint } from "@/lib/carepal/staff-feed";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  formatLocalProfileForSystemPrompt,
  type LocalProfileSnapshot,
} from "@/lib/carepal/local-profile";
import {
  buildStaffSatisfactionNudge,
  hasRecordedStaffSatisfactionInPrompt,
  replyMentionsVisitOrStaffCare,
  shouldSkipHardStaffCareLead,
  shouldSuppressRepeatedStaffCareHardAppend,
  STAFF_CARE_LEAD,
  STAFF_PRAISE_NUDGE_MIN_USER_MESSAGES,
} from "@/lib/carepal/visit-staff-nudge";
import {
  buildMidConversationTipSystemBlock,
  shouldOfferMidConversationTip,
} from "@/lib/carepal/mid-conversation-tip";
import { pickProactiveCareTipForVariety } from "@/lib/carepal/proactive-care-tips";

type Msg = { role: "user" | "assistant"; content: string };

type Body = {
  messages?: Msg[];
  userKey?: string;
  userRole?: string;
  /** 上一次「對話中段」注入小錦囊時的使用者訊息則數（不含本則）；用於節流 */
  lastProactiveTipUserCount?: number;
  /** 本機畫像（未連雲端或作補充），與雲端長期記憶二選一併用 */
  clientProfile?: {
    display_name?: string;
    family_notes?: string;
    mood_note?: string;
    inferred_profile?: string;
    preferences?: string;
    traits?: string;
    visit_context?: string;
    staff_interaction_satisfaction?: string;
    memory_lines?: { content: string }[];
  };
};

function demoReply(userText: string, ragText: string): string {
  if (ragText.includes("沒有匹配")) {
    return "有聽到你說的。能再具體一點嗎？例如是晚上煩躁還是用藥。緊急狀況記得尋求醫療協助喔。";
  }
  return "有聽懂你的關心。照顧上固定作息、光線與安全往往最重要；用藥務必依醫囑。需要細節再跟我說。";
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "需要 messages: { role, content }[]" },
      { status: 400 }
    );
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content?.trim()) {
    return NextResponse.json(
      { error: "最後一則使用者內容不可為空" },
      { status: 400 }
    );
  }

  const ranked = await retrieveRag(lastUser.content, 5);
  const ragText = formatRagForPrompt(ranked);
  const hasRagSnippets = !isRagPromptProbablyEmpty(ragText);
  const sources = ranked.slice(0, 5).map((r) => ({
    source: r.chunk.source,
    snippet: r.chunk.text.slice(0, 150) + (r.chunk.text.length > 150 ? "…" : ""),
  }));

  const userRole = parseUserRole(body.userRole, "family");
  const audiencePreamble = audiencePreambleForRole(userRole);
  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const substantiveCareQuestion =
    isSubstantiveDementiaCareQuestion(lastUser.content);
  const wantsInfoDepth = wantsInformationalDepth(lastUser.content);
  const longFormCare = substantiveCareQuestion || wantsInfoDepth;

  const offerMidTip = shouldOfferMidConversationTip({
    userRole,
    userMessageCount,
    lastUserText: lastUser.content,
    longFormCare,
    lastProactiveTipUserCount: body.lastProactiveTipUserCount,
  });

  let midConversationTipBlock = "";
  let midTipSource: { source: string; snippet: string } | null = null;
  if (
    offerMidTip &&
    (userRole === "family" || userRole === "patient")
  ) {
    const varietyKey = `${userMessageCount}:${body.lastProactiveTipUserCount ?? 0}:${body.userKey ?? ""}:${randomUUID()}`;
    const excerpt = pickProactiveCareTipForVariety(userRole, varietyKey).trim();
    if (excerpt.length >= 15) {
      midTipSource = {
        source: "照顧／失智小錦囊",
        snippet:
          excerpt.length > 150 ? excerpt.slice(0, 150) + "…" : excerpt,
      };
      midConversationTipBlock = buildMidConversationTipSystemBlock({
        role: userRole,
        excerpt,
      });
    }
  }

  let longTermBlock = "";
  if (isValidUserKey(body.userKey)) {
    const supabase = getSupabaseAdmin();
    if (supabase) {
      try {
        longTermBlock = await buildLongTermSystemBlock(
          supabase,
          body.userKey!,
          userRole
        );
      } catch (e) {
        console.error("[carepal] long-term memory load failed", e);
      }
    }
  }

  const clientBlock = (() => {
    const c = body.clientProfile;
    if (!c) return "";
    const snap: LocalProfileSnapshot = {
      display_name: c.display_name ?? "",
      family_notes: c.family_notes ?? "",
      mood_note: c.mood_note ?? "",
      inferred_profile: c.inferred_profile ?? "",
      preferences: c.preferences ?? "",
      traits: c.traits ?? "",
      visit_context: c.visit_context ?? "",
      staff_interaction_satisfaction: c.staff_interaction_satisfaction ?? "",
      memory_lines: Array.isArray(c.memory_lines) ? c.memory_lines : [],
    };
    return formatLocalProfileForSystemPrompt(snap, userRole);
  })();
  const useCloudMemory = longTermBlock.trim().length > 0;
  const memoryForPrompt = useCloudMemory ? longTermBlock : clientBlock;

  const suppressRepeatedVisitStaffAsk =
    shouldSuppressRepeatedStaffCareHardAppend(messages);

  const staffSatisfactionNudge = buildStaffSatisfactionNudge(
    userRole,
    useCloudMemory,
    memoryForPrompt,
    userMessageCount,
    body.clientProfile,
    suppressRepeatedVisitStaffAsk
      ? { suppressRepeatedVisitStaffAsk: true }
      : undefined
  );

  let staffFeedBlock = "";
  if (userRole === "staff") {
    const s = getSupabaseAdmin();
    if (s) {
      try {
        staffFeedBlock = await formatTodayStaffFeedForSystemPrompt(s);
      } catch (e) {
        console.error("[carepal] staff feed", e);
      }
    }
  }

  const staffPraiseTimingHint =
    userRole === "staff"
      ? buildStaffPraiseTimingHint({
          userMessageCount,
          lastUserText: lastUser.content,
          hasStaffFeed: staffFeedBlock.trim().length > 0,
        })
      : "";

  const llm = createChatLlm();
  if (llm) {
    try {
      const ragBackedDepth =
        hasRagSnippets && isLikelyCareTeachingQuestion(lastUser.content);

      const ragReferenceBlock = `參考資料（可引用，勿捏造未列內容）：\n${ragText}`;
      const ragGroundingRule =
        "若參考資料與本輪使用者所問的主題相關，事實、步驟與用語仍須以參考資料為準；可維持溫短口吻，但不可略過關鍵要點。僅在參考資料明顯與本輪無關時，再依情緒陪伴為主。";
      const ragGroundingStrong = longFormCare
        ? "【參考資料優先】以下片段若與本輪問題有關，回覆須**融入**其中要點並說清楚（可數句或數點，可不標出處）；切勿只用泛泛常識帶過。若明顯無關，不要硬套。"
        : "【參考資料優先】以下片段若與使用者本輪問題有關，回覆須至少反映其中一項具體要點（一句即可，可不標出處）；切勿只用模型自身的泛泛常識帶過。若明顯無關，不要硬套。";

      const substantiveCareHint = longFormCare
        ? "【本輪判斷】使用者正在問失智／照護相關**實質問題**（或明顯希望一次說清楚）：請依人設【篇幅—失智／照護實質提問】給**較完整、讀得懂**的答案；**勿**只回一兩句敷衍。仍遵守安全邊界與參考資料。"
        : "";

      const singleReplyCompletenessHint =
        longFormCare || ragBackedDepth
          ? "【單則答覆】本輪若在問作法、原因、要注意什麼、或希望說明／重點整理，請在**同一則回覆**內給齊核心步驟或判準，不要刻意留尾而逼對方多輪追問才講完；仍遵守參考資料與安全邊界。"
          : "";

      const systemParts = [
        xiaoqingSystemForRole(userRole),
        audiencePreamble,
        ragReferenceBlock,
        ...(hasRagSnippets ? [ragGroundingStrong] : []),
        ragGroundingRule,
        substantiveCareHint,
        ...(singleReplyCompletenessHint ? [singleReplyCompletenessHint] : []),
        midConversationTipBlock,
        staffFeedBlock,
        staffPraiseTimingHint,
        memoryForPrompt,
      ].filter((s) => s && s.trim().length > 0);
      if (staffSatisfactionNudge.trim()) {
        systemParts.push(
          "【下筆前最末提醒—須併入本則，勿整段略過】\n" + staffSatisfactionNudge
        );
      }
      const systemWithRag = systemParts.join("\n\n");
      const nudgeOn = staffSatisfactionNudge.trim().length > 0;
      const needRoomForStaffNudge =
        nudgeOn &&
        !suppressRepeatedVisitStaffAsk &&
        (userRole === "family" || userRole === "patient") &&
        userMessageCount >= STAFF_PRAISE_NUDGE_MIN_USER_MESSAGES;
      let maxOutTokens = needRoomForStaffNudge
        ? 520
        : nudgeOn && (userRole === "family" || userRole === "patient")
          ? 320
          : staffPraiseTimingHint.trim().length > 0
            ? 380
            : 220;

      if (longFormCare) {
        const floor = userRole === "staff" ? 640 : 840;
        maxOutTokens = Math.max(maxOutTokens, floor);
      } else if (ragBackedDepth) {
        const floorMid = userRole === "staff" ? 520 : 680;
        maxOutTokens = Math.max(maxOutTokens, floorMid);
      }
      if (midConversationTipBlock.trim() && (userRole === "family" || userRole === "patient")) {
        maxOutTokens = Math.max(maxOutTokens, 380);
      }
      const completion = await llm.client.chat.completions.create({
        model: llm.model,
        messages: [
          { role: "system", content: systemWithRag },
          ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
        max_tokens: maxOutTokens,
        temperature: 0.75,
      });
      let out = completion.choices[0]?.message?.content?.trim() ?? "";
      if (
        needRoomForStaffNudge &&
        !suppressRepeatedVisitStaffAsk &&
        !hasRecordedStaffSatisfactionInPrompt(
          useCloudMemory,
          memoryForPrompt,
          body.clientProfile
        ) &&
        !replyMentionsVisitOrStaffCare(out) &&
        !shouldSkipHardStaffCareLead(
          lastUser.content,
          (() => {
            for (let i = messages.length - 2; i >= 0; i--) {
              const m = messages[i];
              if (m?.role === "assistant") return m.content;
            }
            return undefined;
          })()
        )
      ) {
        out = out + "\n\n" + STAFF_CARE_LEAD;
      }
      const text = out;
      if (!text) {
        return NextResponse.json(
          { error: "模型未回傳內容" },
          { status: 502 }
        );
      }
      if (isValidUserKey(body.userKey)) {
        const supa = getSupabaseAdmin();
        if (supa) {
          void appendChatTurn(
            supa,
            body.userKey!,
            userRole,
            lastUser.content,
            text
          ).catch((e) => console.error("[carepal] appendChatTurn", e));
          void mergeInferredProfileFromTurn(
            supa,
            body.userKey!,
            userRole,
            lastUser.content,
            text
          ).catch((e) =>
            console.error("[carepal] mergeInferredProfile", e)
          );
        }
      }
      const responseSources =
        midTipSource && midConversationTipBlock.trim()
          ? [midTipSource, ...sources]
          : sources;
      return NextResponse.json({
        reply: text,
        sources: responseSources,
        mode: "llm" as const,
        ...(midConversationTipBlock.trim()
          ? { midTipOfferedAt: userMessageCount }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "LLM 呼叫失敗";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  const reply = demoReply(lastUser.content, ragText);
  if (isValidUserKey(body.userKey)) {
    const supa = getSupabaseAdmin();
    if (supa) {
      void appendChatTurn(
        supa,
        body.userKey!,
        userRole,
        lastUser.content,
        reply
      ).catch((e) => console.error("[carepal] appendChatTurn", e));
    }
  }
  return NextResponse.json({
    reply,
    sources,
    mode: "demo" as const,
  });
}
