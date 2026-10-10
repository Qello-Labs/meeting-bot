---
name: mb-pr
description: meeting-bot 저장소에서 로컬 검증을 실행하고 PR 옵션을 질문으로 정한 뒤, PR 작성 규칙에 따라 본문을 처음부터 쓴 초안을 보여주고 승인 후 push와 PR 생성까지 수행한다. 열린 PR에 push한 뒤 본문을 지금 커밋에 맞게 고칠 때도 쓴다. "PR 올려줘", "PR 만들어줘", "풀리퀘 생성", "PR 본문 고쳐줘" 요청에 사용한다.
---

# Pull Request

브랜치 작업을 최신화 → 검증 → 초안 → push → PR 생성 순으로 마무리한다.
`AGENTS.md` 5절(커밋과 PR)과 7절(완료 전 검증)의 실행 절차다.

참조: `references/writing-style.md` — PR 제목·본문 작성 규칙, 금지 표현, 제출 전 점검

## 0. 컨텍스트 수집

```bash
git branch --show-current
git status --short
git fetch origin main
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
gh pr status
```

- `main`에서는 PR을 만들지 않는다.
- 이미 열린 PR이 있으면 새로 만들지 않는다. 0.5~1단계를 거쳐 push한 뒤 4.5단계로 본문을 고친다.
- 미커밋 변경이 있으면 알리고 `/mb-commit`으로 먼저 커밋할지 묻는다. 임의로 커밋하지 않는다.
- 커밋이 하나도 없으면 중단한다.
- `TASK.md`에서 Issue 번호, 완료 조건, 데이터·비용 영향을 읽는다. 비어 있으면 추측하지 않고 사용자에게 묻는다.
- 브랜치에 `gh-<번호>`가 있으면 `gh issue view <번호> --json title,body,url`로 Issue를 함께 읽는다.

## 0.5 최신화

```bash
git rebase origin/main
```

- 충돌이 나면 **여기서 멈춘다.** 충돌 파일 목록을 보고하고 사용자에게 해결을 요청한다.
  사용자 지시 없이 충돌을 해결하거나 `git rebase --continue`를 대신 실행하지 않는다.
- 판단이 서지 않으면 `git rebase --abort`를 제안한다.

## 1. 로컬 검증

PR을 만들기 전에 반드시 실행한다.

```bash
python3 scripts/preflight.py
git diff --check origin/main...HEAD
```

`package.json`에 테스트 명령이 있거나 `scripts/offline-test.js`가 있으면 함께 실행한다.
녹음 범위나 외부 전송 범위가 바뀌었으면 결정 기록(`templates/decision-record.md`)이 있는지 확인한다.

하나라도 실패하면 **PR을 만들지 않고 멈춘다.** 실패 로그를 보고하고 지시를 받는다. 사용자가 검증을 건너뛰기로
결정하면 그 사실, 대신 돌린 검증과 결과, 남은 위험을 PR 본문에 적는다. 실행하지 않은 검증을 통과로 쓰지 않는다.

## 2. 옵션 질문

`AskUserQuestion`으로 한 번에 묻는다.

1. **PR 상태** — Ready for review(기본) / Draft
2. **리뷰어** — 저장소 협업자 중 선택 / 지정 안 함. 리뷰어를 저장소에 고정하지 않는다.

## 3. 초안 제시

생성 전에 제목과 본문 전체를 보여주고 승인을 받는다.

`references/writing-style.md`를 먼저 읽고 본문을 처음부터 쓴다. 이전 PR 본문이나 미리 써 둔 초안에 값만 채우지 않는다.
`.github/PULL_REQUEST_TEMPLATE.md`는 담을 내용의 목록이며, 칸 이름과 안내 주석은 본문에 남기지 않는다.

- 제목은 `<type>: <한국어 요약>`이다. `type`은 브랜치 접두사와 같게 쓰고 scope는 쓰지 않는다.
  이 저장소에는 제목 형식 검사기가 없어 리뷰에서 확인한다.
- Issue 번호(`Closes #<번호>`)를 본문 첫 줄에 넣는다. Issue가 없으면 그 이유를 쓴다.
- 결정 근거, 대안 비교, 커밋별 설명은 본문에 옮기지 않는다. `TASK.md`나 결정 기록에 없으면 그쪽에 먼저 적고
  본문에는 결론과 링크만 둔다.
- 완료 조건 표는 `확인한 것 | 결과` 두 칸이다. `TASK.md` 완료 조건과 1단계 검증 명령을 이 표에 함께 넣어
  같은 내용을 두 번 쓰지 않는다. 증빙은 결과 칸에 링크로 붙인다.
- 저장소 파일 링크는 지금 HEAD 커밋에 고정한 주소로 건다.
- 리뷰 확인 체크박스는 **실제로 한 것만** 체크한다.

초안 파일은 저장소 밖 임시 폴더에 쓴다. 사용자에게 보여주기 전에 글자 수를 재고
(`python3 -c "import sys; print(len(open(sys.argv[1], encoding='utf-8').read()))" <초안파일>`),
`references/writing-style.md` 6절 점검을 통과시킨다. 하나라도 걸리면 고친 뒤에 보여준다.

## 4. push와 생성

```bash
git push -u origin <브랜치>
```

0.5 단계에서 이미 push된 브랜치를 rebase했다면 non-fast-forward 거부가 정상이다. 그 경우에만 다음을 쓴다.

```bash
git push --force-with-lease -u origin <브랜치>
```

`main`이나 다른 사람과 공유하는 브랜치에는 쓰지 않는다. 그 밖의 이유로 push가 거부되면 원인을 확인하고 보고한다.

```bash
gh pr create --base main --title "<제목>" --body-file <초안파일>
# Draft이면 --draft, 리뷰어를 정했으면 --reviewer <id>
```

초안 파일은 저장소에 남기지 않는다.

## 4.5 열린 PR 본문 갱신

열린 PR에 push했으면(특히 rebase 뒤) 본문이 지금 커밋과 맞는지 확인한다.

```bash
gh pr view <번호> --json title,body,headRefOid
```

- 검증 결과가 지금 커밋에서 다시 실행한 결과와 같은지, 고정 주소 링크가 지금 HEAD를 가리키는지,
  새 커밋의 변경이 본문에서 빠지지 않았는지 본다. 제목이 브랜치 전체 작업을 더는 요약하지 못하면 제목도 고친다.
- 고칠 곳이 있으면 3단계 규칙대로 다시 쓴 제목·본문 전체를 보여주고 승인을 받은 뒤 바꾼다.

```bash
gh pr edit <번호> --title "<제목>" --body-file <초안파일>
```

## 5. 완료 보고

PR URL, 제목, Draft 여부, 리뷰어, 실행한 검증과 결과, CI(`Harness` 워크플로) 상태를 보고한다.
실행하지 못한 검증은 이유와 남은 위험을 함께 적는다. 리뷰가 필요하면 `/mb-review`를 제안한다.
머지와 Issue 닫기는 사람이 한다.

## 금지

- 승인 없이 push하거나 PR을 만들거나 PR 제목·본문을 바꾸지 않는다.
- 검증 실패를 숨기거나 실행하지 않은 검증을 통과로 쓰지 않는다.
- 일반 force push, `main` 직접 push, PR 자동 머지를 하지 않는다.
- PR 본문에 `.env` 값, 토큰, 서버 주소, Webhook 경로, 녹취 원문, 참석자 ID를 쓰지 않는다.
- PR 본문에 작성 도구 이름이나 서명 줄(Generated with ...)을 넣지 않는다.
