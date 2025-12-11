/**
 * 동적 위협 평가 모듈
 *
 * ETA(Estimated Time of Arrival) 기반 동적 위협 점수 계산
 *
 * 기존 정적 평가 vs 동적 평가:
 * - 정적 (Baseline): 현재 상태만 기반으로 가중치 합산
 * - 동적 (제안): ETA, 위협 변화율, 궤적 예측 포함
 *
 * 비교 대상 알고리즘:
 * - Static Weighted Sum: 기존 시스템 (Baseline)
 * - ETA-based Dynamic: ETA + 변화율 (제안 방식)
 * - Bayesian Network: 조건부 확률 기반 (비교용)
 * - Dempster-Shafer: 증거이론 기반 (비교용)
 */

import {
  FusedTrack,
  TrackPosition,
  TrackVelocity,
  ExtendedFusedTrack,
} from './types';

import {
  ThreatScoreConfig,
  DEFAULT_THREAT_SCORE_CONFIG,
  ThreatScoreWeights,
  DEFAULT_THREAT_WEIGHTS,
  determineBehavior,
  BehaviorType,
  ThreatLevel,
  getThreatLevel,
} from './threatScore';

// ============================================
// 위협 평가 모드
// ============================================

export type ThreatEvaluationMode = 'STATIC' | 'DYNAMIC_ETA' | 'BAYESIAN' | 'DEMPSTER_SHAFER';

// ============================================
// 동적 위협 요소 인터페이스
// ============================================

/**
 * 동적 위협 요소
 */
export interface DynamicThreatFactors {
  // 기존 정적 요소
  existenceScore: number;       // 0-35 (존재 확률)
  classificationScore: number;  // -40 ~ +50 (분류)
  distanceScore: number;        // 0-25 (거리)
  behaviorScore: number;        // 0-25 (행동 패턴)
  armedScore: number;           // 0-20 (무장)

  // 동적 요소 (신규)
  etaScore: number;             // 0-30 (도착 예정 시간)
  threatDerivative: number;     // -10 ~ +10 (위협 변화율)
  trajectoryScore: number;      // 0-15 (궤적 예측)
  persistenceScore: number;     // 0-10 (위협 지속 시간)
}

/**
 * ETA 정보
 */
export interface ETAInfo {
  /** 도착 예정 시간 (초) */
  eta: number;
  /** 접근 속도 (m/s) */
  closingSpeed: number;
  /** 현재 거리 (m) */
  distance: number;
  /** 접근 중 여부 */
  isApproaching: boolean;
}

/**
 * 위협 히스토리 (변화율 계산용)
 */
export interface ThreatHistory {
  timestamps: number[];
  scores: number[];
  derivatives: number[];
  maxLength: number;
}

// ============================================
// 동적 위협 설정
// ============================================

export interface DynamicThreatConfig extends ThreatScoreConfig {
  /** ETA 점수 가중치 */
  etaWeight: number;
  /** 위협 변화율 가중치 */
  derivativeWeight: number;
  /** 궤적 예측 가중치 */
  trajectoryWeight: number;
  /** 히스토리 최대 길이 */
  maxHistoryLength: number;
  /** 위협 지속 시간 임계값 (초) */
  persistenceThreshold: number;
}

export const DEFAULT_DYNAMIC_THREAT_CONFIG: DynamicThreatConfig = {
  ...DEFAULT_THREAT_SCORE_CONFIG,
  etaWeight: 0.25,
  derivativeWeight: 0.10,
  trajectoryWeight: 0.10,
  maxHistoryLength: 30,
  persistenceThreshold: 5.0,
};

// ============================================
// 동적 위협 평가 클래스
// ============================================

export class DynamicThreatEvaluator {
  private config: DynamicThreatConfig;
  private basePosition: TrackPosition;

  // 트랙별 위협 히스토리
  private threatHistories: Map<string, ThreatHistory> = new Map();

  // 트랙별 첫 탐지 시간 (지속 시간 계산용)
  private firstDetectionTimes: Map<string, number> = new Map();

  constructor(
    basePosition: TrackPosition,
    config: Partial<DynamicThreatConfig> = {}
  ) {
    this.basePosition = basePosition;
    this.config = { ...DEFAULT_DYNAMIC_THREAT_CONFIG, ...config };
  }

  // ============================================
  // ETA 계산
  // ============================================

