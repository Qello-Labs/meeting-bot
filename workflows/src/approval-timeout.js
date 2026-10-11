// 기한 초과일 때만 회의 채널에 알린다. 승인·거절은 누른 사람이 바로 보고 메시지에도 결과가 남아 따로 알리지 않는다.
const result = $('결정 읽기').first().json;
if (result.decision !== 'timeout') return [];

const meeting = $('녹음 정보 확인').first().json;
return [{
  json: {
    textChannelId: result.textChannelId,
    body: {
      content: `회의 ${meeting.meetingId} 회의록 초안을 3일 동안 아무도 승인하거나 거절하지 않아 ClickUp에 쓰지 않았습니다.`,
      message_reference: { message_id: result.messageId, fail_if_not_exists: false },
      allowed_mentions: { parse: [], replied_user: false },
    },
  },
}];
