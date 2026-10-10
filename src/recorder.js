import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import * as prism from 'prism-media';
import { recoverSegments, writeState } from './state.js';

// 말이 끊기고 이만큼 조용하면 발화 하나가 끝난 것으로 본다.
const SILENCE_MS = 1_000;
// 종료할 때 진행 중인 발화 파일이 다 써질 때까지 기다리는 최대 시간
const FLUSH_TIMEOUT_MS = 5_000;
// Discord의 "Unknown Channel" 오류 코드. 음성 채널이 삭제됐다는 뜻이다.
const UNKNOWN_CHANNEL = 10003;

const DEFAULT_TIMING = {
  // 다른 채널로 옮겨졌거나 라이브러리가 스스로 다시 붙는 경우를 이만큼 기다린 뒤 직접 재접속한다.
  graceMs: 5_000,
  // rejoin() 한 번에 연결이 준비되기를 기다리는 시간
  readyTimeoutMs: 15_000,
  // 재접속 간격은 5초부터 두 배씩 늘려 30초에서 멈춘다. 종료 명령을 받을 때까지 계속한다.
  retryBaseMs: 5_000,
  retryMaxMs: 30_000,
  // 재시작했을 때 끊긴 구간의 시작을 알 수 있도록 상태 파일의 마지막 기록 시각을 갱신하는 간격
  heartbeatMs: 15_000,
};

function meetingIdOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function seconds(ms) {
  return Math.round(ms / 1000);
}

/**
 * 회의 하나의 녹음. 화자가 말을 시작할 때마다 발화 단위 .ogg 파일을 하나씩 만든다.
 * 회의는 stop()으로만 끝난다. 음성 연결이 끊기면 같은 회의로 다시 들어가고, 상태를 녹음 폴더에 남겨
 * 봇이 재시작돼도 이어 갈 수 있게 한다.
 *
 * 이벤트
 * - notice(text): 회의 채널에 알릴 문장
 * - channelDeleted(): 음성 채널이 삭제돼 더는 이어 갈 수 없음. 받는 쪽이 stop()으로 마무리한다.
 */
export class MeetingRecorder extends EventEmitter {
  constructor({ guild, voiceChannel, textChannel, recordingsDir, state, join = joinVoiceChannel, timing = {} }) {
    super();
    this.guild = guild;
    this.voiceChannel = { id: voiceChannel.id, name: voiceChannel.name };
    this.textChannel = textChannel;
    this.join = join;
    this.timing = { ...DEFAULT_TIMING, ...timing };

    this.startedAt = state ? new Date(state.startedAt) : new Date();
    this.meetingId = state?.meetingId ?? meetingIdOf(this.startedAt);
    this.dir = path.join(recordingsDir, this.meetingId);
    this.segmentsDir = path.join(this.dir, 'segments');
    this.segments = state?.segments ?? [];
    this.participants = new Map((state?.participants ?? []).map((p) => [p.userId, p]));
    this.gaps = state?.gaps ?? [];
    // 재시작해서 이어 가는 회의면 마지막으로 살아 있던 시각부터 끊긴 것으로 본다.
    this.openGap = state ? { startMs: state.aliveMs, reason: '봇 재시작' } : null;
    this.textChannelId = state?.textChannelId ?? textChannel?.id;

    this.pending = new Set();
    this.stopping = false;
    this.recovering = false;
    this.announcedDisconnect = false;
    this.connection = null;
    this.heartbeat = null;
    this.saving = Promise.resolve();
  }

  /** 상태 파일로 끝나지 않은 회의를 다시 만든다. 재시작 순간 쓰던 발화 파일도 살린다. */
  static async resume({ state, ...options }) {
    const recorder = new MeetingRecorder({ ...options, state });
    const recovered = await recoverSegments(recorder.segmentsDir, recorder.segments);
    recorder.segments.push(...recovered);
    recorder.recoveredCount = recovered.length;
    return recorder;
  }

  elapsedMs() {
    return Date.now() - this.startedAt.getTime();
  }

  toState() {
    return {
      meetingId: this.meetingId,
      guildId: this.guild.id,
      voiceChannel: this.voiceChannel,
      textChannelId: this.textChannelId,
      startedAt: this.startedAt.toISOString(),
      aliveMs: this.elapsedMs(),
      participants: [...this.participants.values()],
      segments: this.segments,
      gaps: this.gaps,
    };
  }

