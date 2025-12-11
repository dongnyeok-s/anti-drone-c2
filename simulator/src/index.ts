/**
 * 대드론 C2 시뮬레이터 서버
 * 진입점
 */

import { SimulatorWebSocketServer } from './websocket/server';
import { getConfig } from './config';

const config = getConfig();
const PORT = config.port;

console.log('========================================');
console.log('  대드론 C2 시뮬레이터 서버');
console.log('  Counter-Drone C2 Simulator Server');
console.log('========================================');

const server = new SimulatorWebSocketServer(PORT);

// 종료 시그널 처리
process.on('SIGINT', () => {
  console.log('\n[Simulator] 종료 중...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});

console.log('[Simulator] 서버 준비 완료');
console.log(`[Simulator] C2 UI에서 ${config.wsUrl} 으로 연결하세요`);

