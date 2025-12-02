/**
 * 교전 의사결정 시스템 타입 정의
 * 
 * Threat 기반 교전 후보 선정/개시/중단 로직
 */

// ============================================
// 교전 상태 정의
// ============================================

/** 교전 상태 */
export type EngagementState = 
  | 'IDLE'           // 대기 상태 (교전 미대상)
  | 'TRACKING'       // 추적 중 (교전 고려 대상)
  | 'ENGAGE_PENDING' // 교전 대기 (인터셉터 할당 대기)
  | 'ENGAGING'       // 교전 중 (인터셉터 발진)
  | 'COMPLETED'      // 교전 완료 (성공 또는 실패)
  | 'ABORTED';       // 교전 중단

/** 교전 결과 */
export type EngagementResult = 'SUCCESS' | 'FAIL' | 'ABORTED' | 'PENDING';

/** 교전 중단 사유 */
export type AbortReason = 
  | 'LOW_EXISTENCE_PROB'    // 존재 확률 저하
  | 'LOW_THREAT_SCORE'      // 위협 점수 저하
  | 'CLASSIFIED_CIVIL'      // 민간 드론으로 분류
  | 'OUT_OF_RANGE'          // 범위 이탈
  | 'INTERCEPTOR_LOST'      // 인터셉터 소실
  | 'MANUAL_ABORT'          // 수동 중단
  | 'TARGET_LOST';          // 표적 소실

// ============================================
// 교전 정보 인터페이스
// ============================================

/** 트랙별 교전 정보 */
export interface TrackEngagementInfo {
  /** 트랙 ID */
  trackId: string;
  /** 현재 교전 상태 */
  state: EngagementState;
  /** 마지막 교전 결정 시간 */
  lastDecisionTime: number | null;
  /** 교전 개시 시간 */
  engageStartTime: number | null;
  /** 할당된 인터셉터 ID */
  assignedInterceptorId: string | null;
  /** 교전 사유 */
  engageReason: string;
  /** 중단 사유 */
  abortReason: AbortReason | null;
  /** 교전 결과 */
  result: EngagementResult;
  /** 첫 탐지 시간 */
  firstDetectTime: number | null;
  /** 위협도 70 도달 시간 */
  threatThresholdReachedTime: number | null;
  /** 교전 시 위협 점수 */
  threatScoreAtEngage: number;
  /** 교전 시 존재 확률 */
  existenceProbAtEngage: number;
  /** 교전 시 거리 */
  distanceAtEngage: number;
}

/** 교전 결정 */
export interface EngagementDecision {
  /** 트랙 ID */
  trackId: string;
  /** 결정된 행동 */
  action: 'ENGAGE' | 'HOLD' | 'ABORT';
  /** 결정 사유 */
  reason: string;
  /** 우선순위 점수 */
  priorityScore: number;
  /** 위협 점수 */
  threatScore: number;
  /** 존재 확률 */
  existenceProb: number;
  /** 거리 (m) */
  distance: number;
  /** 분류 */
  classification: string;
  /** 분류 신뢰도 */
  classConfidence: number;
  /** 센서 정보 */
  sensors: {
    radar: boolean;
    audio: boolean;
    eo: boolean;
  };
}

/** 교전 후보 정보 */
export interface EngagementCandidate {
  trackId: string;
  droneId: string | null;
  threatScore: number;
  existenceProb: number;
  distance: number;
  classification: string;
  classConfidence: number;
  isApproaching: boolean;
  sensors: {
    radar: boolean;
    audio: boolean;
    eo: boolean;
  };
  currentState: EngagementState;
}

// ============================================
// 로그 이벤트 타입
// ============================================

/** 교전 개시 로그 이벤트 */
export interface EngageStartLogEvent {
  timestamp: number;
  event: 'engage_start';
  track_id: string;
  drone_id: string | null;
  mode: 'BASELINE' | 'FUSION';
  threat_score: number;
  existence_prob: number;
  distance_to_base: number;
  classification: string;
  class_confidence: number;
  engage_reason: string;
  sensors: {
    radar: boolean;
    audio: boolean;
    eo: boolean;
  };
  interceptor_id: string;
}

/** 교전 종료 로그 이벤트 */
export interface EngageEndLogEvent {
  timestamp: number;
  event: 'engage_end';
  track_id: string;
  drone_id: string | null;
  mode: 'BASELINE' | 'FUSION';
  result: EngagementResult;
  abort_reason: AbortReason | null;
  time_to_engage: number | null;      // 첫 탐지 → 교전 시작
  time_from_threat70: number | null;  // 위협도 70 → 교전 시작
  engagement_duration: number | null; // 교전 지속 시간
  interceptor_id: string | null;
}

