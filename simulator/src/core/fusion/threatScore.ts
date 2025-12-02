/**
 * 위협 점수 계산 모듈
 * 
 * 드론의 다양한 속성을 기반으로 위협 점수(0~100)를 계산합니다.
 * 
 * 주요 요소:
 * 1. 존재 확률 (existence_prob)
 * 2. EO 분류 (classification + class_confidence)
 * 3. 행동 패턴 (접근/이탈/호버링)
 * 4. 속도 기반 위협도
 * 5. 기지 방향 접근 여부 (heading_to_base)
 * 6. 무장 여부 (armed)
 */

import { FusedTrack, TrackPosition, TrackVelocity, ClassificationInfo } from './types';

// ============================================
// 위협 점수 설정
// ============================================

export interface ThreatScoreConfig {
  /** 기지 위치 */
  basePosition: TrackPosition;
  /** 안전 거리 (m) */
  safeDistance: number;
  /** 위험 거리 (m) - 이 거리 이내면 위협 점수 급상승 */
  dangerDistance: number;
  /** 크리티컬 거리 (m) - 이 거리 이내면 최대 위협 */
  criticalDistance: number;
  /** 위협 속도 임계값 (m/s) */
  threatSpeedThreshold: number;
  /** 고속 임계값 (m/s) */
  highSpeedThreshold: number;
}

export const DEFAULT_THREAT_SCORE_CONFIG: ThreatScoreConfig = {
  basePosition: { x: 0, y: 0, altitude: 50 },
  safeDistance: 500,
  dangerDistance: 200,
  criticalDistance: 100,
  threatSpeedThreshold: 10,
  highSpeedThreshold: 25,
};

// ============================================
// 위협 점수 가중치
// ============================================

export interface ThreatScoreWeights {
  /** 존재 확률 가중치 */
  existence: number;
  /** 분류 가중치 */
  classification: number;
  /** 거리 가중치 */
  distance: number;
  /** 속도 가중치 */
  velocity: number;
  /** 행동 패턴 가중치 */
  behavior: number;
  /** 무장 가중치 */
  armed: number;
  /** 접근 방향 가중치 */
  heading: number;
}

export const DEFAULT_THREAT_WEIGHTS: ThreatScoreWeights = {
  existence: 0.15,
  classification: 0.25,
  distance: 0.20,
  velocity: 0.12,
  behavior: 0.08,
  armed: 0.10,
  heading: 0.10,
};

// ============================================
// 행동 패턴 판별
// ============================================

export type BehaviorType = 'APPROACHING' | 'DEPARTING' | 'HOVERING' | 'CIRCLING' | 'UNKNOWN';

/**
 * 드론의 행동 패턴 판별
 */
export function determineBehavior(
  track: FusedTrack,
  basePosition: TrackPosition
): BehaviorType {
  const speed = Math.sqrt(
    track.velocity.vx ** 2 + 
    track.velocity.vy ** 2
  );
  
  // 거의 정지 상태
  if (speed < 2) {
    return 'HOVERING';
  }
  
  // 접근/이탈 판단
  const approachAngle = calculateApproachAngle(track, basePosition);
  
  if (approachAngle > 0.7) {
    return 'APPROACHING';
  } else if (approachAngle < 0.3) {
    return 'DEPARTING';
  } else if (track.isEvading || speed < 8) {
    return 'CIRCLING';
  }
  
  return 'UNKNOWN';
}

/**
 * 기지 방향 접근 각도 계산
 * @returns 0~1 (1 = 직접 접근, 0 = 완전 이탈)
 */
export function calculateApproachAngle(
  track: FusedTrack,
  basePosition: TrackPosition
): number {
  const dx = basePosition.x - track.position.x;
  const dy = basePosition.y - track.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist < 1) return 0.5;  // 기지 위에 있으면 중립
  
  // 기지 방향 단위 벡터
  const ux = dx / dist;
  const uy = dy / dist;
  
  // 속도 크기
  const speed = Math.sqrt(track.velocity.vx ** 2 + track.velocity.vy ** 2);
  if (speed < 0.1) return 0.5;  // 거의 정지면 중립
  
  // 속도 방향 단위 벡터
  const vx = track.velocity.vx / speed;
  const vy = track.velocity.vy / speed;
  
  // 내적: 1이면 직접 접근, -1이면 이탈
  const dot = vx * ux + vy * uy;
  return (dot + 1) / 2;  // 0~1로 정규화
}