  /**
   * ETA (Estimated Time of Arrival) 계산
   */
  calculateETA(track: FusedTrack): ETAInfo {
    const dx = this.basePosition.x - track.position.x;
    const dy = this.basePosition.y - track.position.y;
    const dz = this.basePosition.altitude - track.position.altitude;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 접근 속도 계산 (기지 방향 속도 성분)
    const closingSpeed = this.calculateClosingSpeed(track);

    // ETA 계산
    let eta = Infinity;
    const isApproaching = closingSpeed > 0.5; // 0.5 m/s 이상 접근 중

    if (isApproaching && closingSpeed > 0) {
      eta = distance / closingSpeed;
    }

    return {
      eta,
      closingSpeed,
      distance,
      isApproaching,
    };
  }

  /**
   * 접근 속도 계산 (기지 방향 속도 성분)
   */
  private calculateClosingSpeed(track: FusedTrack): number {
    const dx = this.basePosition.x - track.position.x;
    const dy = this.basePosition.y - track.position.y;
    const dz = this.basePosition.altitude - track.position.altitude;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance < 0.1) return 0;

    // 기지 방향 단위 벡터
    const ux = dx / distance;
    const uy = dy / distance;
    const uz = dz / distance;

    // 속도와 기지 방향의 내적 = 접근 속도
    const closingSpeed =
      track.velocity.vx * ux +
      track.velocity.vy * uy +
      track.velocity.climbRate * uz;

