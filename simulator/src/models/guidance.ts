/**
 * 요격 드론 유도(Guidance) 알고리즘 모듈
 * 
 * Proportional Navigation (PN) 및 기타 유도 방식 구현
 */

import { Position3D, Velocity3D, HostileDrone } from '../types';
import { loadRuntimeParams } from '../config/runtimeParams';

// ============================================
// 유도 모드 타입 정의
// ============================================

/**
 * 유도 모드
 *
 * 비교 대상 알고리즘:
 * - PURE_PURSUIT: 단순 추격 (기본 비교)
 * - PN: Basic Proportional Navigation (Baseline)
 * - APN: Augmented PN + Adaptive N (제안 방식)
 * - OPTIMAL: 최적 유도 (이론적 상한, 비교용)
 */
export type GuidanceMode =
  | 'PURE_PURSUIT'  // 기존 직선 추격
  | 'PN'            // Basic Proportional Navigation
  | 'APN'           // Augmented PN (타겟 가속도 보정)
  | 'OPTIMAL';      // 최적 유도 (비교용)

/** PN 유도 설정 */
export interface PNConfig {
  navConstant: number;      // Navigation constant (N), 보통 3~5
  maxTurnRate: number;      // 최대 선회율 (rad/s)
  minClosingSpeed: number;  // 최소 접근 속도 (m/s)
  leadTimeFactor: number;   // 예측 시간 계수
  // APN 관련 설정
  useAdaptiveN: boolean;    // Adaptive N 사용 여부
  minNavConstant: number;   // 최소 N 값
  maxNavConstant: number;   // 최대 N 값
  targetAccelWeight: number; // 타겟 가속도 보정 가중치
}

/** 기본 PN 설정 */
export const DEFAULT_PN_CONFIG: PNConfig = {
  navConstant: 3.0,        // 3.0으로 조정 (더 안정적인 추격)
  maxTurnRate: Math.PI * 1.5,  // 270 deg/s - 더 빠른 반응
  minClosingSpeed: 10.0,   // 최소 10 m/s - 더 적극적 접근
  leadTimeFactor: 2.0,     // 예측 시간 계수 증가
  // APN 기본 설정
  useAdaptiveN: false,     // 기본 PN에서는 사용 안 함
  minNavConstant: 2.5,
  maxNavConstant: 5.0,
  targetAccelWeight: 0.5,
};

/** APN (Augmented PN) 기본 설정 */
export const DEFAULT_APN_CONFIG: PNConfig = {
  navConstant: 3.0,
  maxTurnRate: Math.PI * 2.0,  // APN은 더 빠른 반응 필요
  minClosingSpeed: 8.0,
  leadTimeFactor: 2.5,
  // APN 활성화
  useAdaptiveN: true,
  minNavConstant: 2.5,
  maxNavConstant: 5.0,
  targetAccelWeight: 0.5,  // (N-1)/2 계수
};

/**
 * 런타임 파라미터를 적용한 PN 설정 반환
 */
export function getPNConfig(): PNConfig {
  const params = loadRuntimeParams();
  if (!params) {
    return { ...DEFAULT_PN_CONFIG };
  }
  
  const config = { ...DEFAULT_PN_CONFIG };
  
  if (params.pn_nav_constant !== undefined) {
    config.navConstant = params.pn_nav_constant;
  }
  if (params.pn_max_turn_rate !== undefined) {
    config.maxTurnRate = params.pn_max_turn_rate;
  }
  if (params.pn_min_closing_speed !== undefined) {
    config.minClosingSpeed = params.pn_min_closing_speed;
  }
  
  return config;
}

/** PN 유도 상태 (인터셉터에 저장) */
export interface PNState {
  prevLosAngle: number;       // 이전 LOS 각도 (rad)
  prevLosAngleVert: number;   // 이전 수직 LOS 각도 (rad)
  lastLambdaDot: number;      // 마지막 LOS 각속도 (rad/s)
  lastLambdaDotVert: number;  // 마지막 수직 LOS 각속도
  lastClosingSpeed: number;   // 마지막 접근 속도 (m/s)
  lastCommandedAccel: number; // 마지막 명령 가속도
  guidanceMode: GuidanceMode; // 현재 유도 모드
  pnConfig: PNConfig;         // PN 설정
  // APN 관련 상태
  prevTargetVel: Velocity3D | null;  // 이전 타겟 속도 (가속도 추정용)
  estimatedTargetAccel: { ax: number; ay: number; az: number }; // 추정 타겟 가속도
  adaptiveNavConstant: number;  // 적응형 N 값
  lastRange: number;            // 마지막 거리 (적응형 N 계산용)
}

