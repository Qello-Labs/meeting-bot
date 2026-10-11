// 승인 기다리기(Wait)가 재개된 이유를 읽고 초안 메시지를 고칠 내용을 만든다.
// 녹음 봇이 버튼 클릭으로 재개하면 요청 본문에 { decision, by }가 온다. 3일이 지나 재개되면 본문 없이 보낸 메시지가 그대로 온다(n8n 2.42.6 실험).
const DECISIONS = { approve: '승인', reject: '거절' };

const meeting = $('녹음 정보 확인').first().json;
// 초안은 길이에 따라 두 노드 중 하나로 보냈다.
const sent = ($('초안 보내기').isExecuted ? $('초안 보내기') : $('초안 보내기(첨부)')).first().json;
const body = $input.first().json.body;

let decision = 'timeout';
let by = null;
if (body !== undefined) {
  if (!Object.hasOwn(DECISIONS, body?.decision)) throw new Error('승인 기다리기에 알 수 없는 결정이 왔습니다');
  decision = body.decision;
  // 누른 사람의 표시 이름만 받는다. 메시지에 그대로 쓰므로 줄바꿈을 없애고 길이를 줄인다.
  by = String(body.by ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || '알 수 없음';
}

const result = decision === 'timeout' ? '기한 초과(3일 동안 승인·거절 없음)' : `${DECISIONS[decision]}(${by})`;
return [{
  json: {
    decision,
    by,
    textChannelId: sent.channel_id,
    messageId: sent.id,
    // 버튼을 지우고 결과를 본문에 적는다. embed와 첨부는 보내지 않아 그대로 남는다.
    body: {
      content: `회의 ${meeting.meetingId} 회의록 초안: ${result}`,
      components: [],
      allowed_mentions: { parse: [] },
    },
  },
}];
