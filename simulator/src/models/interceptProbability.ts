/**
 * 다변수 요격 확률 모델
 *
 * 기존 단순 확률 계산 vs 다변수 로지스틱 모델
 *
 * 기존 방식 (Baseline):
 * - prob = base_rate - speed * factor - evade_penalty
 * - 단순 선형 조합
 *
 * 제안 방식:
 * - 로지스틱 회귀 기반 다변수 모델
 * - 접근 각도, 고도 우위, 타겟 크기, 예측 정확도, 센서 품질 반영
 *
 * 비교 대상 알고리즘:
 * - Simple Linear: 기존 시스템 (Baseline)
 * - Logistic Multi-variable: 로지스틱 회귀 (제안 방식)
 * - Monte Carlo: MC 시뮬레이션 기반 (검증용)
 */

import { Position3D, Velocity3D } from '../types';
import {
  InterceptMethod,
  INTERCEPT_METHOD_CONFIG,
} from '../core/logging/eventSchemas';

// ============================================
// 확률 모델 모드
// ============================================

export type ProbabilityModelMode = 'SIMPLE' | 'LOGISTIC' | 'MONTE_CARLO';

// ============================================
// 요격 확률 요소
// ============================================

/**
 * 기존 요격 확률 요소 (Baseline)
 */
export interface SimpleProbabilityFactors {
  /** 기본 성공률 (요격 방식에 따름) */
  baseRate: number;
  /** 상대 속도 요소 */
  speedFactor: number;
  /** 회피 패널티 */
  evadeFactor: number;
  /** 거리 요소 */
  distanceFactor: number;
}

/**
 * 확장된 요격 확률 요소 (제안 방식)
 */
export interface ExtendedProbabilityFactors extends SimpleProbabilityFactors {
  // 신규 요소
  /** 접근 각도 요소 (0-1, 후방 접근이 유리) */
  aspectAngleFactor: number;
  /** 고도 우위 요소 (0-1, 높은 쪽이 유리) */
  altitudeFactor: number;
  /** 타겟 크기 요소 (0-1, 큰 타겟이 쉬움) */
  targetSizeFactor: number;
  /** 칼만 필터 예측 정확도 (0-1) */
  predictAccuracy: number;
  /** 센서 품질/트랙 품질 (0-1) */
  sensorQuality: number;
  /** 기동 강도 요소 (0-1, 높으면 어려움) */
  maneuverIntensity: number;
}

/**
 * 요격 상황 정보
 */
export interface InterceptSituation {
  // 요격기 정보
  interceptorPosition: Position3D;
  interceptorVelocity: Velocity3D;

  // 타겟 정보
  targetPosition: Position3D;
  targetVelocity: Velocity3D;
  targetIsEvading: boolean;
  targetSizeClass?: 'SMALL' | 'MEDIUM' | 'LARGE';

  // 요격 정보
  method: InterceptMethod;

  // 추가 정보 (칼만 필터/센서 융합에서)
  positionUncertainty?: { x: number; y: number; z: number };
  trackQuality?: number;
  maneuverIntensity?: number;
}

// ============================================
// 확률 모델 설정
// ============================================

/**
 * 로지스틱 모델 계수
 */
export interface LogisticModelCoefficients {
  /** 절편 */
  intercept: number;
  /** 기본 성공률 계수 */
  baseRateCoeff: number;
  /** 속도 계수 (음수: 속도 높으면 성공률 낮음) */
  speedCoeff: number;
  /** 회피 계수 (음수) */
  evadeCoeff: number;
  /** 거리 계수 (음수) */
  distanceCoeff: number;
  /** 접근 각도 계수 (양수: 후방 접근 유리) */
  aspectAngleCoeff: number;
  /** 고도 우위 계수 (양수) */
  altitudeCoeff: number;
  /** 타겟 크기 계수 (양수: 큰 타겟 쉬움) */
  targetSizeCoeff: number;
  /** 예측 정확도 계수 (양수) */
  predictAccuracyCoeff: number;
  /** 센서 품질 계수 (양수) */
  sensorQualityCoeff: number;
  /** 기동 강도 계수 (음수) */
  maneuverCoeff: number;
}

/**
 * 요격 방식별 기본 계수
 */