// ============================================
// 메인 위협 점수 계산
// ============================================

/**
 * 위협 점수 계산 (0~100)
 * 
 * EO 정찰 이후 위협도가 확실히 갈리는 구조:
 * - 존재 확률: existence_prob > 0.7 → +25, > 0.9 → +10 추가
 * - 분류 (EO): HOSTILE → +50 * class_confidence, CIVIL → -40 * class_confidence
 * - 행동: approaching_base → +15~25, loitering → +10~15
 * - 거리: < 200m → +15, < 100m → +25
 * - EO 정찰 확인: +10 보너스 (HOSTILE), -15 보너스 (CIVIL)
 */
export function computeThreatScore(
  track: FusedTrack,
  config: ThreatScoreConfig = DEFAULT_THREAT_SCORE_CONFIG,
  weights: ThreatScoreWeights = DEFAULT_THREAT_WEIGHTS
): number {
  let base = 0;
  
  // 1. 존재 확률 점수 (최대 35점)
  if (track.existenceProb > 0.9) {
    base += 35;  // 0.9 이상: +25 + 10
  } else if (track.existenceProb > 0.7) {
    base += 25;  // 0.7~0.9: +25
  } else if (track.existenceProb > 0.5) {
    base += 12;  // 0.5~0.7: +12
  } else {
    base += 5;   // 낮은 확률: +5
  }
  
  // 2. 분류 점수 (EO 기반, 최대 +50점 또는 -40점) - 강화됨
  const classInfo = track.classificationInfo;
  const classConf = classInfo.confidence;
  
  switch (classInfo.classification) {
    case 'HOSTILE':
      // HOSTILE: +50 * class_confidence (최대 50점) - 강화됨
      base += 50 * classConf;
      break;
    case 'CIVIL':
      // CIVIL: -40 * class_confidence (최대 -40점) - 강화됨
      base -= 40 * classConf;
      break;
    case 'UNKNOWN':
      // UNKNOWN: 불확실성 반영, EO 미확인 시 경계 필요
      base += 8;
      break;
    case 'FRIENDLY':
      // FRIENDLY: 강하게 감소
      base -= 60 * classConf;
      break;
  }
  
  // 3. 거리 점수 (최대 25점) - 강화됨
  const dx = track.position.x - config.basePosition.x;
  const dy = track.position.y - config.basePosition.y;
  const dz = track.position.altitude - config.basePosition.altitude;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  if (distance < 80) {
    base += 25;  // 80m 이내: +25 (긴급)
  } else if (distance < 150) {
    base += 18;  // 150m 이내: +18
  } else if (distance < 250) {
    base += 10;  // 250m 이내: +10
  } else if (distance < 400) {
    base += 5;   // 400m 이내: +5
  }
  
  // 4. 행동/접근 패턴 점수 (최대 25점) - 강화됨
  const behavior = determineBehavior(track, config.basePosition);
  switch (behavior) {
    case 'APPROACHING':
      base += 25;  // 접근 중: +25
      break;
    case 'CIRCLING':
      base += 15;  // 선회/배회: +15
      break;
    case 'HOVERING':
      base += 12;  // 호버링: +12
      break;
    case 'DEPARTING':
      base -= 5;   // 이탈 중: -5 (위협 감소)
      break;
    default:
      base += 8;   // 알 수 없음: +8
  }
  
  // 5. 무장 점수 (최대 20점) - 강화됨
  if (classInfo.armed === true) {
    base += 20;  // 무장 확인: +20
  } else if (classInfo.armed === null && classInfo.classification === 'HOSTILE') {
    base += 10;  // 무장 불확실 + HOSTILE: +10
  } else if (classInfo.armed === false) {
    base -= 5;   // 비무장 확인: -5
  }
  
  // 6. EO 센서 확인 여부 (정찰 보너스) - 강화됨
  if (track.sensors.eoSeen) {
    // EO로 확인된 경우, 분류에 따라 큰 영향
    if (classInfo.classification === 'HOSTILE') {
      // EO 확인 HOSTILE: 추가 +10
      base += 10 * classConf;
    } else if (classInfo.classification === 'CIVIL') {
      // EO 확인 CIVIL: 추가 -15 (민간 확신 증가)
      base -= 15 * classConf;
    }
  } else {
    // EO 미확인: 불확실성으로 인한 약간의 경계
    if (classInfo.classification === 'UNKNOWN') {
      base += 5;
    }
  }
  
  // 7. 속도 기반 추가 점수 (빠르게 접근 시)
  const speed = Math.sqrt(track.velocity.vx ** 2 + track.velocity.vy ** 2);
  if (speed > config.highSpeedThreshold && behavior === 'APPROACHING') {
    base += 8;  // 고속 접근: +8
  } else if (speed > config.threatSpeedThreshold && behavior === 'APPROACHING') {
    base += 5;  // 위협 속도 접근: +5
  }
  
  // 8. 회피 중인 경우 (요격 대응 중일 가능성)
  if (track.isEvading) {
    base += 5;  // 회피 중: +5 (적대 행동 가능성)
  }
  
  return Math.round(Math.max(0, Math.min(100, base)));
}