    return closingSpeed;
  }

  /**
   * ETA를 점수로 변환 (0-30점)
   */
  etaToScore(eta: number): number {
    if (!isFinite(eta) || eta < 0) return 0;
    if (eta <= 5) return 30;   // 5초 이내: 최대 위협
    if (eta <= 10) return 27;  // 10초 이내
    if (eta <= 15) return 25;  // 15초 이내
    if (eta <= 20) return 22;  // 20초 이내
    if (eta <= 30) return 18;  // 30초 이내
    if (eta <= 45) return 14;  // 45초 이내
    if (eta <= 60) return 10;  // 1분 이내
    if (eta <= 90) return 6;   // 1.5분 이내
    if (eta <= 120) return 3;  // 2분 이내
    return 1;                   // 2분 초과
  }

  // ============================================
  // 위협 변화율 계산
  // ============================================

  /**
   * 위협 히스토리 업데이트
   */
  updateThreatHistory(trackId: string, score: number, timestamp: number): void {
    let history = this.threatHistories.get(trackId);

    if (!history) {
      history = {
        timestamps: [],
        scores: [],
        derivatives: [],
        maxLength: this.config.maxHistoryLength,
      };
      this.threatHistories.set(trackId, history);
      this.firstDetectionTimes.set(trackId, timestamp);
    }

    // 히스토리 추가
    history.timestamps.push(timestamp);
    history.scores.push(score);

    // 변화율 계산
    if (history.scores.length >= 2) {
      const dt = history.timestamps[history.timestamps.length - 1] -
                 history.timestamps[history.timestamps.length - 2];
      const dScore = history.scores[history.scores.length - 1] -
                     history.scores[history.scores.length - 2];

      if (dt > 0) {
        const derivative = dScore / dt;
        history.derivatives.push(derivative);
      } else {
        history.derivatives.push(0);
      }
    } else {
      history.derivatives.push(0);
    }

    // 최대 길이 유지
    while (history.timestamps.length > history.maxLength) {
      history.timestamps.shift();
      history.scores.shift();
      history.derivatives.shift();
    }
  }

  /**
   * 현재 위협 변화율 반환 (-10 ~ +10)
   */
  getThreatDerivative(trackId: string): number {
    const history = this.threatHistories.get(trackId);
    if (!history || history.derivatives.length === 0) {
      return 0;
    }

    // 최근 3개의 변화율 평균 (노이즈 감소)
    const recentDerivatives = history.derivatives.slice(-3);
    const avgDerivative = recentDerivatives.reduce((a, b) => a + b, 0) / recentDerivatives.length;

    // -10 ~ +10 범위로 클램핑
    return Math.max(-10, Math.min(10, avgDerivative));
  }

  /**
   * 위협 지속 시간 계산
   */
  getThreatPersistence(trackId: string, currentTime: number): number {
    const firstTime = this.firstDetectionTimes.get(trackId);
    if (firstTime === undefined) return 0;
    return currentTime - firstTime;
  }

  /**
   * 위협 지속 시간을 점수로 변환 (0-10점)
   */
  persistenceToScore(persistence: number): number {
    if (persistence < this.config.persistenceThreshold) {
      return 0;
    }
    // 지속 시간이 길수록 점수 증가 (최대 10점)
    const score = Math.min(10, (persistence - this.config.persistenceThreshold) / 5);
    return Math.round(score);
  }

  // ============================================
  // 궤적 예측
  // ============================================

  /**
   * 미래 위치 예측
   */
  predictFuturePosition(
    track: FusedTrack | ExtendedFusedTrack,
    deltaTime: number
  ): TrackPosition {
    // 기본 선형 예측
    let predictedPos: TrackPosition = {
      x: track.position.x + track.velocity.vx * deltaTime,
      y: track.position.y + track.velocity.vy * deltaTime,
      altitude: track.position.altitude + track.velocity.climbRate * deltaTime,
    };

    // EKF 상태가 있으면 가속도 반영
    const extTrack = track as ExtendedFusedTrack;
    if (extTrack.acceleration) {
      const dt2 = 0.5 * deltaTime * deltaTime;
      predictedPos.x += extTrack.acceleration.ax * dt2;
      predictedPos.y += extTrack.acceleration.ay * dt2;
    }

    return predictedPos;
  }

  /**
   * 궤적 점수 계산 (0-15점)
   * 예측 궤적이 기지에 얼마나 가까워지는지 평가
   */
  calculateTrajectoryScore(track: FusedTrack | ExtendedFusedTrack): number {
    // 5초 후 예측 위치
    const futurePos = this.predictFuturePosition(track, 5.0);

    // 현재 거리와 예측 거리 비교
    const currentDist = this.calculateDistance(track.position);
    const futureDist = this.calculateDistance(futurePos);

    // 거리 감소량 (양수면 접근)
    const distanceReduction = currentDist - futureDist;

    // 접근 속도 대비 거리 감소율
    if (distanceReduction > 50) {
      return 15;  // 급접근: +15
    } else if (distanceReduction > 30) {
      return 12;  // 빠른 접근: +12
    } else if (distanceReduction > 15) {
      return 8;   // 접근: +8
    } else if (distanceReduction > 0) {
      return 4;   // 느린 접근: +4
    } else if (distanceReduction > -15) {
      return 0;   // 정지/약간 이탈: 0
    }
    return -5;    // 이탈 중: -5 (보너스)
  }

  /**
   * 기지까지 거리 계산
   */
  private calculateDistance(position: TrackPosition): number {
    const dx = position.x - this.basePosition.x;
    const dy = position.y - this.basePosition.y;
    const dz = position.altitude - this.basePosition.altitude;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ============================================
  // 동적 위협 점수 계산
  // ============================================

  /**
   * 동적 위협 점수 계산 (0-100)
   *
   * 기존 정적 점수에 ETA, 변화율, 궤적, 지속시간 추가
   */
  computeDynamicThreatScore(
    track: FusedTrack | ExtendedFusedTrack,
    currentTime: number
  ): number {
    const factors = this.computeDynamicFactors(track, currentTime);
    return this.factorsToScore(factors);
  }

  /**
   * 동적 위협 요소 계산
   */
  computeDynamicFactors(
    track: FusedTrack | ExtendedFusedTrack,
    currentTime: number
  ): DynamicThreatFactors {
    // 1. 존재 확률 점수 (0-35)
    let existenceScore = 0;
    if (track.existenceProb > 0.9) {
      existenceScore = 35;
    } else if (track.existenceProb > 0.7) {
      existenceScore = 25;
    } else if (track.existenceProb > 0.5) {
      existenceScore = 12;
    } else {
      existenceScore = 5;
    }

    // 2. 분류 점수 (-40 ~ +50)
    let classificationScore = 0;
    const classInfo = track.classificationInfo;
    const classConf = classInfo.confidence;

    switch (classInfo.classification) {
      case 'HOSTILE':
        classificationScore = 50 * classConf;
        break;
      case 'CIVIL':
        classificationScore = -40 * classConf;
        break;
      case 'UNKNOWN':
        classificationScore = 8;
        break;
      case 'FRIENDLY':
        classificationScore = -60 * classConf;
        break;
    }

    // 3. 거리 점수 (0-25)
    const distance = this.calculateDistance(track.position);
    let distanceScore = 0;
    if (distance < 80) {
      distanceScore = 25;
    } else if (distance < 150) {
      distanceScore = 18;
    } else if (distance < 250) {
      distanceScore = 10;
    } else if (distance < 400) {
      distanceScore = 5;
    }

    // 4. 행동 점수 (0-25)
    const behavior = determineBehavior(track, this.basePosition);
    let behaviorScore = 0;
    switch (behavior) {
      case 'APPROACHING':
        behaviorScore = 25;
        break;
      case 'CIRCLING':
        behaviorScore = 15;
        break;
      case 'HOVERING':
        behaviorScore = 12;
        break;
      case 'DEPARTING':
        behaviorScore = -5;
        break;
      default:
        behaviorScore = 8;
    }

    // 5. 무장 점수 (0-20)
    let armedScore = 0;
    if (classInfo.armed === true) {
      armedScore = 20;
    } else if (classInfo.armed === null && classInfo.classification === 'HOSTILE') {
      armedScore = 10;
    } else if (classInfo.armed === false) {
      armedScore = -5;
    }

    // === 동적 요소 ===

    // 6. ETA 점수 (0-30)
    const etaInfo = this.calculateETA(track);
    const etaScore = this.etaToScore(etaInfo.eta);

    // 7. 위협 변화율 (-10 ~ +10)
    const trackId = track.id;
    const threatDerivative = this.getThreatDerivative(trackId);

    // 8. 궤적 점수 (-5 ~ +15)
    const trajectoryScore = this.calculateTrajectoryScore(track);

    // 9. 지속 시간 점수 (0-10)
    const persistence = this.getThreatPersistence(trackId, currentTime);
    const persistenceScore = this.persistenceToScore(persistence);

    return {
      existenceScore,
      classificationScore,
      distanceScore,
      behaviorScore,
      armedScore,
      etaScore,
      threatDerivative,
      trajectoryScore,
      persistenceScore,
    };
  }

  /**
   * 요소들을 최종 점수로 변환
   */
  private factorsToScore(factors: DynamicThreatFactors): number {
    // 정적 요소 합산
    let score = factors.existenceScore +
                factors.classificationScore +
                factors.distanceScore +
                factors.behaviorScore +
                factors.armedScore;

    // 동적 요소 가중 합산
    score += factors.etaScore * this.config.etaWeight / 0.25;  // 정규화
    score += factors.threatDerivative;
    score += factors.trajectoryScore * this.config.trajectoryWeight / 0.10;
    score += factors.persistenceScore;

    // 0-100 범위로 클램핑
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * 미래 위협 점수 예측
   */
  predictThreatAtTime(
    track: FusedTrack | ExtendedFusedTrack,
    futureTime: number,
    currentTime: number
  ): number {
    const deltaTime = futureTime - currentTime;
    if (deltaTime <= 0) {
      return this.computeDynamicThreatScore(track, currentTime);
    }

    // 미래 위치 예측
    const futurePosition = this.predictFuturePosition(track, deltaTime);

    // 가상 트랙 생성
    const futureTtrack: FusedTrack = {
      ...track,
      position: futurePosition,
    };

    // 미래 점수 계산 (히스토리 업데이트 없이)
    return this.computeDynamicThreatScore(futureTtrack, futureTime);
  }

  // ============================================
  // 상세 분석
  // ============================================

  /**
   * 동적 위협 점수 상세 분석
   */
  computeDynamicThreatBreakdown(
    track: FusedTrack | ExtendedFusedTrack,
    currentTime: number
  ): DynamicThreatFactors & {
    total: number;
    level: ThreatLevel;
    etaInfo: ETAInfo;
    behavior: BehaviorType;
    persistence: number;
  } {
    const factors = this.computeDynamicFactors(track, currentTime);
    const total = this.factorsToScore(factors);
    const etaInfo = this.calculateETA(track);
    const behavior = determineBehavior(track, this.basePosition);
    const persistence = this.getThreatPersistence(track.id, currentTime);

    return {
      ...factors,
      total,
      level: getThreatLevel(total),
      etaInfo,
      behavior,
      persistence,
    };
  }

  // ============================================
  // 유틸리티
  // ============================================

  /**
   * 트랙 히스토리 삭제
   */
  clearTrackHistory(trackId: string): void {
    this.threatHistories.delete(trackId);
    this.firstDetectionTimes.delete(trackId);
  }

  /**
   * 모든 히스토리 삭제
   */
  clearAllHistories(): void {
    this.threatHistories.clear();
    this.firstDetectionTimes.clear();
  }

  /**
   * 기지 위치 업데이트
   */
  updateBasePosition(position: TrackPosition): void {
    this.basePosition = position;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<DynamicThreatConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================
// 편의 함수
// ============================================

/**
 * 단순 ETA 계산 (클래스 없이)
 */
export function calculateSimpleETA(
  track: FusedTrack,
  basePosition: TrackPosition
): ETAInfo {
  const dx = basePosition.x - track.position.x;
  const dy = basePosition.y - track.position.y;
  const dz = basePosition.altitude - track.position.altitude;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance < 0.1) {
    return { eta: 0, closingSpeed: 0, distance: 0, isApproaching: false };
  }

  // 기지 방향 단위 벡터
  const ux = dx / distance;
  const uy = dy / distance;
  const uz = dz / distance;

  // 접근 속도
  const closingSpeed =
    track.velocity.vx * ux +
    track.velocity.vy * uy +
    track.velocity.climbRate * uz;

  const isApproaching = closingSpeed > 0.5;
  const eta = isApproaching && closingSpeed > 0 ? distance / closingSpeed : Infinity;

  return { eta, closingSpeed, distance, isApproaching };
}

export default DynamicThreatEvaluator;
