import { MessageFlags } from 'discord.js';

// n8n이 회의록 초안에 단 승인·거절 버튼을 처리한다(설계 5절 G). 버튼 ID는 `mb:<동작>:<실행 ID>:<서명>`이다.
// n8n 2.42.6 재개 주소는 `/webhook-waiting/<실행 ID>?signature=<서명>`이고 서명이 틀리면 401, 이미 재개된 실행이면 409다.
// 재개 주소는 Docker 네트워크 안에서만 열려 있어 녹음 봇이 대신 부른다. 결정은 먼저 누른 한 명의 것이고 n8n이 보장한다.
const BUTTON_ID = /^mb:(approve|reject):(\d{1,20}):([0-9a-f]{64})$/;
const LABELS = { approve: '승인', reject: '거절' };
const RESUME_TIMEOUT_MS = 10_000;

/** 승인 버튼 ID를 읽는다. 이 봇의 버튼이 아니면 null. */
export function parseApprovalId(customId) {
  const match = BUTTON_ID.exec(customId ?? '');
  return match ? { action: match[1], executionId: match[2], signature: match[3] } : null;
}

/** 회의 종료를 알리는 n8n 주소와 같은 곳(compose 내부 주소)의 재개 주소를 만든다. */
export function resumeUrlOf(webhookUrl, { executionId, signature }) {
  return `${new URL(webhookUrl).origin}/webhook-waiting/${executionId}?signature=${signature}`;
}

/**
 * 버튼 클릭이 승인 버튼이면 처리하고 true를 돌려준다. 결과는 누른 사람에게만 보이게 답한다.
 * Discord는 3초 안에 응답을 받아야 해서 n8n을 부르기 전에 먼저 지연 응답한다.
 */
export async function handleApprovalButton(interaction, { webhookUrl, fetch = globalThis.fetch }) {
  if (!interaction.isButton()) return false;
  const button = parseApprovalId(interaction.customId);
  if (!button) return false;
  if (interaction.user.bot) return true;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!webhookUrl) {
    await interaction.editReply('MEETING_ENDED_WEBHOOK_URL이 없어 n8n에 결정을 보내지 못했습니다.');
    return true;
  }

  // 누른 사람은 회의록에 적을 표시 이름만 보낸다. Discord ID는 보내지 않는다.
  const by = interaction.user.globalName || interaction.user.username;
  let reply;
  try {
    const response = await fetch(resumeUrlOf(webhookUrl, button), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: button.action, by }),
      signal: AbortSignal.timeout(RESUME_TIMEOUT_MS),
    });
    if (response.ok) reply = `${LABELS[button.action]}했습니다. 회의 채널의 초안 메시지에 결과가 표시됩니다.`;
    else if ([401, 404, 409].includes(response.status)) reply = '이미 처리됐거나 유효하지 않은 버튼입니다.';
    else reply = `n8n이 결정을 받지 못했습니다(HTTP ${response.status}). 잠시 뒤 다시 눌러 주세요.`;
  } catch (error) {
    // 오류 메시지에 재개 주소(서명)를 넣지 않는다.
    reply = `n8n에 연결하지 못했습니다(${error.name}). 잠시 뒤 다시 눌러 주세요.`;
  }
  await interaction.editReply(reply);
  return true;
}
