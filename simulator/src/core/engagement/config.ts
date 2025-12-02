/**
 * 교전 의사결정 설정
 * 
 * Threat 기반 교전 로직의 임계값 및 파라미터 정의
 */

// ============================================
// 교전 모드
// ============================================

/** 교전 모드 */
export type EngagementMode = 'BASELINE' | 'FUSION';

// ============================================
// 교전 설정 인터페이스
// ============================================

export interface EngagementConfig {
  /** 교전 모드 */
  mode: EngagementMode;
  
  // === 교전 임계값 ===
  
  /** 위협 점수 교전 임계값 (이 이상이면 교전 고려) */
  THREAT_ENGAGE_THRESHOLD: number;
  
  /** 존재 확률 임계값 (이 이상이면 교전 고려) */
  EXIST_PROB_THRESHOLD: number;
  
  /** 최대 교전 거리 (m) */
  MAX_ENGAGE_RANGE: number;
  
  /** 민간 드론 제외 신뢰도 임계값 */
  CIVIL_EXCLUDE_CONFIDENCE: number;
  
  // === 교전 중단 임계값 ===
  
  /** 존재 확률 중단 임계값 (이하면 중단) */
  EXIST_PROB_ABORT_THRESHOLD: number;
  
  /** 위협 점수 중단 임계값 (이하면 중단) */
  THREAT_ABORT_THRESHOLD: number;
  
  // === 교전 제한 ===
  
  /** 동일 드론 재결정 최소 간격 (초) */
  MIN_DECISION_INTERVAL: number;
  
  /** 최대 동시 교전 수 */
  MAX_CONCURRENT_ENGAGEMENTS: number;
  
  /** 교전 평가 주기 (초) */
  EVALUATION_INTERVAL: number;
  
  // === Baseline 모드 설정 ===
  
  /** Baseline 모드: 거리 기반 교전 임계값 (m) */
  BASELINE_ENGAGE_DISTANCE: number;
  
  /** Baseline 모드: 랜덤 교전 확률 (0~1) */
  BASELINE_ENGAGE_PROBABILITY: number;
}

// ============================================
// 기본 설정값
// ============================================

/** Fusion 모드 기본 설정 */
export const FUSION_ENGAGEMENT_CONFIG: EngagementConfig = {
  mode: 'FUSION',
  
  // 교전 임계값
  THREAT_ENGAGE_THRESHOLD: 70,
  EXIST_PROB_THRESHOLD: 0.7,
  MAX_ENGAGE_RANGE: 400,
  CIVIL_EXCLUDE_CONFIDENCE: 0.75,
  
  // 교전 중단 임계값
  EXIST_PROB_ABORT_THRESHOLD: 0.3,
  THREAT_ABORT_THRESHOLD: 40,
  
  // 교전 제한
  MIN_DECISION_INTERVAL: 2.0,
  MAX_CONCURRENT_ENGAGEMENTS: 3,
  EVALUATION_INTERVAL: 0.5,
  
  // Baseline 설정 (Fusion 모드에서는 사용 안 함)
  BASELINE_ENGAGE_DISTANCE: 300,
  BASELINE_ENGAGE_PROBABILITY: 0.8,
};

/** Baseline 모드 기본 설정 */
export const BASELINE_ENGAGEMENT_CONFIG: EngagementConfig = {
  mode: 'BASELINE',
  
  // 교전 임계값 (Baseline에서는 사용 안 함)
  THREAT_ENGAGE_THRESHOLD: 0,
  EXIST_PROB_THRESHOLD: 0,
  MAX_ENGAGE_RANGE: 400,
  CIVIL_EXCLUDE_CONFIDENCE: 0.9,
  
  // 교전 중단 임계값 (Baseline에서는 사용 안 함)
  EXIST_PROB_ABORT_THRESHOLD: 0,
  THREAT_ABORT_THRESHOLD: 0,
  
  // 교전 제한
  MIN_DECISION_INTERVAL: 2.0,
  MAX_CONCURRENT_ENGAGEMENTS: 3,
  EVALUATION_INTERVAL: 0.5,
  
  // Baseline 설정
  BASELINE_ENGAGE_DISTANCE: 300,
  BASELINE_ENGAGE_PROBABILITY: 0.8,
};

/**
 * 모드에 따른 설정 반환
 */
export function getEngagementConfig(mode: EngagementMode): EngagementConfig {
  return mode === 'FUSION' 
    ? { ...FUSION_ENGAGEMENT_CONFIG }
    : { ...BASELINE_ENGAGEMENT_CONFIG };
}

/**
 * 설정 병합
 */
export function mergeEngagementConfig(
  base: EngagementConfig,
  overrides: Partial<EngagementConfig>
): EngagementConfig {
  return { ...base, ...overrides };
}

