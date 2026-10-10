import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import * as prism from 'prism-media';

// 말이 끊기고 이만큼 조용하면 발화 하나가 끝난 것으로 본다.
const SILENCE_MS = 1_000;
// 종료할 때 진행 중인 발화 파일이 다 써질 때까지 기다리는 최대 시간
const FLUSH_TIMEOUT_MS = 5_000;

function meetingIdOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * 회의 하나의 녹음. 화자가 말을 시작할 때마다 발화 단위 .ogg 파일을 하나씩 만든다.
 */
export class MeetingRecorder {
  constructor({ guild, voiceChannel, textChannel, recordingsDir }) {
    this.guild = guild;
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.startedAt = new Date();
    this.meetingId = meetingIdOf(this.startedAt);
    this.dir = path.join(recordingsDir, this.meetingId);
    this.segmentsDir = path.join(this.dir, 'segments');
    this.segments = [];
    this.participants = new Map();
    this.pending = new Set();
    this.stopping = false;
    this.connection = null;
  }

  elapsedMs() {
    return Date.now() - this.startedAt.getTime();
  }

  async start() {
    await mkdir(this.segmentsDir, { recursive: true });

    this.connection = joinVoiceChannel({
      guildId: this.guild.id,
      channelId: this.voiceChannel.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    // 녹음이 안 될 때 암호화(DAVE) 문제인지 가릴 수 있게 프로토콜 버전을 남긴다. 0이면 암호화 세션이 없다.
    // 참석자가 바뀌면 세션이 전환되므로 그때마다 다시 남긴다. 통화마다 바뀌는 음성 개인정보 보호 코드는 남기지 않는다.
    const logDave = () => {
      const dave = this.connection.state.networking?.state?.dave;
      console.log(`DAVE 프로토콜 v${dave?.protocolVersion ?? 0}`);
    };
    logDave();
    this.connection.on('transitioned', logDave);
    this.connection.receiver.speaking.on('start', (userId) => this.onSpeakingStart(userId));
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
  }

  /**
   * 진행 중인 발화를 정상 종료하고 파일이 다 써진 뒤에 음성 연결을 끊는다.
   * 연결부터 끊으면 라이브러리가 스트림을 강제로 닫아 마지막 조각이 잘릴 수 있다.
   */
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    const endedAt = new Date();

    const receiver = this.connection?.receiver;
    if (receiver) {
      for (const stream of receiver.subscriptions.values()) {
        if (!stream.readableEnded && !stream.destroyed) stream.push(null);
      }
    }

    const timeout = new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS));
    await Promise.race([Promise.allSettled([...this.pending]), timeout]);

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
      voiceChannel: { id: this.voiceChannel.id, name: this.voiceChannel.name },
      textChannelId: this.textChannel.id,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      participants: [...this.participants.values()]
        .filter((p) => !p.bot)
        .map(({ userId, displayName }) => ({ userId, displayName })),
      segments,
    };
  }
}