export const DEFAULT_LOGISTIC_COEFFICIENTS: Record<InterceptMethod, LogisticModelCoefficients> = {
  RAM: {
    intercept: 0.8,
    baseRateCoeff: 1.0,
    speedCoeff: -0.25,
    evadeCoeff: -0.35,
    distanceCoeff: -0.15,
    aspectAngleCoeff: 0.20,
    altitudeCoeff: 0.10,
    targetSizeCoeff: 0.15,
    predictAccuracyCoeff: 0.20,
    sensorQualityCoeff: 0.10,
    maneuverCoeff: -0.25,
  },
  GUN: {
    intercept: 0.6,
    baseRateCoeff: 1.0,
    speedCoeff: -0.20,
    evadeCoeff: -0.30,
    distanceCoeff: -0.25,
    aspectAngleCoeff: 0.25,
    altitudeCoeff: 0.05,
    targetSizeCoeff: 0.20,
    predictAccuracyCoeff: 0.25,
    sensorQualityCoeff: 0.15,
    maneuverCoeff: -0.20,
  },
  NET: {
    intercept: 0.7,
    baseRateCoeff: 1.0,
    speedCoeff: -0.30,
    evadeCoeff: -0.25,
    distanceCoeff: -0.10,
    aspectAngleCoeff: 0.15,
    altitudeCoeff: 0.15,
    targetSizeCoeff: 0.10,
    predictAccuracyCoeff: 0.15,
    sensorQualityCoeff: 0.10,
    maneuverCoeff: -0.30,
  },
  JAM: {
    intercept: 0.75,
    baseRateCoeff: 1.0,
    speedCoeff: -0.10,
    evadeCoeff: -0.20,
    distanceCoeff: -0.20,
    aspectAngleCoeff: 0.05,
    altitudeCoeff: 0.05,
    targetSizeCoeff: 0.05,
    predictAccuracyCoeff: 0.10,
    sensorQualityCoeff: 0.20,
    maneuverCoeff: -0.15,
  },
};

// ============================================
// 요격 확률 계산기 클래스
// ============================================

export class InterceptProbabilityCalculator {
  private mode: ProbabilityModelMode = 'SIMPLE';
  private coefficients: Record<InterceptMethod, LogisticModelCoefficients>;

  constructor(
    mode: ProbabilityModelMode = 'SIMPLE',
    customCoefficients?: Partial<Record<InterceptMethod, Partial<LogisticModelCoefficients>>>
  ) {
    this.mode = mode;
    this.coefficients = { ...DEFAULT_LOGISTIC_COEFFICIENTS };

    if (customCoefficients) {
      for (const method of Object.keys(customCoefficients) as InterceptMethod[]) {
        if (customCoefficients[method]) {
          this.coefficients[method] = {
            ...this.coefficients[method],
            ...customCoefficients[method],
          };
        }
      }
    }
  }

  /**
   * 모드 설정
   */
  setMode(mode: ProbabilityModelMode): void {
    this.mode = mode;
  }

  /**
   * 현재 모드 반환
   */
  getMode(): ProbabilityModelMode {
    return this.mode;
  }

  /**
   * 요격 확률 계산
   */
  calculate(situation: InterceptSituation): number {
    switch (this.mode) {
      case 'SIMPLE':
        return this.calculateSimple(situation);
      case 'LOGISTIC':
        return this.calculateLogistic(situation);
      case 'MONTE_CARLO':
        return this.calculateMonteCarlo(situation);
      default:
        return this.calculateSimple(situation);
    }
  }

  /**
   * 모든 모드로 계산 (비교 분석용)
   */
  calculateAllModes(situation: InterceptSituation): Map<ProbabilityModelMode, number> {
    const results = new Map<ProbabilityModelMode, number>();
    results.set('SIMPLE', this.calculateSimple(situation));
    results.set('LOGISTIC', this.calculateLogistic(situation));
    results.set('MONTE_CARLO', this.calculateMonteCarlo(situation));
    return results;
  }

  // ============================================
  // 단순 선형 모델 (Baseline)
  // ============================================

  private calculateSimple(situation: InterceptSituation): number {
    const factors = this.computeSimpleFactors(situation);
    const config = INTERCEPT_METHOD_CONFIG[situation.method];

    let prob = factors.baseRate;
    prob -= factors.speedFactor * config.speed_factor * 0.01;
    prob *= (1 - factors.evadeFactor * config.evade_penalty);
    prob *= factors.distanceFactor;

    return this.clampProbability(prob);
  }

  private computeSimpleFactors(situation: InterceptSituation): SimpleProbabilityFactors {
    const config = INTERCEPT_METHOD_CONFIG[situation.method];

    // 상대 속도
    const relativeSpeed = this.computeRelativeSpeed(situation);

    // 거리
    const distance = this.computeDistance(situation);
    const optimalDist = (config.min_distance + config.max_distance) / 2;
    const distanceFactor = 1 - Math.abs(distance - optimalDist) / config.max_distance * 0.3;

    return {
      baseRate: config.base_success_rate,
      speedFactor: relativeSpeed,
      evadeFactor: situation.targetIsEvading ? 1 : 0,
      distanceFactor: Math.max(0.5, distanceFactor),
    };
  }

  // ============================================
  // 로지스틱 다변수 모델 (제안 방식)
  // ============================================

