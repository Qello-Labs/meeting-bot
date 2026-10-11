// 회의록 초안 메시지의 버튼. 초안 메시지 만들기와 수정 반영 만들기가 같은 버튼을 만들도록
// scripts/build-workflow.js가 이 파일을 두 Code 노드 앞에 붙인다.
const CUSTOM_ID_LIMIT = 100; // Discord 버튼·모달 ID 한도
const EDIT_LIMIT = 4000; // Discord 모달 텍스트 입력 한도. 이보다 긴 초안에는 수정 버튼을 달지 않는다

/**
 * 승인·수정·거절 버튼 줄을 만든다. 버튼 ID는 `mb:<동작>:<실행 ID>:<판 번호>:<서명>`이다.
 * 같은 실행에서 다시 기다려도 재개 주소의 서명이 같아서(n8n 2.42.6 실험) 판 번호로 옛 버튼과 새 버튼을 가른다.
 * 재개 주소는 <base>/webhook-waiting/<실행 ID>?signature=<서명>이고, Code 노드에는 URL이 없어 정규식으로 읽는다.
 */
function approvalButtons(rev, draft) {
  const resume = /\/webhook-waiting\/(\d+)\?signature=([0-9a-f]{64})$/.exec(String($execution.resumeUrl ?? ''));
  if (!resume) throw new Error('n8n 재개 주소에서 실행 ID와 서명을 읽지 못했습니다');
  const [, executionId, signature] = resume;
  const customId = (action) => {
    const id = `mb:${action}:${executionId}:${rev}:${signature}`;
    if (id.length > CUSTOM_ID_LIMIT) throw new Error(`버튼 ID가 ${CUSTOM_ID_LIMIT}자를 넘습니다`);
    return id;
  };
  const editable = [...draft].length <= EDIT_LIMIT;
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: '승인', custom_id: customId('approve') },
      ...(editable ? [{ type: 2, style: 2, label: '수정', custom_id: customId('edit') }] : []),
      { type: 2, style: 4, label: '거절', custom_id: customId('reject') },
    ],
  }];
}
