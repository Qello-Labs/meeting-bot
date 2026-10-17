// 테스트용 회의록 템플릿. 오프라인 테스트와 E2E 가짜 Confluence가 같이 쓴다.
// TEMPLATE_STORAGE는 Confluence `회의록 템플릿` 페이지의 저장 형식을 흉내 낸 것이다. 이전 도구에서 옮겨 온 페이지라 표 머리글이 td이고,
// 제목 앞에 앵커 매크로, 끝에 마이그레이션 확장이 있다. 액션 아이템 표의 마지막 열은 Jira 이슈다.
// TEMPLATE은 TEMPLATE_STORAGE를 shared/confluence-format.js의 storageToMarkdown으로 바꾼 결과와 같아야 한다(오프라인 테스트에서 확인).
const anchor = (n) => `<p><ac:structured-macro ac:name="anchor" ac:schema-version="1" ac:macro-id="00000000-0000-4000-8000-00000000000${n}">`
  + `<ac:parameter ac:name="">${n}</ac:parameter><ac:parameter ac:name="legacyAnchorId">id-회의록템플릿-${n}</ac:parameter></ac:structured-macro></p>`;
const row = (cells) => `<tr>${cells.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`;
const table = (rows) => `<table data-table-width="760" data-layout="default" ac:local-id="00000000-0000-4000-8000-0000000000aa">`
  + `<colgroup>${rows[0].map(() => '<col style="width: 152.0px;" />').join('')}</colgroup><tbody>${rows.map(row).join('')}</tbody></table>`;
const blank = '<p><br /></p>';

export const TEMPLATE_STORAGE = [
  table([
    ['필드', '값'],
    ['일시', 'YYYY-MM-DD'],
    ['회의 종류', '정기 회의'],
    ['참석자', '&lt;이름&gt;, &lt;이름&gt;'],
    ['관련 명세 ID', '&lt;기능명세서 ID&gt;, &lt;기능명세서 ID&gt;'],
  ]),
  blank, anchor(0), '<h2>안건</h2>', blank, '<ol start="1"><li><p>&lt;안건&gt;</p></li></ol>',
  blank, anchor(1), '<h2>논의 내용</h2>', blank, anchor(2), '<h3>&lt;안건 제목&gt;</h3>', blank, '<p>&lt;논의한 내용&gt;</p>',
  blank, anchor(3), '<h2>결정 사항</h2>', blank, '<ul><li><p>&lt;결정 하나와 이유&gt;</p></li></ul>',
  blank, anchor(4), '<h2>액션 아이템</h2>', blank,
  table([
    ['담당 파트', '담당자', '할 일', '기한', 'Jira 이슈'],
    ['Backend', '&lt;이름&gt;', '&lt;할 일&gt;', 'YYYY-MM-DD', '&lt;이슈 링크&gt;'],
  ]),
  blank, anchor(5), '<h2>다음 회의</h2>', blank, '<ul><li><p>일시: YYYY-MM-DD</p></li></ul>',
  blank, anchor(6), '<h3>안건</h3>', blank, '<ol start="1"><li><p>&lt;안건&gt;</p></li></ol>',
  blank, anchor(7), '<h2>기타</h2>', blank, '<ul><li><p>&lt;추가 기록, 원본 링크&gt;</p></li></ul>',
  '<ac:adf-extension><ac:adf-node type="extension"><ac:adf-attribute key="extension-type">com.atlassian.confluence.migration</ac:adf-attribute>'
    + '<ac:adf-attribute key="extension-key">__confluenceADFMigrationUnsupportedContentInternalExtension__</ac:adf-attribute></ac:adf-node></ac:adf-extension>',
].join('');

export const TEMPLATE = `| 필드 | 값 |
| --- | --- |
| 일시 | YYYY-MM-DD |
| 회의 종류 | 정기 회의 |
| 참석자 | <이름>, <이름> |
| 관련 명세 ID | <기능명세서 ID>, <기능명세서 ID> |

## 안건

1. <안건>

## 논의 내용

### <안건 제목>

<논의한 내용>

## 결정 사항

- <결정 하나와 이유>

## 액션 아이템

| 담당 파트 | 담당자 | 할 일 | 기한 | Jira 이슈 |
| --- | --- | --- | --- | --- |
| Backend | <이름> | <할 일> | YYYY-MM-DD | <이슈 링크> |

## 다음 회의

- 일시: YYYY-MM-DD

### 안건

1. <안건>

## 기타

- <추가 기록, 원본 링크>`;
