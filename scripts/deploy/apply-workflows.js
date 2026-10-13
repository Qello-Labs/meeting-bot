// 저장소의 n8n 워크플로 JSON을 서버 n8n에 반영한다(설계 4절 "배포", 결정 기록 2026-10-13-gh26-workflow-api-apply).
// n8n을 멈추지 않고 공개 API로 반영한다: 자격 증명 이름·종류를 조회해 노드에 연결 → PUT → activate → 확인.
// 확인에 실패하면 반영 전에 읽어 둔 정의로 되돌리고 실패로 끝낸다. 승인을 기다리던 실행은 실행에 저장된 옛 정의로 끝난다(n8n 2.42.6 실험).
//   N8N_DEPLOY_API_KEY=<키> node scripts/deploy/apply-workflows.js
// 서버에서는 녹음 봇 이미지로 compose 네트워크 안에서 부른다(N8N_API_URL 기본값 http://n8n:5678/api/v1).
// 키 범위: workflow:read, workflow:update, workflow:activate, credential:list, execution:list
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { FAILURE_WORKFLOW_FILE, WORKFLOW_FILE, credentialTypeOf } from '../build-workflow.js';
import { diffWorkflows } from '../diff-workflow.js';

// 실패 알림을 먼저 반영한다. 회의 녹취 설정(errorWorkflow)이 실패 알림 워크플로를 가리킨다.
export const WORKFLOW_FILES = [FAILURE_WORKFLOW_FILE, WORKFLOW_FILE];

const canonical = (value) =>
  JSON.stringify(value ?? {}, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

/** n8n 공개 API를 부르는 작은 도우미. 응답 본문은 오류 메시지에 넣지 않는다(실행 데이터가 섞일 수 있다). */
export function n8nApi({ apiUrl, apiKey, fetchImpl = fetch }) {
  const call = async (method, path, body) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: { 'X-N8N-API-KEY': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`n8n API ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
    return response.json();
  };
  /** nextCursor를 따라 목록을 모두 읽는다. */
  const list = async (path) => {
    const items = [];
    let cursor = null;
    do {
      const separator = path.includes('?') ? '&' : '?';
      const page = await call('GET', `${path}${separator}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return items;
  };
  return { call, list };
}

/** 자격 증명이 필요한 노드마다 같은 종류의 자격 증명을 하나 붙인다. 없거나 둘 이상이면 모호하므로 실패한다. */
export function attachCredentials(workflow, credentials) {
  const byType = new Map();
  for (const c of credentials) byType.set(c.type, [...(byType.get(c.type) ?? []), c]);
  const nodes = workflow.nodes.map((node) => {
    const type = credentialTypeOf(node);
    if (!type) return node;
    const found = byType.get(type) ?? [];
    if (found.length !== 1) throw new Error(`${workflow.name}의 ${node.name}: ${type} 자격 증명이 ${found.length}개입니다(1개여야 함)`);
    return { ...node, credentials: { [type]: { id: found[0].id, name: found[0].name } } };
  });
  return { ...workflow, nodes };
}

const credentialIds = (workflow) =>
  canonical(Object.fromEntries(workflow.nodes.filter((n) => n.credentials).map((n) => [n.name, Object.values(n.credentials).map((c) => c.id)])));

/** 동작에 영향을 주는 값(노드, 연결, 갈래 순서, 워크플로 설정, 자격 증명 연결)이 같으면 반영하지 않는다. */
export function sameWorkflow(desired, current) {
  return diffWorkflows(desired, current).length === 0
    && canonical(desired.settings) === canonical(pickSettings(current.settings, desired.settings))
    && credentialIds(desired) === credentialIds(current);
}

const pickSettings = (settings = {}, reference = {}) => Object.fromEntries(Object.keys(reference).map((k) => [k, settings[k]]));

// PUT 본문. static data(회의 녹취의 지난 회의 끝 시각)는 지금 값을 그대로 보낸다.
const putBody = (workflow, staticData) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings,
  ...(staticData === undefined ? {} : { staticData }),
});

/** 반영 뒤 상태 확인: 켜져 있고, 지금 버전이 게시 버전이며, 자격 증명 연결이 원하는 대로다. */
function verify(desired, after) {
  const problems = [];
  if (after.active !== true) problems.push('켜져 있지 않음');
  if (after.activeVersionId !== undefined && after.versionId !== undefined && after.activeVersionId !== after.versionId) {
    problems.push('게시 버전이 최신이 아님');
  }
  if (credentialIds(desired) !== credentialIds(after)) problems.push('자격 증명 연결이 다름');
  if (diffWorkflows(desired, after).length > 0) problems.push('노드나 연결이 다름');
  return problems;
}

/**
 * 워크플로들을 차례로 반영하고 결과 줄을 돌려준다. 하나라도 실패하면 그 워크플로를 되돌린 뒤 오류를 던진다.
 * 앞서 반영한 워크플로는 되돌리지 않는다(실패 알림을 먼저 반영하므로, 회의 녹취가 실패하면 회의 녹취만 옛 정의로 남는다).
 */
export async function applyWorkflows({ api, workflows }) {
  const credentials = await api.list('/credentials');
  const lines = [];
  for (const repoWorkflow of workflows) {
    const desired = attachCredentials(repoWorkflow, credentials);
    const current = await api.call('GET', `/workflows/${desired.id}`);
    const waiting = (await api.list(`/executions?status=waiting&workflowId=${encodeURIComponent(desired.id)}`)).length;
    const note = waiting > 0 ? ` (승인 대기 실행 ${waiting}개는 옛 정의로 끝남)` : '';
    if (current.active === true && sameWorkflow(desired, current)) {
      lines.push(`${desired.name}: 변경 없음${note}`);
      continue;
    }
    try {
      await api.call('PUT', `/workflows/${desired.id}`, putBody(desired, current.staticData));
      // PUT만 하면 Webhook이 옛 정의로 돈다. activate해야 새 정의가 등록된다(n8n 2.42.6 실험).
      await api.call('POST', `/workflows/${desired.id}/activate`);
      const problems = verify(desired, await api.call('GET', `/workflows/${desired.id}`));
      if (problems.length > 0) throw new Error(`반영 뒤 확인 실패: ${problems.join(', ')}`);
    } catch (error) {
      try {
        await api.call('PUT', `/workflows/${desired.id}`, putBody(current, current.staticData));
        if (current.active === true) await api.call('POST', `/workflows/${desired.id}/activate`);
      } catch (restoreError) {
        throw new Error(`${desired.name}: ${error.message}. 되돌리기도 실패했습니다(${restoreError.message}). n8n 화면에서 확인해야 합니다`);
      }
      throw new Error(`${desired.name}: ${error.message}. 반영 전 정의로 되돌렸습니다`);
    }
    lines.push(`${desired.name}: 반영${note}`);
  }
  return lines;
}

export const readWorkflows = (files = WORKFLOW_FILES) => Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apiKey = process.env.N8N_DEPLOY_API_KEY;
  if (!apiKey) {
    console.error('N8N_DEPLOY_API_KEY가 없습니다');
    process.exit(2);
  }
  const api = n8nApi({ apiUrl: process.env.N8N_API_URL ?? 'http://n8n:5678/api/v1', apiKey });
  try {
    for (const line of await applyWorkflows({ api, workflows: await readWorkflows() })) console.log(line);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