// ============================================
// 개별 점수 계산 함수
// ============================================

/**
 * 존재 확률 기반 점수 (0~1)
 */
function computeExistenceScore(existenceProb: number): number {
  if (existenceProb >= 0.9) return 1.0;
  if (existenceProb >= 0.7) return 0.8;
  if (existenceProb >= 0.5) return 0.5;
  if (existenceProb >= 0.3) return 0.3;
  return 0.1;
}

/**
 * 분류 기반 점수 (0~1)
 */
function computeClassificationScore(info: ClassificationInfo): number {
  let baseScore = 0;
  
  switch (info.classification) {
    case 'HOSTILE':
      baseScore = 1.0;
      break;
    case 'UNKNOWN':
      baseScore = 0.5;
      break;
    case 'CIVIL':
      baseScore = 0.15;
      break;
    case 'FRIENDLY':
      baseScore = 0.0;
      break;
  }
  
  // 신뢰도 적용
  return baseScore * info.confidence;
}

/**
 * 거리 기반 점수 (0~1)
 * 가까울수록 높음
 */
function computeDistanceScore(
  position: TrackPosition,
  config: ThreatScoreConfig
): number {
  const dx = position.x - config.basePosition.x;
  const dy = position.y - config.basePosition.y;
  const dz = position.altitude - config.basePosition.altitude;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  // 크리티컬 거리 이내: 최대 점수
  if (distance <= config.criticalDistance) {
    return 1.0;
  }
  
  // 위험 거리 이내: 높은 점수
  if (distance <= config.dangerDistance) {
    const ratio = (distance - config.criticalDistance) / 
                  (config.dangerDistance - config.criticalDistance);
    return 0.8 + (1.0 - 0.8) * (1 - ratio);
  }
  
  // 안전 거리 이내: 중간 점수
  if (distance <= config.safeDistance) {
    const ratio = (distance - config.dangerDistance) / 
                  (config.safeDistance - config.dangerDistance);
    return 0.3 + (0.8 - 0.3) * (1 - ratio);
  }
  
  // 안전 거리 밖: 낮은 점수
  const ratio = Math.min(1, distance / (config.safeDistance * 2));
  return 0.1 * (1 - ratio);
}

/**
 * 속도 기반 점수 (0~1)
 * 빠를수록 높음
 */
