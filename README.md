# meeting-bot

Discord 회의를 말하는 사람별로 녹음하고, n8n 워크플로가 음성 인식과 회의록 초안 작성을 거쳐
승인된 회의록을 ClickUp에 올리는 봇이다.

| 문서 | 내용 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 사람과 AI 에이전트의 공통 작업 계약 |
| [CLAUDE.md](CLAUDE.md) | Claude Code 진입점, 프로젝트 Skill |
| [docs/harness/OVERVIEW.md](docs/harness/OVERVIEW.md) | 하네스 구성, 출처, 다음 단계 |
| [templates/](templates) | 작업 계약(`TASK.md`), 결정 기록 양식 |

## 작업 흐름

1. Meeting Bot 작업 폼으로 GitHub Issue를 만든다.
2. 최신 `main`에서 `<type>/gh-<번호>-<short-slug>` 브랜치를 만든다.
3. `templates/task-contract.md`를 복사해 `TASK.md`를 채운다.
4. 작업 후 `/mb-commit`으로 커밋하고 `/mb-pr`로 PR을 연다. 리뷰는 `/mb-review`와 사람이 한다.
5. 완료 조건과 증빙을 확인한 뒤 Issue를 닫는다.

커밋 전 검사:

```bash
python3 scripts/preflight.py --staged
```
