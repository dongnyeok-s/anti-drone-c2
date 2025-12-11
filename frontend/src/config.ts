/**
 * 프론트엔드 설정 관리
 * Vite 환경 변수 기반 설정 로더
 */

export interface FrontendConfig {
  simulatorWsUrl: string;
  frontendPort: number;
}

/**
 * 환경 변수에서 설정 로드
 * Vite는 VITE_ 접두사가 있는 변수만 클라이언트에 노출됩니다
 */
export function loadConfig(): FrontendConfig {
  return {
    simulatorWsUrl: import.meta.env.VITE_SIMULATOR_WS_URL || 'ws://localhost:8080',
    frontendPort: parseInt(import.meta.env.VITE_FRONTEND_PORT || '3000', 10),
  };
}

/**
 * 기본 설정 인스턴스 (싱글톤)
 */
let configInstance: FrontendConfig | null = null;

/**
 * 설정 싱글톤 가져오기
 */
export function getConfig(): FrontendConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

