---
name: mb-commit
description: meeting-bot 저장소의 현재 변경을 검토 목적 단위로 나눈 커밋 계획 초안을 보여주고, 승인 후 저장소 커밋 규칙(<type>(<scope>): <summary>, GitHub Issue가 있으면 끝에 (#번호))에 맞춰 순서대로 커밋한다. "커밋해줘", "커밋 나눠줘", "변경사항 정리해서 커밋" 요청에 사용한다.
---

# Commit Split

작업 변경을 **하나의 검토 목적 = 하나의 커밋**으로 나눈다(`AGENTS.md` 5절).
분할 초안을 먼저 보여주고 승인을 받은 뒤에만 커밋한다.

참조: `references/splitting-rules.md` — 분할 기준, 순서, 타입·scope 선정

## 0. 컨텍스트 수집

```bash
git branch --show-current
git status --short
git diff --stat
git diff --cached --stat
git log --oneline -10
```

- `main`이면 중단하고 작업 브랜치를 먼저 만들도록 안내한다.
- 브랜치 이름에 `gh-<번호>`가 있으면 그 번호를 커밋 끝에 붙인다. 없으면 붙이지 않는다. 번호를 추측하지 않는다.
- `TASK.md`의 Scope와 Ownership을 읽어 범위 밖 파일이 섞였는지 확인한다.
- 이미 staged된 변경은 그대로 커밋하지 말고 분할 계획에 포함한다. 계획을 확정하기 전에는
  `git reset`으로 staging을 풀지 않는다. 사용자가 의도적으로 staging했을 수 있으므로
  계획에 반영한 뒤 승인 단계에서 알린다.

## 1. 변경 내용 파악

`git diff`와 `git diff --cached`의 **전체 본문**을 읽는다. `--stat`만 보고 목적을 추측하지 않는다.

`git status`의 `??` 새 파일은 직접 읽는다. 단 `.env`, `recordings/`, 오디오 파일(`.ogg`, `.webm`, `.wav` 등)은
읽지 않고 계획에서 뺀 뒤 사용자에게 알린다. `node_modules/`, 로그, 스크래치 파일도 뺀다.
`.gitignore` 수정은 별도로 제안한다.

## 2. 커밋 분할

- **반드시 나눈다.** 변경이 두 가지 이상의 목적을 담으면 목적 수만큼 커밋을 만든다.
- 목적이 하나뿐이면 한 커밋으로 두되, 나누지 않은 근거를 함께 보고한다.
- 각 커밋은 그 자체로 실행과 테스트가 깨지지 않는 순서로 놓는다.
- 파일 단위로 나눈다. 한 파일에 목적이 섞여 있으면 hunk를 임의로 쪼개지 않고, 그 사실을 보고한 뒤
  (a) 한 커밋으로 합치거나 (b) 사용자가 `! git add -p <파일>`로 직접 나누도록 선택하게 한다.

분할 기준과 순서는 `references/splitting-rules.md`를 따른다.

## 3. 커밋 메시지

```text
<type>(<scope>): <summary>
<type>(<scope>): <summary> (#<ISSUE-NUMBER>)   브랜치에 gh-<번호>가 있을 때
```

- `type`은 Conventional Commits 타입이다. 브랜치 prefix가 있으면 맞춘다.
- `scope`는 선택이다. 소문자, 숫자, 하이픈만 쓴다.
- `summary`는 마침표 없는 한 줄이다. 브랜치의 기존 커밋 언어를 따른다.
- 본문(body)은 제목만으로 이유가 부족할 때만 쓴다.

## 4. 초안 제시

커밋하기 전에 전체 계획을 보여주고 승인을 받는다.

```text
브랜치: feat/gh-12-send-manifest   (type=feat, issue=#12)

1. feat(recorder): send manifest to n8n webhook on meeting end (#12)
   - src/finalize.js
   이유: 녹음 마무리 동작 — 워크플로 변경 없이 단독 검토 가능

2. feat(workflow): validate decision evidence before ClickUp write (#12)
   - workflows/meeting-notes.json
   이유: 1이 보낸 manifest를 받는 n8n 쪽 처리

3. test(recorder): cover webhook failure in offline test (#12)
   ...
```

각 커밋에 포함 파일과 분할 이유를 적는다. 사용자가 순서, 묶음, 문구를 고치면 반영한 계획을 다시
보여주고 재승인을 받는다.

## 5. 순차 커밋

승인 후 커밋마다 다음을 반복한다.

```bash
git add -- <파일1> <파일2>
git status --short                    # 의도한 파일만 staged 되었는지 확인
python3 scripts/preflight.py --staged # 값은 출력하지 않고 파일·줄·규칙만 표시
git commit -m "<완성된 메시지>"
```

- `git add .`나 `git add -A`를 쓰지 않는다. 경로를 명시한다.
- preflight나 Hook이 실패하면 **즉시 멈춘다.** `--no-verify`를 쓰지 않는다. 실패 원인과 남은 커밋 목록을
  보고하고 지시를 받는다.
- 커밋을 되돌리거나 `git commit --amend`로 다른 사람의 커밋을 고치지 않는다.

## 6. 완료 보고

```bash
git log --oneline -<커밋수>
git status --short
```

만든 커밋 목록, 남은 미커밋 변경, 실행하지 못한 검증을 보고한다.
push와 PR 생성은 이 Skill의 범위가 아니다. `/mb-pr`을 제안만 한다.

## 금지

- 승인 없이 커밋하지 않는다.
- `--no-verify`, `--amend`, `git reset --hard`, force push를 쓰지 않는다.
- 여러 목적을 한 커밋에 몰아넣지 않는다.
- 커밋 메시지에 `.env` 값, 토큰, 서버 주소, Webhook 경로, 녹취 원문을 쓰지 않는다.
- 사용자나 다른 에이전트의 미커밋 변경을 임의로 stash하거나 폐기하지 않는다.