  private calculateLogistic(situation: InterceptSituation): number {
    const factors = this.computeExtendedFactors(situation);
    const coeff = this.coefficients[situation.method];

    // 로지스틱 회귀 계산
    const logit =
      coeff.intercept +
      coeff.baseRateCoeff * factors.baseRate +
      coeff.speedCoeff * factors.speedFactor +
      coeff.evadeCoeff * factors.evadeFactor +
      coeff.distanceCoeff * (1 - factors.distanceFactor) +
      coeff.aspectAngleCoeff * factors.aspectAngleFactor +
      coeff.altitudeCoeff * factors.altitudeFactor +
      coeff.targetSizeCoeff * factors.targetSizeFactor +
      coeff.predictAccuracyCoeff * factors.predictAccuracy +
      coeff.sensorQualityCoeff * factors.sensorQuality +
      coeff.maneuverCoeff * factors.maneuverIntensity;

    // 시그모이드 함수
    const prob = this.sigmoid(logit);
    return this.clampProbability(prob);
  }

  private computeExtendedFactors(situation: InterceptSituation): ExtendedProbabilityFactors {
    const simpleFactors = this.computeSimpleFactors(situation);

    // 접근 각도 (0: 정면, 1: 후방)
    const aspectAngleFactor = this.computeAspectAngle(situation);

    // 고도 우위 (양수: 요격기가 높음)
    const altitudeFactor = this.computeAltitudeAdvantage(situation);

    // 타겟 크기 요소
    const targetSizeFactor = this.computeTargetSizeFactor(situation);

    // 예측 정확도 (위치 불확실성 기반)
    const predictAccuracy = this.computePredictAccuracy(situation);

    // 센서/트랙 품질
    const sensorQuality = situation.trackQuality ?? 0.7;

    // 기동 강도
    const maneuverIntensity = situation.maneuverIntensity ?? 0.3;

    return {
      ...simpleFactors,
      aspectAngleFactor,
      altitudeFactor,
      targetSizeFactor,
      predictAccuracy,
      sensorQuality,
      maneuverIntensity,
    };
  }

  /**
   * 접근 각도 계산 (0: 정면, 1: 후방)
   * 타겟의 속도 벡터와 요격기-타겟 벡터의 관계
   */
  private computeAspectAngle(situation: InterceptSituation): number {
    const dx = situation.interceptorPosition.x - situation.targetPosition.x;
    const dy = situation.interceptorPosition.y - situation.targetPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) return 0.5;

    // 타겟에서 요격기로의 방향
    const ux = dx / dist;
    const uy = dy / dist;

    // 타겟의 속도 방향
    const targetSpeed = Math.sqrt(
      situation.targetVelocity.vx ** 2 + situation.targetVelocity.vy ** 2
    );
    if (targetSpeed < 1) return 0.5;

    const tvx = situation.targetVelocity.vx / targetSpeed;
    const tvy = situation.targetVelocity.vy / targetSpeed;