function computeVelocityScore(
  velocity: TrackVelocity,
  config: ThreatScoreConfig
): number {
  const speed = Math.sqrt(velocity.vx ** 2 + velocity.vy ** 2);
  
  if (speed >= config.highSpeedThreshold) {
    return 1.0;
  }
  
  if (speed >= config.threatSpeedThreshold) {
    const ratio = (speed - config.threatSpeedThreshold) / 
                  (config.highSpeedThreshold - config.threatSpeedThreshold);
    return 0.5 + ratio * 0.5;
  }
  
  return speed / config.threatSpeedThreshold * 0.5;
}

/**
 * 행동 패턴 기반 점수 (0~1)
 */
function computeBehaviorScore(
  track: FusedTrack,
  basePosition: TrackPosition
): number {
  const behavior = determineBehavior(track, basePosition);
  
  switch (behavior) {
    case 'APPROACHING':
      return 1.0;
    case 'CIRCLING':
      return 0.6;
    case 'HOVERING':
      return 0.4;
    case 'DEPARTING':
      return 0.1;
    default:
      return 0.3;
  }
}

/**
 * 무장 여부 기반 점수 (0~1)
 */
function computeArmedScore(info: ClassificationInfo): number {
  if (info.armed === true) {
    return 1.0;
  }
  if (info.armed === false) {
    return 0.1;
  }
  // null인 경우 분류에 따라 추정
  if (info.classification === 'HOSTILE') {
    return 0.6;  // 적대적이면 무장 가능성 높음
  }
  return 0.3;  // 알 수 없음
}

/**
 * 접근 방향 기반 점수 (0~1)
 */
function computeHeadingScore(
  track: FusedTrack,
  basePosition: TrackPosition
): number {
  return calculateApproachAngle(track, basePosition);
}

// ============================================
// 위협 레벨 결정
// ============================================

export type ThreatLevel = 'INFO' | 'CAUTION' | 'DANGER' | 'CRITICAL';

/**
 * 위협 점수로부터 레벨 결정
 */
export function getThreatLevel(score: number): ThreatLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'DANGER';
  if (score >= 35) return 'CAUTION';
  return 'INFO';
}

/**
 * 위협 레벨 색상 반환
 */
export function getThreatColor(level: ThreatLevel): string {
  switch (level) {
    case 'CRITICAL':
      return '#FF0000';
    case 'DANGER':
      return '#FF6B00';
    case 'CAUTION':
      return '#FFD700';
    case 'INFO':
      return '#00FF00';
  }
}

// ============================================
// 디버그/로깅용 상세 분석
// ============================================

export interface ThreatScoreBreakdown {
  total: number;
  existence: number;
  classification: number;
  distance: number;
  velocity: number;
  behavior: BehaviorType;
  behaviorScore: number;
  armed: number;
  heading: number;
  level: ThreatLevel;
}

/**
 * 위협 점수 상세 분석
 */
export function computeThreatScoreBreakdown(
  track: FusedTrack,
  config: ThreatScoreConfig = DEFAULT_THREAT_SCORE_CONFIG,
  weights: ThreatScoreWeights = DEFAULT_THREAT_WEIGHTS
): ThreatScoreBreakdown {
  const existenceScore = computeExistenceScore(track.existenceProb);
  const classificationScore = computeClassificationScore(track.classificationInfo);
  const distanceScore = computeDistanceScore(track.position, config);
  const velocityScore = computeVelocityScore(track.velocity, config);
  const behavior = determineBehavior(track, config.basePosition);
  const behaviorScore = computeBehaviorScore(track, config.basePosition);
  const armedScore = computeArmedScore(track.classificationInfo);
  const headingScore = computeHeadingScore(track, config.basePosition);
  
  const total = computeThreatScore(track, config, weights);
  
  return {
    total,
    existence: Math.round(existenceScore * 100),
    classification: Math.round(classificationScore * 100),
    distance: Math.round(distanceScore * 100),
    velocity: Math.round(velocityScore * 100),
    behavior,
    behaviorScore: Math.round(behaviorScore * 100),
    armed: Math.round(armedScore * 100),
    heading: Math.round(headingScore * 100),
    level: getThreatLevel(total),
  };
}

