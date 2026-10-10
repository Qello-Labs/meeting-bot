import { SlashCommandBuilder } from 'discord.js';

export const meetingCommand = new SlashCommandBuilder()
  .setName('회의녹음')
  .setDescription('회의 음성을 화자별로 녹음합니다')
  .addSubcommand((sub) => sub.setName('시작').setDescription('지금 들어가 있는 음성 채널의 녹음을 시작합니다'))
  .addSubcommand((sub) => sub.setName('종료').setDescription('녹음을 끝내고 회의록 워크플로로 넘깁니다'));