    // 내적: -1(정면) ~ +1(후방)
    const dot = ux * tvx + uy * tvy;
    return (dot + 1) / 2; // 0-1 정규화
  }

  /**
   * 고도 우위 계산 (0-1)
   */
  private computeAltitudeAdvantage(situation: InterceptSituation): number {
    const altDiff =
      situation.interceptorPosition.altitude - situation.targetPosition.altitude;

    // -50m ~ +50m 범위를 0-1로 정규화
    return Math.max(0, Math.min(1, (altDiff + 50) / 100));
  }

  /**
   * 타겟 크기 요소 (0-1)
   */
  private computeTargetSizeFactor(situation: InterceptSituation): number {
    switch (situation.targetSizeClass) {
      case 'LARGE':
        return 1.0;
      case 'MEDIUM':
        return 0.6;
      case 'SMALL':
        return 0.3;
      default:
        return 0.5; // 알 수 없음
    }
  }

  /**
   * 예측 정확도 (위치 불확실성 기반)
   */
  private computePredictAccuracy(situation: InterceptSituation): number {
    if (!situation.positionUncertainty) {
      return 0.7; // 기본값
    }

    const { x, y, z } = situation.positionUncertainty;
    const totalUncertainty = Math.sqrt(x * x + y * y + z * z);

    // 불확실성이 작을수록 정확도 높음
    // 0m -> 1.0, 50m -> 0.5, 100m+ -> 0.2
    if (totalUncertainty < 10) return 1.0;
    if (totalUncertainty < 30) return 0.8;
    if (totalUncertainty < 50) return 0.6;
    if (totalUncertainty < 80) return 0.4;
    return 0.2;
  }

  // ============================================
  // 몬테카를로 시뮬레이션 (검증용)
  // ============================================

  private calculateMonteCarlo(
    situation: InterceptSituation,
    iterations: number = 100
  ): number {
    let successes = 0;

    for (let i = 0; i < iterations; i++) {
      // 노이즈 추가된 상황 생성
      const noisySituation = this.addNoise(situation);
      // 로지스틱 모델로 단일 시도 계산
      const prob = this.calculateLogistic(noisySituation);
      if (Math.random() < prob) {
        successes++;
      }
    }

    return successes / iterations;
  }

  /**
   * 상황에 노이즈 추가 (MC 시뮬레이션용)
   */
  private addNoise(situation: InterceptSituation): InterceptSituation {
    const posNoise = 5; // 위치 노이즈 (m)
    const velNoise = 2; // 속도 노이즈 (m/s)

    return {
      ...situation,
      targetPosition: {
        x: situation.targetPosition.x + (Math.random() - 0.5) * posNoise * 2,
        y: situation.targetPosition.y + (Math.random() - 0.5) * posNoise * 2,
        altitude:
          situation.targetPosition.altitude + (Math.random() - 0.5) * posNoise,
      },
      targetVelocity: {
        vx: situation.targetVelocity.vx + (Math.random() - 0.5) * velNoise * 2,
        vy: situation.targetVelocity.vy + (Math.random() - 0.5) * velNoise * 2,
        climbRate:
          situation.targetVelocity.climbRate + (Math.random() - 0.5) * velNoise,
      },
    };
  }

  // ============================================
  // 유틸리티 함수
  // ============================================

  private computeRelativeSpeed(situation: InterceptSituation): number {
    return Math.sqrt(
      (situation.interceptorVelocity.vx - situation.targetVelocity.vx) ** 2 +
        (situation.interceptorVelocity.vy - situation.targetVelocity.vy) ** 2
    );
  }

  private computeDistance(situation: InterceptSituation): number {
    const dx = situation.targetPosition.x - situation.interceptorPosition.x;
    const dy = situation.targetPosition.y - situation.interceptorPosition.y;
    const dz =
      situation.targetPosition.altitude - situation.interceptorPosition.altitude;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private clampProbability(prob: number): number {
    return Math.max(0.05, Math.min(0.95, prob));
  }

  // ============================================
  // 분석/디버깅
  // ============================================

  /**
   * 요소별 상세 분석
   */
  analyzeFactors(situation: InterceptSituation): {
    simple: SimpleProbabilityFactors;
    extended: ExtendedProbabilityFactors;
    simpleProb: number;
    logisticProb: number;
    difference: number;
  } {
    const simple = this.computeSimpleFactors(situation);
    const extended = this.computeExtendedFactors(situation);
    const simpleProb = this.calculateSimple(situation);
    const logisticProb = this.calculateLogistic(situation);

    return {
      simple,
      extended,
      simpleProb,
      logisticProb,
      difference: logisticProb - simpleProb,
    };
  }
}

// ============================================
// 편의 함수 (레거시 호환)
// ============================================

const defaultCalculator = new InterceptProbabilityCalculator('SIMPLE');

/**
 * 단순 확률 계산 (기존 시스템과 호환)
 */
export function calculateSimpleInterceptProbability(
  situation: InterceptSituation
): number {
  return defaultCalculator.calculate(situation);
}

/**
 * 확장된 확률 계산
 */
export function calculateEnhancedInterceptProbability(
  situation: InterceptSituation
): number {
  const calc = new InterceptProbabilityCalculator('LOGISTIC');
  return calc.calculate(situation);
}

// ============================================
// 비교 분석 유틸리티
// ============================================

/**
 * 확률 모델 비교 결과
 */
export interface ProbabilityModelComparison {
  method: InterceptMethod;
  situation: InterceptSituation;
  simpleProbability: number;
  logisticProbability: number;
  monteCarloProbability: number;
  difference: {
    logisticVsSimple: number;
    monteCarloVsLogistic: number;
  };
  factors: ExtendedProbabilityFactors;
}

/**
 * 모든 모델 비교 분석
 */
export function compareProbabilityModels(
  situation: InterceptSituation
): ProbabilityModelComparison {
  const calculator = new InterceptProbabilityCalculator('LOGISTIC');
  const allModes = calculator.calculateAllModes(situation);
  const analysis = calculator.analyzeFactors(situation);

  const simple = allModes.get('SIMPLE') ?? 0;
  const logistic = allModes.get('LOGISTIC') ?? 0;
  const monteCarlo = allModes.get('MONTE_CARLO') ?? 0;

  return {
    method: situation.method,
    situation,
    simpleProbability: simple,
    logisticProbability: logistic,
    monteCarloProbability: monteCarlo,
    difference: {
      logisticVsSimple: logistic - simple,
      monteCarloVsLogistic: monteCarlo - logistic,
    },
    factors: analysis.extended,
  };
}

export default InterceptProbabilityCalculator;