/** 기본 PN 상태 초기값 */
export function createInitialPNState(mode: GuidanceMode = 'PN'): PNState {
  const config = mode === 'APN' ? { ...DEFAULT_APN_CONFIG } : getPNConfig();

  return {
    prevLosAngle: 0,
    prevLosAngleVert: 0,
    lastLambdaDot: 0,
    lastLambdaDotVert: 0,
    lastClosingSpeed: 0,
    lastCommandedAccel: 0,
    guidanceMode: mode,
    pnConfig: config,
    // APN 관련 초기값
    prevTargetVel: null,
    estimatedTargetAccel: { ax: 0, ay: 0, az: 0 },
    adaptiveNavConstant: config.navConstant,
    lastRange: Infinity,
  };
}

// ============================================
// 수학 유틸리티
// ============================================

/** 각도 래핑 (-π ~ π) */
function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/** 2D 벡터 정규화 */
function normalize2D(x: number, y: number): { nx: number; ny: number; len: number } {
  const len = Math.sqrt(x * x + y * y);
  if (len < 0.001) return { nx: 0, ny: 0, len: 0 };
  return { nx: x / len, ny: y / len, len };
}

/** 3D 벡터 내적 */
function dot3D(a: Velocity3D, b: { x: number; y: number; z: number }): number {
  return a.vx * b.x + a.vy * b.y + a.climbRate * b.z;
}

/** 속도 벡터의 크기 */
function speedMagnitude(v: Velocity3D): number {
  return Math.sqrt(v.vx * v.vx + v.vy * v.vy + v.climbRate * v.climbRate);
}

/** 2D 속도 벡터의 크기 */
function speed2D(v: Velocity3D): number {
  return Math.sqrt(v.vx * v.vx + v.vy * v.vy);
}

// ============================================
// PN 유도 알고리즘 (2D + 고도 분리)
// ============================================

export interface GuidanceResult {
  /** 새로운 속도 벡터 */
  velocity: Velocity3D;
  /** 업데이트된 PN 상태 */
  pnState: PNState;
  /** 디버그 정보 */
  debug: {
    losAngle: number;
    lambdaDot: number;
    closingSpeed: number;
    commandedAccel: number;
    commandedTurnRate: number;
  };
}

/**
 * Proportional Navigation 유도 계산
 * 
 * PN 법칙: a_command = N * V_c * λ_dot
 * 
 * @param interceptorPos 요격기 위치
 * @param interceptorVel 요격기 속도
 * @param targetPos 목표 위치
 * @param targetVel 목표 속도
 * @param pnState 이전 PN 상태
 * @param deltaTime 시간 간격 (초)
 * @param maxSpeed 최대 속도
 * @param acceleration 가속도
 */
