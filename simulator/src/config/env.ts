/**
 * 환경 변수 검증 및 로드
 * Zod 스키마 기반 타입 안전 환경 설정
 *
 * 2D-only 버전: AirSim 관련 설정 제거됨
 */

import { z } from 'zod';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// .env 파일 로드
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('[Config] .env 파일 로드됨:', envPath);
} else {
  console.warn('[Config] .env 파일 없음. 기본값 또는 시스템 환경 변수 사용');
}

/**
 * 환경 변수 스키마 정의
 */
const envSchema = z.object({
  // 서버 설정
  SIMULATOR_PORT: z
    .string()
    .default('8080')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0 && val < 65536, {
      message: 'SIMULATOR_PORT는 1-65535 사이여야 합니다',
    }),

  SIMULATOR_WS_URL: z
    .string()
    .default('ws://localhost:8080')
    .refine((val) => val.startsWith('ws://') || val.startsWith('wss://'), {
      message: 'SIMULATOR_WS_URL은 ws:// 또는 wss://로 시작해야 합니다',
    }),

  // 로깅 설정
  LOGS_DIR: z.string().default('./logs'),

  LOG_CONSOLE_OUTPUT: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),

  LOG_ENABLED: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() !== 'false'),

  // 시나리오 설정
  SCENARIOS_DIR: z.string().default('./scenarios/generated'),

  // 환경 설정
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // 보안 설정
  AUTH_ENABLED: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),

  AUTH_TOKEN: z.string().optional(),

  CORS_ENABLED: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),

  CORS_ORIGIN: z.string().default('*'),

  // Rate Limiting
  RATE_LIMIT_ENABLED: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),

  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .default('100')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0, {
      message: 'RATE_LIMIT_MAX_REQUESTS는 양수여야 합니다',
    }),

  RATE_LIMIT_WINDOW_MS: z
    .string()
    .default('60000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0, {
      message: 'RATE_LIMIT_WINDOW_MS는 양수여야 합니다',
    }),

  // 시뮬레이션 모드 설정 (2D-only: INTERNAL만 지원)
  SIM_MODE: z
    .literal('INTERNAL')
    .default('INTERNAL'),
});

/**
 * 환경 변수 타입
 */
export type Env = z.infer<typeof envSchema>;

/**
 * 환경 변수 검증 및 로드
 */
export function loadAndValidateEnv(): Env {
  try {
    const env = envSchema.parse(process.env);

    // 보안 설정 검증
    if (env.AUTH_ENABLED && !env.AUTH_TOKEN) {
      throw new Error(
        'AUTH_ENABLED가 true일 때 AUTH_TOKEN은 필수입니다'
      );
    }

    // 프로덕션 환경 검증
    if (env.NODE_ENV === 'production') {
      if (!env.AUTH_ENABLED) {
        console.warn(
          '[Config] 경고: 프로덕션 환경에서 인증이 비활성화되어 있습니다'
        );
      }
      if (env.CORS_ORIGIN === '*') {
        console.warn(
          '[Config] 경고: 프로덕션 환경에서 CORS_ORIGIN이 *로 설정되어 있습니다'
        );
      }
    }

    // 디렉토리 생성
    ensureDirectoryExists(env.LOGS_DIR);
    ensureDirectoryExists(env.SCENARIOS_DIR);

    console.log('[Config] 환경 변수 검증 성공');
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[Config] 환경 변수 검증 실패:');
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      throw new Error('환경 변수 설정이 올바르지 않습니다');
    }
    throw error;
  }
}

/**
 * 디렉토리 존재 확인 및 생성
 */
function ensureDirectoryExists(dirPath: string): void {
  const fullPath = path.resolve(process.cwd(), dirPath);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`[Config] 디렉토리 생성: ${fullPath}`);
  }
}

/**
 * 환경 변수 출력 (디버깅용, 민감한 정보 마스킹)
 */
export function printEnvConfig(env: Env): void {
  console.log('========================================');
  console.log('  환경 설정 (2D Simulation)');
  console.log('========================================');
  console.log(`환경: ${env.NODE_ENV}`);
  console.log(`포트: ${env.SIMULATOR_PORT}`);
  console.log(`WebSocket URL: ${env.SIMULATOR_WS_URL}`);
  console.log(`로그 디렉토리: ${env.LOGS_DIR}`);
  console.log(`로그 활성화: ${env.LOG_ENABLED}`);
  console.log(`콘솔 로그 출력: ${env.LOG_CONSOLE_OUTPUT}`);
  console.log(`시나리오 디렉토리: ${env.SCENARIOS_DIR}`);
  console.log(`시뮬레이션 모드: ${env.SIM_MODE}`);
  console.log('----------------------------------------');
  console.log(`인증 활성화: ${env.AUTH_ENABLED}`);
  if (env.AUTH_ENABLED) {
    console.log(`인증 토큰: ${maskToken(env.AUTH_TOKEN)}`);
  }
  console.log(`CORS 활성화: ${env.CORS_ENABLED}`);
  console.log(`CORS Origin: ${env.CORS_ORIGIN}`);
  console.log(`Rate Limiting: ${env.RATE_LIMIT_ENABLED}`);
  if (env.RATE_LIMIT_ENABLED) {
    console.log(
      `  - 최대 요청: ${env.RATE_LIMIT_MAX_REQUESTS}/${env.RATE_LIMIT_WINDOW_MS}ms`
    );
  }
  console.log('========================================');
}

/**
 * 토큰 마스킹 (보안)
 */
function maskToken(token?: string): string {
  if (!token) return '(설정되지 않음)';
  if (token.length <= 8) return '****';
  return token.substring(0, 4) + '****' + token.substring(token.length - 4);
}
