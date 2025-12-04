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

/** 유도 모드 */
export type GuidanceMode = 
  | 'PURE_PURSUIT'  // 기존 직선 추격
  | 'PN';           // Proportional Navigation

/** PN 유도 설정 */
export interface PNConfig {
  navConstant: number;      // Navigation constant (N), 보통 3~5
  maxTurnRate: number;      // 최대 선회율 (rad/s)
  minClosingSpeed: number;  // 최소 접근 속도 (m/s)
  leadTimeFactor: number;   // 예측 시간 계수
}

/** 기본 PN 설정 */
export const DEFAULT_PN_CONFIG: PNConfig = {
  navConstant: 3.0,        // 3.0으로 조정 (더 안정적인 추격)
  maxTurnRate: Math.PI * 1.5,  // 270 deg/s - 더 빠른 반응
  minClosingSpeed: 10.0,   // 최소 10 m/s - 더 적극적 접근
  leadTimeFactor: 2.0,     // 예측 시간 계수 증가
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
}

/** 기본 PN 상태 초기값 */
export function createInitialPNState(mode: GuidanceMode = 'PN'): PNState {
  return {
    prevLosAngle: 0,
    prevLosAngleVert: 0,
    lastLambdaDot: 0,
    lastLambdaDotVert: 0,
    lastClosingSpeed: 0,
    lastCommandedAccel: 0,
    guidanceMode: mode,
    pnConfig: getPNConfig(),  // 런타임 파라미터 적용
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
  
  if (pnState.guidanceMode === 'PN') {
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
  } else {
    // Pure Pursuit
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
  return {
    guidance_mode: state.guidanceMode,
    los_angle_deg: (state.prevLosAngle * 180 / Math.PI).toFixed(2),
    lambda_dot: state.lastLambdaDot.toFixed(4),
    closing_speed: state.lastClosingSpeed.toFixed(2),
    commanded_accel: state.lastCommandedAccel.toFixed(2),
  };
}