export function computePnGuidance(
  interceptorPos: Position3D,
  interceptorVel: Velocity3D,
  targetPos: Position3D,
  targetVel: Velocity3D,
  pnState: PNState,
  deltaTime: number,
  maxSpeed: number,
  acceleration: number
): GuidanceResult {
  const config = pnState.pnConfig;
  
  // === 1. 상대 위치 및 거리 계산 ===
  const relX = targetPos.x - interceptorPos.x;
  const relY = targetPos.y - interceptorPos.y;
  const relAlt = targetPos.altitude - interceptorPos.altitude;
  
  const { len: range2D } = normalize2D(relX, relY);
  const range3D = Math.sqrt(relX * relX + relY * relY + relAlt * relAlt);
  
  // === 2. 상대 속도 계산 ===
  const relVx = targetVel.vx - interceptorVel.vx;
  const relVy = targetVel.vy - interceptorVel.vy;
  const relVz = targetVel.climbRate - interceptorVel.climbRate;
  
  // === 3. LOS (Line of Sight) 각도 계산 ===
  const losAngle = Math.atan2(relY, relX);  // 수평 LOS 각도
  const losAngleVert = Math.atan2(relAlt, range2D);  // 수직 LOS 각도
  
  // === 4. LOS 각속도 (λ_dot) 계산 ===
  let lambdaDot = 0;
  let lambdaDotVert = 0;
  
  if (deltaTime > 0.001 && range2D > 1) {
    // 각도 변화율 계산 (wrap-around 처리)
    const deltaLos = wrapAngle(losAngle - pnState.prevLosAngle);
    const deltaLosVert = wrapAngle(losAngleVert - pnState.prevLosAngleVert);
    
    lambdaDot = deltaLos / deltaTime;
    lambdaDotVert = deltaLosVert / deltaTime;
    
    // 노이즈 필터링 (급격한 변화 제한)
    const maxLambdaDot = config.maxTurnRate * 0.5;
    lambdaDot = Math.max(-maxLambdaDot, Math.min(maxLambdaDot, lambdaDot));
    lambdaDotVert = Math.max(-maxLambdaDot, Math.min(maxLambdaDot, lambdaDotVert));
  }
  
  // === 5. Closing Speed (V_c) 계산 ===
  // V_c = -dot(V_rel, r_hat) = 가까워질수록 양수
  const rHat = { x: relX / range3D, y: relY / range3D, z: relAlt / range3D };
  const closingSpeed = -(relVx * rHat.x + relVy * rHat.y + relVz * rHat.z);
  
  // 접근하고 있지 않거나 멀어지면 더 적극적으로 접근
  // 거리가 멀수록 closing speed를 높게 가정하여 적극 추격
  const distanceFactor = Math.min(2.0, range3D / 100);  // 거리에 비례
  const effectiveClosingSpeed = Math.max(
    config.minClosingSpeed * distanceFactor, 
    closingSpeed,
    maxSpeed * 0.5  // 최소 최대속도의 50%
  );
  
  // === 6. PN 가속도 명령 계산 ===
  // a_command = N * V_c * λ_dot
  const aCommandHoriz = config.navConstant * effectiveClosingSpeed * lambdaDot;
  const aCommandVert = config.navConstant * effectiveClosingSpeed * lambdaDotVert * 0.5;
  
  // === 7. 헤딩 변화율로 변환 ===
  const currentSpeed = speed2D(interceptorVel);
  const effectiveSpeed = Math.max(10, currentSpeed);
  
  // 선회율 = a / v (rad/s)
  let commandedTurnRate = aCommandHoriz / effectiveSpeed;
  commandedTurnRate = Math.max(-config.maxTurnRate, Math.min(config.maxTurnRate, commandedTurnRate));
  
  // === 8. 현재 헤딩 및 새 헤딩 계산 ===
  const currentHeading = Math.atan2(interceptorVel.vy, interceptorVel.vx);
  const newHeading = currentHeading + commandedTurnRate * deltaTime;
  
  // === 9. 새 속도 계산 ===
  // 목표 속도로 가속/감속
  const targetSpeed = maxSpeed;
  const newSpeed = Math.min(
    targetSpeed,
    currentSpeed + acceleration * deltaTime
  );
  
  // 새 속도 벡터 (수평)
  const newVx = newSpeed * Math.cos(newHeading);
  const newVy = newSpeed * Math.sin(newHeading);
  
  // 고도 조절 (간단한 비례 제어 + PN 보정)
  const altError = relAlt;
  const baseClimbRate = Math.sign(altError) * Math.min(10, Math.abs(altError) * 0.5);
  const pnClimbCorrection = aCommandVert * 0.3;
  const newClimbRate = Math.max(-15, Math.min(15, baseClimbRate + pnClimbCorrection));
  
  // === 10. 상태 업데이트 ===
  const newPnState: PNState = {
    ...pnState,
    prevLosAngle: losAngle,
    prevLosAngleVert: losAngleVert,
    lastLambdaDot: lambdaDot,
    lastLambdaDotVert: lambdaDotVert,
    lastClosingSpeed: closingSpeed,
    lastCommandedAccel: aCommandHoriz,
  };
  
  return {
    velocity: {
      vx: newVx,
      vy: newVy,
      climbRate: newClimbRate,
    },
    pnState: newPnState,
    debug: {
      losAngle,
      lambdaDot,
      closingSpeed,
      commandedAccel: aCommandHoriz,
      commandedTurnRate,
    },
  };
}

