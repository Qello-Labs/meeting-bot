import { MessageFlags } from 'discord.js';

// n8n이 회의록 초안에 단 승인·수정·거절 버튼과 수정 모달을 처리한다(설계 5절 G).
// 버튼·모달 ID는 `mb:<동작>:<실행 ID>:<판 번호>:<서명>`이다. n8n 2.42.6 재개 주소는 `/webhook-waiting/<실행 ID>?signature=<서명>`이고
// 서명이 틀리면 401, 끝난 실행이면 409다. 같은 실행에서 다시 기다려도 서명이 같아서 n8n이 판 번호로 옛 버튼을 가르고,
// 판단(받음, 이미 바뀜, 검증 실패)을 응답으로 돌려준다. 재개 주소는 Docker 네트워크 안에서만 열려 있어 녹음 봇이 대신 부른다.
const BUTTON_ID = /^mb:(approve|reject|edit):(\d{1,20}):(\d{1,6}):([0-9a-f]{64})$/;
const LABELS = { approve: '승인', reject: '거절', edit: '수정' };
const RESUME_TIMEOUT_MS = 10_000;
const EDIT_LIMIT = 4000; // Discord 모달 텍스트 입력 한도
const DRAFT_FIELD = 'draft';

/** 승인 버튼·모달 ID를 읽는다. 이 봇의 것이 아니면 null. */
export function parseApprovalId(customId) {
  const match = BUTTON_ID.exec(customId ?? '');
  return match ? { action: match[1], executionId: match[2], rev: Number(match[3]), signature: match[4] } : null;
}

/** 회의 종료를 알리는 n8n 주소와 같은 곳(compose 내부 주소)의 재개 주소를 만든다. */
export function resumeUrlOf(webhookUrl, { executionId, signature }) {
  return `${new URL(webhookUrl).origin}/webhook-waiting/${executionId}?signature=${signature}`;
}

/** 초안 메시지의 embed 본문을 채운 수정 모달. 모달 ID는 버튼 ID와 같다(판 번호가 함께 간다). */
export function editModal(customId, draft) {
  return {
    custom_id: customId,
    title: '회의록 초안 수정',
    components: [{
      type: 1,
      components: [{
        type: 4,
        custom_id: DRAFT_FIELD,
        style: 2,
        label: '근거 형식을 지켜 고쳐 주세요',
        value: draft,
        min_length: 1,
        max_length: EDIT_LIMIT,
        required: true,
      }],
    }],
  };
}

/** n8n 응답을 누른 사람에게 보일 안내로 바꾼다. */
async function replyOf(response, action) {
  if ([401, 404, 409].includes(response.status)) return '이미 처리됐거나 유효하지 않은 버튼입니다.';
  if (!response.ok) return `n8n이 결정을 받지 못했습니다(HTTP ${response.status}). 잠시 뒤 다시 눌러 주세요.`;
  const answer = await response.json().catch(() => null);
  if (answer?.result === 'accepted') return `${LABELS[action]}했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.`;
  if (answer?.result === 'stale') return '그 사이 초안이 바뀌었습니다. 회의 채널의 최신 초안 메시지에서 다시 눌러 주세요.';
  if (answer?.result === 'invalid') {
    const counts = Object.entries(answer.errorCounts ?? {}).map(([kind, n]) => `${kind} ${n}개`).join(', ');
    return `고친 초안이 근거 검증을 통과하지 못해 반영하지 않았습니다(${counts || '오류'}). 고치기 전 초안이 그대로 있습니다.`;
  }
  return 'n8n이 알 수 없는 응답을 보냈습니다. 회의 채널의 초안 메시지를 확인해 주세요.';
}

/**
 * 버튼 클릭이나 수정 모달 제출이 이 봇의 승인 버튼이면 처리하고 true를 돌려준다. 결과는 누른 사람에게만 보이게 답한다.
 * Discord는 3초 안에 응답을 받아야 한다. 수정 버튼은 n8n을 부르지 않고 바로 모달을 열고, 나머지는 먼저 지연 응답한다.
 */
export async function handleApprovalButton(interaction, { webhookUrl, fetch = globalThis.fetch }) {
  const isButton = interaction.isButton();
  if (!isButton && !interaction.isModalSubmit()) return false;
  const button = parseApprovalId(interaction.customId);
  if (!button || (!isButton && button.action !== 'edit')) return false;
  if (interaction.user.bot) return true;

  if (isButton && button.action === 'edit') {
    const draft = interaction.message?.embeds?.[0]?.description ?? '';
    if (draft === '' || [...draft].length > EDIT_LIMIT) {
      await interaction.reply({ content: '이 초안은 모달로 고칠 수 없습니다. 승인한 뒤 ClickUp에서 고쳐 주세요.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(editModal(interaction.customId, draft));
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!webhookUrl) {
    await interaction.editReply('MEETING_ENDED_WEBHOOK_URL이 없어 n8n에 결정을 보내지 못했습니다.');
    return true;
  }

  // 누른 사람은 회의록에 적을 표시 이름만 보낸다. Discord ID는 보내지 않는다.
  const by = interaction.user.globalName || interaction.user.username;
  const body = { decision: button.action, rev: button.rev, by };
  if (!isButton) body.draft = interaction.fields.getTextInputValue(DRAFT_FIELD);
  let reply;
  try {
    const response = await fetch(resumeUrlOf(webhookUrl, button), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESUME_TIMEOUT_MS),
    });
    reply = await replyOf(response, button.action);
  } catch (error) {
    // 오류 메시지에 재개 주소(서명)를 넣지 않는다.
    reply = `n8n에 연결하지 못했습니다(${error.name}). 잠시 뒤 다시 눌러 주세요.`;
  }
  await interaction.editReply(reply);
  return true;
}