  /** 상태 파일 쓰기는 순서대로 한다. 실패해도 녹음은 계속한다. */
  saveState() {
    if (this.stopping) return this.saving;
    this.saving = this.saving
      .then(() => writeState(this.dir, this.toState()))
      .catch((error) => console.warn(`회의 상태 저장 실패: ${error.message}`));
    return this.saving;
  }

  async start() {
    await mkdir(this.segmentsDir, { recursive: true });

    this.connection = this.join({
      guildId: this.guild.id,
      channelId: this.voiceChannel.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.closeOpenGap();
    // 녹음이 안 될 때 암호화(DAVE) 문제인지 가릴 수 있게 프로토콜 버전을 남긴다. 0이면 암호화 세션이 없다.
    // 참석자가 바뀌면 세션이 전환되므로 그때마다 다시 남긴다. 통화마다 바뀌는 음성 개인정보 보호 코드는 남기지 않는다.
    const logDave = () => {
      const dave = this.connection.state.networking?.state?.dave;
      console.log(`DAVE 프로토콜 v${dave?.protocolVersion ?? 0}`);
    };
    logDave();
    this.connection.on('transitioned', logDave);
    this.connection.receiver.speaking.on('start', (userId) => this.onSpeakingStart(userId));
    this.connection.on('stateChange', (oldState, newState) => this.onStateChange(oldState, newState));

    this.heartbeat = setInterval(() => this.saveState(), this.timing.heartbeatMs);
    this.heartbeat.unref?.();
    await this.saveState();
  }

  closeOpenGap() {
    if (!this.openGap) return null;
    const gap = { ...this.openGap, endMs: this.elapsedMs() };
    this.gaps.push(gap);
    this.openGap = null;
    return gap;
  }

  onStateChange(oldState, newState) {
    if (this.stopping) return;
    const wasReady = oldState.status === VoiceConnectionStatus.Ready;
    const isReady = newState.status === VoiceConnectionStatus.Ready;

    // 연결이 준비 상태를 벗어난 순간부터 다시 준비될 때까지가 끊긴 구간이다.
    if (wasReady && !isReady && !this.openGap) this.openGap = { startMs: this.elapsedMs(), reason: '음성 연결 끊김' };
    if (!wasReady && isReady) this.onReconnected();
    if (newState.status === VoiceConnectionStatus.Disconnected) this.recover();
  }

  onReconnected() {
    const gap = this.closeOpenGap();
    // 누가 봇을 다른 채널로 옮겼으면 그 채널에서 이어 간다.
    const channelId = this.connection.joinConfig.channelId;
    if (channelId && channelId !== this.voiceChannel.id) {
      const channel = this.guild.channels.cache.get(channelId);
      this.voiceChannel = { id: channelId, name: channel?.name ?? channelId };
      this.emit('notice', `봇이 **${this.voiceChannel.name}** 채널로 옮겨져 그 채널에서 같은 회의로 이어서 녹음합니다.`);
    }
    if (this.announcedDisconnect && gap) {
      this.emit('notice', `음성 채널에 다시 연결해 같은 회의로 이어서 녹음합니다. (끊긴 시간 약 ${seconds(gap.endMs - gap.startMs)}초)`);
    }
    this.announcedDisconnect = false;
    this.saveState();
  }

  async waitReady(ms) {
    if (this.connection.state.status === VoiceConnectionStatus.Ready) return true;
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, ms);
      return true;
    } catch {
      return false;
    }
  }

  async channelExists() {
    try {
      return Boolean(await this.guild.channels.fetch(this.connection.joinConfig.channelId));
    } catch (error) {
      // 채널이 없다는 응답만 삭제로 본다. 네트워크 오류 같은 다른 실패는 다시 시도한다.
      return error?.code !== UNKNOWN_CHANNEL;
    }
  }