// ============================================
// Augmented PN (APN) 유도 알고리즘
// ============================================

/**
 * Augmented Proportional Navigation (APN) 유도 계산
 *
 * APN 법칙: a_command = N * V_c * λ_dot + ((N-1)/2) * a_target_normal
 *
 * 기본 PN에 타겟 가속도 보정항 추가:
 * - 타겟이 기동할 때 더 정확한 유도
 * - Adaptive N으로 거리/상황에 따라 N 값 조절
 *
 * @param interceptorPos 요격기 위치
 * @param interceptorVel 요격기 속도
 * @param targetPos 목표 위치
 * @param targetVel 목표 속도
 * @param pnState 이전 PN 상태 (타겟 가속도 추정 포함)
 * @param deltaTime 시간 간격 (초)
 * @param maxSpeed 최대 속도
 * @param acceleration 가속도
 */
export function computeApnGuidance(
  interceptorPos: Position3D,
  interceptorVel: Velocity3D,
  targetPos: Position3D,
  targetVel: Velocity3D,
  pnState: PNState,
  deltaTime: number,
  maxSpeed: number,
  acceleration: number
): GuidanceResult {
  const config = pnState.pnConfig;

  // === 1. 상대 위치 및 거리 계산 ===
  const relX = targetPos.x - interceptorPos.x;
  const relY = targetPos.y - interceptorPos.y;
  const relAlt = targetPos.altitude - interceptorPos.altitude;

  const { len: range2D } = normalize2D(relX, relY);
  const range3D = Math.sqrt(relX * relX + relY * relY + relAlt * relAlt);

  // === 2. 타겟 가속도 추정 ===
  let estimatedAccel = { ax: 0, ay: 0, az: 0 };
  if (pnState.prevTargetVel && deltaTime > 0.001) {
    const dvx = targetVel.vx - pnState.prevTargetVel.vx;
    const dvy = targetVel.vy - pnState.prevTargetVel.vy;
    const dvz = targetVel.climbRate - pnState.prevTargetVel.climbRate;

    // 지수 이동평균 필터 적용 (노이즈 감소)
    const alpha = 0.3;
    estimatedAccel = {
      ax: alpha * (dvx / deltaTime) + (1 - alpha) * pnState.estimatedTargetAccel.ax,
      ay: alpha * (dvy / deltaTime) + (1 - alpha) * pnState.estimatedTargetAccel.ay,
      az: alpha * (dvz / deltaTime) + (1 - alpha) * pnState.estimatedTargetAccel.az,
    };

    // 가속도 크기 제한 (현실적 범위)
    const maxAccel = 15; // 최대 15 m/s^2
    const accelMag = Math.sqrt(estimatedAccel.ax ** 2 + estimatedAccel.ay ** 2);
    if (accelMag > maxAccel) {
      const scale = maxAccel / accelMag;
      estimatedAccel.ax *= scale;
      estimatedAccel.ay *= scale;
    }
  }

  // === 3. Adaptive N 계산 ===
  let adaptiveN = config.navConstant;
  if (config.useAdaptiveN) {
    adaptiveN = computeAdaptiveN(
      range3D,
      pnState.lastClosingSpeed,
      estimatedAccel,
      config
    );
  }

  // === 4. 상대 속도 계산 ===
  const relVx = targetVel.vx - interceptorVel.vx;
  const relVy = targetVel.vy - interceptorVel.vy;
  const relVz = targetVel.climbRate - interceptorVel.climbRate;

  // === 5. LOS (Line of Sight) 각도 계산 ===
  const losAngle = Math.atan2(relY, relX);
  const losAngleVert = Math.atan2(relAlt, range2D);

  // === 6. LOS 각속도 (λ_dot) 계산 ===
  let lambdaDot = 0;
  let lambdaDotVert = 0;

  if (deltaTime > 0.001 && range2D > 1) {
    const deltaLos = wrapAngle(losAngle - pnState.prevLosAngle);
    const deltaLosVert = wrapAngle(losAngleVert - pnState.prevLosAngleVert);

    lambdaDot = deltaLos / deltaTime;
    lambdaDotVert = deltaLosVert / deltaTime;

    // 노이즈 필터링
    const maxLambdaDot = config.maxTurnRate * 0.5;
    lambdaDot = Math.max(-maxLambdaDot, Math.min(maxLambdaDot, lambdaDot));
    lambdaDotVert = Math.max(-maxLambdaDot, Math.min(maxLambdaDot, lambdaDotVert));
  }

  // === 7. Closing Speed (V_c) 계산 ===
  const rHat = { x: relX / range3D, y: relY / range3D, z: relAlt / range3D };
  const closingSpeed = -(relVx * rHat.x + relVy * rHat.y + relVz * rHat.z);

  const distanceFactor = Math.min(2.0, range3D / 100);
  const effectiveClosingSpeed = Math.max(
    config.minClosingSpeed * distanceFactor,
    closingSpeed,
    maxSpeed * 0.5
  );

  // === 8. 타겟 가속도의 LOS 수직 성분 계산 ===
  // a_target_normal = a_target - (a_target · r_hat) * r_hat
  const aTargetDotR = estimatedAccel.ax * rHat.x + estimatedAccel.ay * rHat.y;
  const aTargetNormalX = estimatedAccel.ax - aTargetDotR * rHat.x;
  const aTargetNormalY = estimatedAccel.ay - aTargetDotR * rHat.y;
  const aTargetNormalMag = Math.sqrt(aTargetNormalX ** 2 + aTargetNormalY ** 2);

  // 수직 방향 부호 결정 (LOS 회전 방향과 맞춤)
  const losPerp = { x: -rHat.y, y: rHat.x }; // LOS에 수직인 방향
  const aTargetNormalSign = Math.sign(aTargetNormalX * losPerp.x + aTargetNormalY * losPerp.y);

  // === 9. APN 가속도 명령 계산 ===
  // a_pn = N * V_c * λ_dot
  const aCommandPN = adaptiveN * effectiveClosingSpeed * lambdaDot;

  // APN 보정항: ((N-1)/2) * a_target_normal
  const apnCorrectionFactor = config.targetAccelWeight * (adaptiveN - 1) / 2;
  const aCommandAPN = apnCorrectionFactor * aTargetNormalMag * aTargetNormalSign;

  // 총 가속도 명령
  const aCommandHoriz = aCommandPN + aCommandAPN;
  const aCommandVert = adaptiveN * effectiveClosingSpeed * lambdaDotVert * 0.5;

  // === 10. 헤딩 변화율로 변환 ===
  const currentSpeed = speed2D(interceptorVel);
  const effectiveSpeed = Math.max(10, currentSpeed);

  let commandedTurnRate = aCommandHoriz / effectiveSpeed;
  commandedTurnRate = Math.max(-config.maxTurnRate, Math.min(config.maxTurnRate, commandedTurnRate));

  // === 11. 현재 헤딩 및 새 헤딩 계산 ===
  const currentHeading = Math.atan2(interceptorVel.vy, interceptorVel.vx);
  const newHeading = currentHeading + commandedTurnRate * deltaTime;

  // === 12. 새 속도 계산 ===
  const targetSpeed = maxSpeed;
  const newSpeed = Math.min(
    targetSpeed,
    currentSpeed + acceleration * deltaTime
  );

  const newVx = newSpeed * Math.cos(newHeading);
  const newVy = newSpeed * Math.sin(newHeading);

  // 고도 조절
  const altError = relAlt;
  const baseClimbRate = Math.sign(altError) * Math.min(10, Math.abs(altError) * 0.5);
  const pnClimbCorrection = aCommandVert * 0.3;
  const newClimbRate = Math.max(-15, Math.min(15, baseClimbRate + pnClimbCorrection));

  // === 13. 상태 업데이트 ===
  const newPnState: PNState = {
    ...pnState,
    prevLosAngle: losAngle,
    prevLosAngleVert: losAngleVert,
    lastLambdaDot: lambdaDot,
    lastLambdaDotVert: lambdaDotVert,
    lastClosingSpeed: closingSpeed,
    lastCommandedAccel: aCommandHoriz,
    prevTargetVel: { ...targetVel },
    estimatedTargetAccel: estimatedAccel,
    adaptiveNavConstant: adaptiveN,
    lastRange: range3D,
  };

  return {
    velocity: {
      vx: newVx,
      vy: newVy,
      climbRate: newClimbRate,
    },
    pnState: newPnState,
    debug: {
      losAngle,
      lambdaDot,
      closingSpeed,
      commandedAccel: aCommandHoriz,
      commandedTurnRate,
    },
  };
}

