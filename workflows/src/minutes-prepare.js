// 승인된 회의록을 Confluence에 쓸 준비를 한다(설계 5절 H). 승인이 아니면 항목을 내지 않아 Confluence에 쓰지 않는다.
// CONFLUENCE(사이트·스페이스·상위 페이지)는 scripts/build-workflow.js가, markdownToStorage는 shared/confluence-format.js가 이 코드 앞에 붙인다.
const MEETING_KIND = '정기 회의'; // 회의 종류 고정값(shared/draft-rules.js의 고정 필드와 같다)

const decision = $('결정 읽기').first().json;
if (decision.outcome !== 'approve') return [];
if (!CONFLUENCE.parentPageId) throw new Error('Confluence 상위 페이지 ID가 없습니다. scripts/build-workflow.js의 MINUTES_PARENT_PAGE를 확인해 주세요');

const { meetingDate } = $('초안 요청 만들기').first().json;
const name = `${meetingDate} ${MEETING_KIND}`;
const content = decision.draft;
return [{
  json: {
    name,
    content,
    parentPageId: CONFLUENCE.parentPageId,
    request: {
      spaceId: CONFLUENCE.spaceId,
      status: 'current',
      title: name,
      parentId: CONFLUENCE.parentPageId,
      body: { representation: 'storage', value: markdownToStorage(content) },
    },
  },
}];