  /**
   * 라이브러리는 일시적인 끊김에는 스스로 다시 붙지만, 종료 코드 4014(사람이 연결을 끊음, 채널 삭제,
   * 봇의 Discord 연결 끊김)에는 다시 붙지 않는다. 그때 같은 연결 객체로 rejoin()해야 발화 수신 설정이 이어진다.
   */
  async recover() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      if (await this.waitReady(this.timing.graceMs)) return;
      if (this.stopping) return;
      this.announcedDisconnect = true;
      this.emit('notice', '음성 연결이 끊겼습니다. 다시 연결하는 중이며, 녹음은 같은 회의로 이어집니다. 그 사이의 말은 녹음되지 않습니다.');

      for (let attempt = 0; !this.stopping; attempt += 1) {
        if (!(await this.channelExists())) {
          this.emit('channelDeleted');
          return;
        }
        if (this.connection.rejoin() && (await this.waitReady(this.timing.readyTimeoutMs))) return;
        if (this.stopping) return;
        await sleep(Math.min(this.timing.retryBaseMs * 2 ** attempt, this.timing.retryMaxMs));
      }
    } finally {
      this.recovering = false;
    }
  }

  onSpeakingStart(userId) {
    if (this.stopping) return;
    const receiver = this.connection.receiver;
    if (receiver.subscriptions.has(userId)) return;

    // 이름 조회를 기다리면 발화 앞부분을 놓치므로 구독부터 한다.
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS },
    });
    const startMs = this.elapsedMs();
    const file = `${String(startMs).padStart(9, '0')}-${userId}.ogg`;
    const oggStream = new prism.opus.OggLogicalBitstream({
      opusHead: new prism.opus.OpusHead({ channelCount: 2, sampleRate: 48_000 }),
      pageSizeControl: { maxPackets: 10 },
    });
    const out = createWriteStream(path.join(this.segmentsDir, file));

    const task = pipeline(opusStream, oggStream, out)
      .catch((error) => console.warn(`발화 저장 중 오류 ${file}: ${error.message}`))
      .then(() => {
        // 무음으로 끝난 발화는 끝 시각에 무음 대기 시간이 들어 있어 빼 준다. stop()으로 끊긴 발화는 그대로 둔다.
        const endMs = this.stopping ? this.elapsedMs() : Math.max(startMs, this.elapsedMs() - SILENCE_MS);
        this.segments.push({ file, userId, startMs, endMs });
        this.saveState();
      })
      .finally(() => this.pending.delete(task));
    this.pending.add(task);

    this.rememberParticipant(userId);
  }

  async rememberParticipant(userId) {
    if (this.participants.has(userId)) return;
    this.participants.set(userId, { userId, displayName: userId, bot: false });
    try {
      const member = await this.guild.members.fetch(userId);
      this.participants.set(userId, { userId, displayName: member.displayName, bot: member.user.bot });
    } catch (error) {
      console.warn(`참석자 이름 조회 실패 ${userId}: ${error.message}`);
    }
    this.saveState();
  }

  /**
   * 진행 중인 발화를 정상 종료하고 파일이 다 써진 뒤에 음성 연결을 끊는다.
   * 연결부터 끊으면 라이브러리가 스트림을 강제로 닫아 마지막 조각이 잘릴 수 있다.
   */
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearInterval(this.heartbeat);
    const endedAt = new Date();

    const receiver = this.connection?.receiver;
    if (receiver) {
      for (const stream of receiver.subscriptions.values()) {
        if (!stream.readableEnded && !stream.destroyed) stream.push(null);
      }
    }

    const timeout = new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS));
    await Promise.race([Promise.allSettled([...this.pending]), timeout]);
    // 끊긴 채로 종료하면 종료 시각까지를 끊긴 구간으로 남긴다.
    this.closeOpenGap();
    await this.saving;

    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }

    // 봇의 발화는 회의록에 넣지 않는다.
    const bots = new Set([...this.participants.values()].filter((p) => p.bot).map((p) => p.userId));
    const segments = this.segments
      .filter((s) => !bots.has(s.userId))
      .sort((a, b) => a.startMs - b.startMs);

    return {
      meetingId: this.meetingId,
      dir: this.dir,
      guildId: this.guild.id,
      voiceChannel: this.voiceChannel,
      textChannelId: this.textChannelId,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      participants: [...this.participants.values()]
        .filter((p) => !p.bot)
        .map(({ userId, displayName }) => ({ userId, displayName })),
      segments,
      gaps: this.gaps,
    };
  }
}