/**
 * Adaptive Navigation Constant 계산
 *
 * 거리, 접근 속도, 타겟 기동에 따라 N 값 조절:
 * - 가까울수록 N 증가 (더 민감한 반응)
 * - 타겟 기동이 심할수록 N 증가
 * - 접근 속도가 빠르면 N 약간 감소 (안정성)
 */
function computeAdaptiveN(
  range: number,
  closingSpeed: number,
  targetAccel: { ax: number; ay: number; az: number },
  config: PNConfig
): number {
  let N = config.navConstant;

  // 거리에 따른 조절
  if (range < 50) {
    N += 1.0; // 50m 이내: +1.0
  } else if (range < 100) {
    N += 0.5; // 100m 이내: +0.5
  } else if (range < 150) {
    N += 0.2; // 150m 이내: +0.2
  }

  // 타겟 기동 강도에 따른 조절
  const accelMag = Math.sqrt(targetAccel.ax ** 2 + targetAccel.ay ** 2);
  if (accelMag > 5) {
    N += 0.5; // 고기동 타겟: +0.5
  } else if (accelMag > 2) {
    N += 0.3; // 기동 중: +0.3
  }

  // 접근 속도에 따른 조절 (너무 빠르면 약간 감소)
  if (closingSpeed > 40) {
    N -= 0.3; // 고속 접근: -0.3
  } else if (closingSpeed > 30) {
    N -= 0.1; // 빠른 접근: -0.1
  }

  // 범위 제한
  return Math.max(config.minNavConstant, Math.min(config.maxNavConstant, N));
}

