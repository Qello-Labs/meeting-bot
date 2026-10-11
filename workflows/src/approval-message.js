// 검증을 통과한 초안을 회의 채널에 보낼 메시지를 만든다(설계 5절 G). 승인·거절 버튼을 달고 승인 기다리기 노드에서 멈춘다.
// 검증에 실패한 초안(draftOk: false)은 승인으로 넘기지 않는다. 항목을 내지 않으면 뒤 노드가 돌지 않고 실행이 끝난다.
const EMBED_LIMIT = 4096; // Discord embed description 한도
const CUSTOM_ID_LIMIT = 100; // Discord 버튼 ID 한도

const meeting = $('녹음 정보 확인').first().json;
const { meetingDate } = $('초안 요청 만들기').first().json;
const check = $('초안 검증').first().json;
if (!check.draftOk) return [];

// 재개 주소는 <base>/webhook-waiting/<실행 ID>?signature=<서명>이다(n8n 2.42.6 실험). 녹음 봇은 버튼 ID의 실행 ID와 서명으로
// Docker 내부 주소를 다시 만든다(2026-10-11 사용자 결정). 서명이 틀리면 n8n이 401로 거절한다.
// Code 노드 실행 환경에는 URL이 없어서(n8n 2.42.6 E2E에서 확인) 정규식으로 읽는다.
const resume = /\/webhook-waiting\/(\d+)\?signature=([0-9a-f]{64})$/.exec(String($execution.resumeUrl ?? ''));
if (!resume) throw new Error('n8n 재개 주소에서 실행 ID와 서명을 읽지 못했습니다');
const [, executionId, signature] = resume;
const customId = (action) => {
  const id = `mb:${action}:${executionId}:${signature}`;
  if (id.length > CUSTOM_ID_LIMIT) throw new Error(`버튼 ID가 ${CUSTOM_ID_LIMIT}자를 넘습니다`);
  return id;
};

// 4,096자까지는 embed 하나에 보이고, 넘으면 앞부분만 embed에 보이고 전체는 .md 파일로 붙인다(2026-10-11 사용자 결정).
// attach에 따라 긴 초안 확인(If) 노드가 첨부해 보내는 노드와 embed만 보내는 노드로 나눈다.
// 글자 수는 코드 포인트로 센다. 이모지 같은 문자를 반으로 자르지 않기 위해서다.
const chars = [...check.draft];
const attach = chars.length > EMBED_LIMIT;
const fileName = `meeting-notes-draft-${meeting.meetingId}.md`;
const more = '\n\n…(전체는 첨부한 .md 파일에 있습니다)';
const description = attach ? chars.slice(0, EMBED_LIMIT - [...more].length).join('') + more : check.draft;

const payload = {
  content: `회의 ${meeting.meetingId} 회의록 초안입니다. 3일 안에 승인 또는 거절을 눌러 주세요.`,
  embeds: [{ title: `회의록 초안 (${meetingDate})`, description }],
  components: [{
    type: 1,
    components: [
      { type: 2, style: 3, label: '승인', custom_id: customId('approve') },
      { type: 2, style: 4, label: '거절', custom_id: customId('reject') },
    ],
  }],
  // 초안에는 녹취와 채팅 문장이 들어 있어 @everyone 같은 멘션이 울리지 않게 끈다.
  allowed_mentions: { parse: [] },
  ...(attach ? { attachments: [{ id: 0, filename: fileName }] } : {}),
};

return [{
  json: { textChannelId: meeting.textChannelId, attach, payload },
  ...(attach ? {
    binary: { draft: { data: Buffer.from(check.draft, 'utf8').toString('base64'), mimeType: 'text/markdown', fileName } },
  } : {}),
}];
