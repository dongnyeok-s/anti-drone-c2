/**
 * 런타임 파라미터 로더
 * 
 * auto_tune에서 생성한 runtime_params.json을 읽어서
 * 시뮬레이터에 적용합니다.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeParams {
  // Threat 관련
  threat_engage_threshold?: number;
  threat_abort_threshold?: number;
  
  // 분류 관련
  civil_conf_threshold?: number;
  
  // PN 유도 관련
  pn_nav_constant?: number;
  pn_max_turn_rate?: number;
  pn_min_closing_speed?: number;
  
  // Interceptor 관련
  interceptor_turn_rate_multiplier?: number;
  
  // 센서 융합 가중치
  sensor_radar_weight?: number;
  sensor_audio_weight?: number;
  sensor_eo_weight?: number;
  
  // Threat 점수 가중치
  threat_weights?: {
    existence?: number;
    classification?: number;
    distance?: number;
    velocity?: number;
    behavior?: number;
    armed?: number;
    heading?: number;
  };
}

const RUNTIME_PARAMS_FILE = path.join(__dirname, '../../config/runtime_params.json');

let cachedParams: RuntimeParams | null = null;

/**
 * 런타임 파라미터 로드
 */
export function loadRuntimeParams(): RuntimeParams | null {
  // 캐시된 값이 있으면 반환
  if (cachedParams !== null) {
    return cachedParams;
  }
  
  // 파일이 없으면 null 반환 (기본값 사용)
  if (!fs.existsSync(RUNTIME_PARAMS_FILE)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(RUNTIME_PARAMS_FILE, 'utf-8');
    const params = JSON.parse(content) as RuntimeParams;
    cachedParams = params;
    console.log(`[RuntimeParams] 파라미터 로드: ${RUNTIME_PARAMS_FILE}`);
    return params;
  } catch (error) {
    console.error(`[RuntimeParams] 파라미터 로드 실패: ${error}`);
    return null;
  }
}

/**
 * 캐시 초기화 (새로운 파라미터를 로드하기 위해)
 */
export function clearRuntimeParamsCache(): void {
  cachedParams = null;
}

/**
 * 파라미터가 존재하는지 확인
 */
export function hasRuntimeParams(): boolean {
  return fs.existsSync(RUNTIME_PARAMS_FILE);
}