// ============================================
// Pure Pursuit (기존 방식)
// ============================================

/**
 * Pure Pursuit 유도 (기존 방식)
 * 단순히 목표 방향으로 직진
 */
export function computePurePursuitGuidance(
  interceptorPos: Position3D,
  interceptorVel: Velocity3D,
  targetPos: Position3D,
  targetVel: Velocity3D,
  deltaTime: number,
  maxSpeed: number,
  acceleration: number,
  leadTime: number = 2.0
): Velocity3D {
  // 목표 위치 예측
  const predictedX = targetPos.x + targetVel.vx * leadTime;
  const predictedY = targetPos.y + targetVel.vy * leadTime;
  const predictedAlt = targetPos.altitude + targetVel.climbRate * leadTime;
  
  // 상대 위치
  const dx = predictedX - interceptorPos.x;
  const dy = predictedY - interceptorPos.y;
  const dz = predictedAlt - interceptorPos.altitude;
  
  // 정규화
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.001) {
    return interceptorVel;
  }
  
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  
  // 현재 속도 및 가속
  const currentSpeed = speedMagnitude(interceptorVel);
  const targetSpeed = maxSpeed;
  const newSpeed = Math.min(targetSpeed, currentSpeed + acceleration * deltaTime);
  
  return {
    vx: nx * newSpeed,
    vy: ny * newSpeed,
    climbRate: Math.max(-15, Math.min(15, nz * newSpeed)),
  };
}

// ============================================
// 통합 유도 함수
// ============================================

export interface GuidanceInput {
  interceptorPos: Position3D;
  interceptorVel: Velocity3D;
  targetPos: Position3D;
  targetVel: Velocity3D;
  pnState: PNState;
  deltaTime: number;
  maxSpeed: number;
  acceleration: number;
}

/**
 * 유도 모드에 따라 적절한 알고리즘 선택
 */
