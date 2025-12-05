/**
 * 시뮬레이터 설정 관리
 * 환경 변수 기반 설정 로더 (Zod 검증 포함)
 */

import { loadAndValidateEnv, printEnvConfig, type Env } from './config/env';

export interface SimulatorConfig {
  port: number;
  wsUrl: string;
  logsDir: string;
  logConsoleOutput: boolean;
  logEnabled: boolean;
  scenariosDir: string;
  nodeEnv: string;
  // 보안 설정
  authEnabled: boolean;
  authToken?: string;
  corsEnabled: boolean;
  corsOrigin: string;
  rateLimitEnabled: boolean;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
}

/**
 * 환경 변수에서 설정 로드 (검증 포함)
 */
export function loadConfig(): SimulatorConfig {
  const env: Env = loadAndValidateEnv();

  // 개발 모드에서 설정 출력
  if (env.NODE_ENV === 'development') {
    printEnvConfig(env);
  }

  return {
    port: env.SIMULATOR_PORT,
    wsUrl: env.SIMULATOR_WS_URL,
    logsDir: env.LOGS_DIR,
    logConsoleOutput: env.LOG_CONSOLE_OUTPUT,
    logEnabled: env.LOG_ENABLED,
    scenariosDir: env.SCENARIOS_DIR,
    nodeEnv: env.NODE_ENV,
    authEnabled: env.AUTH_ENABLED,
    authToken: env.AUTH_TOKEN,
    corsEnabled: env.CORS_ENABLED,
    corsOrigin: env.CORS_ORIGIN,
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  };
}

/**
 * 기본 설정 인스턴스 (싱글톤)
 */
let configInstance: SimulatorConfig | null = null;

/**
 * 설정 싱글톤 가져오기
 */
export function getConfig(): SimulatorConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

