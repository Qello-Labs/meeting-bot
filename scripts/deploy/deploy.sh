#!/bin/bash
# 서버 배포 절차(설계 4절 "배포"). ssh-entry.sh가 태그를 검증하고 잠근 뒤 이 스크립트를 그 태그 내용으로 실행한다.
#   인자: vX.Y.Z   작업 폴더: $MEETING_BOT_DIR(기본 /opt/meeting-bot)
# 1. 회의 중(녹음 폴더에 state.json)이면 아무것도 바꾸지 않고 75로 끝낸다. 회의가 끝난 뒤 다시 실행한다.
# 2. 태그를 체크아웃하고 .env의 RECORDER_TAG를 바꾼 뒤, GHCR 이미지로 녹음 봇만 교체하고 "준비 완료" 로그를 기다린다.
# 3. n8n 워크플로를 공개 API로 반영한다(scripts/deploy/apply-workflows.js). n8n 컨테이너는 다시 만들지 않는다.
# 4. 2~3이 실패하면 이전 태그로 같은 절차를 다시 해 되돌린다. 되돌렸으면 1, 되돌리기도 실패하면 2로 끝낸다.
# .env의 다른 값과 n8n 자격 증명은 읽기만 하고 출력하지 않는다.
set -euo pipefail

tag=$1
cd "${MEETING_BOT_DIR:-/opt/meeting-bot}"
log() { echo "[deploy] $*"; }
wait_step=${DEPLOY_WAIT_SECONDS:-2}

env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

if [ -z "$(env_value N8N_DEPLOY_API_KEY)" ]; then
  log ".env에 N8N_DEPLOY_API_KEY가 없어 배포하지 않습니다"
  exit 1
fi

# 녹음 봇이 꺼져 있으면 진행 중인 회의도 없다고 본다.
meetings=$(docker compose exec -T recorder sh -c 'ls /recordings/*/state.json 2>/dev/null | wc -l' 2>/dev/null || true)
meetings=${meetings//[^0-9]/}
if [ "${meetings:-0}" -gt 0 ]; then
  log "회의 중(진행 중인 녹음 ${meetings}개)이라 배포를 미룹니다. 회의가 끝난 뒤 다시 실행하세요"
  exit 75
fi

previous=$(env_value RECORDER_TAG)

set_recorder_tag() {
  local tmp
  tmp=$(mktemp .env.XXXXXX)
  grep -v '^RECORDER_TAG=' .env > "$tmp" || true
  echo "RECORDER_TAG=$1" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

wait_recorder() {
  local since=$1
  for _ in $(seq 1 30); do
    if [ -n "$(docker compose ps --status running -q recorder)" ] \
      && docker compose logs --since "$since" recorder 2>/dev/null | grep -q '준비 완료'; then
      return 0
    fi
    sleep "$wait_step"
  done
  return 1
}

# if 조건 안에서 부르면 set -e가 함수 안에서 동작하지 않으므로 단계마다 실패를 직접 확인한다.
deploy_to() {
  local target=$1 since
  git checkout --quiet --detach "refs/tags/$target" || { log "$target: 체크아웃 실패"; return 1; }
  set_recorder_tag "$target" || { log "$target: .env 갱신 실패"; return 1; }
  docker compose pull --quiet recorder || { log "$target: 녹음 봇 이미지를 받지 못했습니다"; return 1; }
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  docker compose up -d --no-build recorder || { log "$target: 녹음 봇 교체 실패"; return 1; }
  wait_recorder "$since" || { log "$target: 녹음 봇이 준비 완료되지 않았습니다"; return 1; }
  log "$target: 녹음 봇 교체"
  N8N_DEPLOY_API_KEY=$(env_value N8N_DEPLOY_API_KEY) docker compose run --rm --no-deps -T \
    -e N8N_DEPLOY_API_KEY -v "$PWD/workflows:/app/workflows:ro" \
    recorder node scripts/deploy/apply-workflows.js || { log "$target: 워크플로 반영 실패"; return 1; }
}

log "$tag 배포 시작(지금 ${previous:-없음})"
if deploy_to "$tag"; then
  log "$tag 배포 완료"
  exit 0
fi

if [ -z "$previous" ] || [ "$previous" = "$tag" ]; then
  log "$tag 배포 실패. 되돌릴 이전 태그가 없습니다"
  exit 2
fi
log "$tag 배포 실패. ${previous}로 되돌립니다"
if deploy_to "$previous"; then
  log "${previous}로 되돌렸습니다"
  exit 1
fi
log "${previous}로 되돌리기도 실패했습니다. 서버에서 확인해야 합니다"
exit 2