export function computeGuidance(input: GuidanceInput): GuidanceResult {
  const { pnState } = input;

  switch (pnState.guidanceMode) {
    case 'APN':
      // Augmented PN (제안 방식)
      return computeApnGuidance(
        input.interceptorPos,
        input.interceptorVel,
        input.targetPos,
        input.targetVel,
        input.pnState,
        input.deltaTime,
        input.maxSpeed,
        input.acceleration
      );

    case 'PN':
      // Basic PN (Baseline)
      return computePnGuidance(
        input.interceptorPos,
        input.interceptorVel,
        input.targetPos,
        input.targetVel,
        input.pnState,
        input.deltaTime,
        input.maxSpeed,
        input.acceleration
      );

    case 'OPTIMAL':
      // 최적 유도 (비교용) - 현재는 APN으로 대체
      return computeApnGuidance(
        input.interceptorPos,
        input.interceptorVel,
        input.targetPos,
        input.targetVel,
        input.pnState,
        input.deltaTime,
        input.maxSpeed,
        input.acceleration
      );

    case 'PURE_PURSUIT':
    default:
      // Pure Pursuit (기본 비교)
      const velocity = computePurePursuitGuidance(
        input.interceptorPos,
        input.interceptorVel,
        input.targetPos,
        input.targetVel,
        input.deltaTime,
        input.maxSpeed,
        input.acceleration
      );

      return {
        velocity,
        pnState: input.pnState,
        debug: {
          losAngle: 0,
          lambdaDot: 0,
          closingSpeed: 0,
          commandedAccel: 0,
          commandedTurnRate: 0,
        },
      };
  }
}

// ============================================
// 디버그 및 분석용 함수
// ============================================

/**
 * PN 상태를 로깅용 객체로 변환
 */
export function pnStateToLog(state: PNState): Record<string, number | string> {
  const base = {
    guidance_mode: state.guidanceMode,
    los_angle_deg: (state.prevLosAngle * 180 / Math.PI).toFixed(2),
    lambda_dot: state.lastLambdaDot.toFixed(4),
    closing_speed: state.lastClosingSpeed.toFixed(2),
    commanded_accel: state.lastCommandedAccel.toFixed(2),
  };

  // APN 모드에서는 추가 정보
  if (state.guidanceMode === 'APN') {
    return {
      ...base,
      adaptive_n: state.adaptiveNavConstant.toFixed(2),
      target_accel_x: state.estimatedTargetAccel.ax.toFixed(2),
      target_accel_y: state.estimatedTargetAccel.ay.toFixed(2),
      range: state.lastRange.toFixed(1),
    };
  }

  return base;
}

/**
 * 유도 모드 비교 분석 (디버깅/논문용)
 */
export interface GuidanceModeComparison {
  mode: GuidanceMode;
  velocity: Velocity3D;
  commandedAccel: number;
  commandedTurnRate: number;
  adaptiveN?: number;
}

/**
 * 모든 유도 모드로 계산 후 비교 (논문 분석용)
 */
export function compareGuidanceModes(
  input: GuidanceInput
): Map<GuidanceMode, GuidanceModeComparison> {
  const results = new Map<GuidanceMode, GuidanceModeComparison>();
  const modes: GuidanceMode[] = ['PURE_PURSUIT', 'PN', 'APN'];

  for (const mode of modes) {
    // 모드별 상태 생성
    const modeState = createInitialPNState(mode);
    modeState.prevLosAngle = input.pnState.prevLosAngle;
    modeState.prevLosAngleVert = input.pnState.prevLosAngleVert;
    modeState.prevTargetVel = input.pnState.prevTargetVel;
    modeState.estimatedTargetAccel = input.pnState.estimatedTargetAccel;

    const modeInput = { ...input, pnState: modeState };
    const result = computeGuidance(modeInput);

    results.set(mode, {
      mode,
      velocity: result.velocity,
      commandedAccel: result.debug.commandedAccel,
      commandedTurnRate: result.debug.commandedTurnRate,
      adaptiveN: mode === 'APN' ? result.pnState.adaptiveNavConstant : undefined,
    });
  }

  return results;
}

