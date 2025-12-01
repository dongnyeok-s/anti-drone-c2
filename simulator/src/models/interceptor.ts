/**
 * 요격 드론 행동 모델 (확장판)
 * 
 * 상태:
 * - IDLE: 대기
 * - SCRAMBLE: 출격
 * - PURSUING: 추격 중
 * - RECON: 정찰 모드 (EO 카메라)
 * - INTERCEPT_RAM: 충돌 요격 중
 * - INTERCEPT_GUN: 사격 요격 중
 * - INTERCEPT_NET: 그물 요격 중
 * - INTERCEPT_JAM: 재밍 요격 중
 * - RETURNING: 귀환 중
 * - NEUTRALIZED: 무력화
 * 
 * 요격 방식:
 * - RAM: 충돌 요격 (최대 속도 접근)
 * - GUN: 사격 요격 (100~400m 거리)
 * - NET: 그물 요격 (<100m 거리)
 * - JAM: 전자전 재밍 (50~300m, 시간 누적)
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  InterceptorState as SharedInterceptorState, 
  InterceptorConfig, 
  DEFAULT_INTERCEPTOR_CONFIG 
} from '../../../shared/schemas';
import { 
  InterceptMethod, 
  InterceptorState,
  INTERCEPT_METHOD_CONFIG,
  InterceptFailureReason,
  Classification,
  DroneSize,
  DroneType,
  EOConfirmationEvent,
} from '../core/logging/eventSchemas';
import { InterceptorDrone, HostileDrone, Position3D, Velocity3D } from '../types';

// ============================================
// 확장된 요격 드론 타입
// ============================================

export interface ExtendedInterceptorDrone extends InterceptorDrone {
  state: InterceptorState;
  method?: InterceptMethod;          // 현재 요격 방식
  reconStartTime?: number;           // 정찰 시작 시간
  reconDuration?: number;            // 정찰 소요 시간
  eoConfirmed?: boolean;             // EO 정찰 완료 여부
  jamDuration?: number;              // 재밍 누적 시간
  gunAttempts?: number;              // 사격 시도 횟수
  maxGunAttempts?: number;           // 최대 사격 시도
}

// ============================================
// 유틸리티 함수
// ============================================

function distance3D(p1: Position3D, p2: Position3D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.altitude - p1.altitude;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalize3D(dx: number, dy: number, dz: number): { nx: number; ny: number; nz: number } {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.001) return { nx: 0, ny: 0, nz: 0 };
  return { nx: dx / len, ny: dy / len, nz: dz / len };
}

function predictTargetPosition(target: HostileDrone, seconds: number): Position3D {
  return {
    x: target.position.x + target.velocity.vx * seconds,
    y: target.position.y + target.velocity.vy * seconds,
    altitude: target.position.altitude + target.velocity.climbRate * seconds,
  };
}

// ============================================
// 생성 및 발진
// ============================================

export function createInterceptor(
  basePosition: Position3D,
  config: InterceptorConfig = DEFAULT_INTERCEPTOR_CONFIG
): ExtendedInterceptorDrone {
  return {
    id: `INT-${uuidv4().substring(0, 4).toUpperCase()}`,
    position: { ...basePosition, altitude: basePosition.altitude + 10 },
    velocity: { vx: 0, vy: 0, climbRate: 0 },
    state: 'IDLE',
    config,
    targetId: null,
    launchTime: null,
    method: undefined,
    reconStartTime: undefined,
    reconDuration: undefined,
    eoConfirmed: false,
    jamDuration: 0,
    gunAttempts: 0,
    maxGunAttempts: 5,
  };
}

/**
 * 요격 드론 발진 (방식 지정)
 */
export function launchInterceptor(
  interceptor: ExtendedInterceptorDrone,
  targetId: string,
  currentTime: number,
  method: InterceptMethod = 'RAM'
): ExtendedInterceptorDrone {
  if (interceptor.state !== 'IDLE' && interceptor.state !== 'STANDBY') {
    return interceptor;
  }

  return {
    ...interceptor,
    state: 'SCRAMBLE',
    targetId,
    launchTime: currentTime,
    method,
    jamDuration: 0,
    gunAttempts: 0,
    eoConfirmed: false,
  };
}

/**
 * 정찰 명령
 */
export function startRecon(
  interceptor: ExtendedInterceptorDrone,
  targetId: string,
  currentTime: number
): ExtendedInterceptorDrone {
  if (interceptor.state !== 'IDLE' && interceptor.state !== 'STANDBY') {
    // 이미 추격 중이면 정찰 모드로 전환
    if (interceptor.state === 'PURSUING') {
      return {
        ...interceptor,
        state: 'RECON',
        reconStartTime: currentTime,
        targetId,
      };
    }
    return interceptor;
  }

  return {
    ...interceptor,
    state: 'SCRAMBLE',
    targetId,
    launchTime: currentTime,
    method: undefined, // 정찰만 수행
    reconStartTime: undefined,
    eoConfirmed: false,
  };
}

// ============================================
// 업데이트 결과 타입
// ============================================

export interface InterceptorUpdateResult {
  interceptor: ExtendedInterceptorDrone;
  interceptResult: 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED' | null;
  failureReason?: InterceptFailureReason;
  eoConfirmation?: EOConfirmationEvent;
}

// ============================================
// 메인 업데이트 함수
// ============================================

export function updateInterceptor(
  interceptor: ExtendedInterceptorDrone,
  deltaTime: number,
  target: HostileDrone | null,
  basePosition: Position3D,
  currentTime: number
): InterceptorUpdateResult {
  if (interceptor.state === 'NEUTRALIZED' || interceptor.state === 'IDLE' || interceptor.state === 'STANDBY') {
    return { interceptor, interceptResult: null };
  }

  let updated: ExtendedInterceptorDrone = { ...interceptor };
  let interceptResult: 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED' | null = null;
  let failureReason: InterceptFailureReason | undefined;
  let eoConfirmation: EOConfirmationEvent | undefined;

  switch (updated.state) {
    case 'SCRAMBLE':
      // 발진 후 2초 뒤 추격 또는 정찰 모드
      if (currentTime - (updated.launchTime || 0) > 2) {
        if (updated.method === undefined) {
          // 정찰 모드로 전환
          updated.state = 'PURSUING'; // 먼저 접근
        } else {
          updated.state = 'PURSUING';
        }
      }
      updated.velocity = { vx: 0, vy: 0, climbRate: updated.config.climb_rate };
      break;

    case 'PURSUING':
      if (!target || target.isNeutralized) {
        updated.state = 'RETURNING';
        updated.targetId = null;
        interceptResult = 'ABORTED';
        failureReason = 'target_lost';
        break;
      }

      updated = pursueTarget(updated, target, deltaTime);
      const distToTarget = distance3D(updated.position, target.position);

      // 정찰 모드 진입 (150m 이내)
      if (!updated.method && distToTarget < 150 && !updated.eoConfirmed) {
        updated.state = 'RECON';
        updated.reconStartTime = currentTime;
        break;
      }

      // 요격 모드 진입
      if (updated.method) {
        const methodConfig = INTERCEPT_METHOD_CONFIG[updated.method];
        if (distToTarget < methodConfig.max_distance) {
          updated.state = getInterceptState(updated.method);
        }
      }
      break;

    case 'RECON':
      if (!target || target.isNeutralized) {
        updated.state = 'RETURNING';
        updated.targetId = null;
        break;
      }

      // 정찰 선회 (타겟 주변)
      updated = orbitTarget(updated, target, deltaTime, 120); // 120m 거리 유지

      // 3초 후 EO 확인 완료
      const reconTime = currentTime - (updated.reconStartTime || currentTime);
      if (reconTime > 3 && !updated.eoConfirmed) {
        updated.eoConfirmed = true;
        updated.reconDuration = reconTime;
        
        // EO 확인 이벤트 생성
        eoConfirmation = generateEOConfirmation(
          updated,
          target,
          currentTime
        );

        // 정찰만 하는 경우 귀환
        if (!updated.method) {
          updated.state = 'RETURNING';
        } else {
          // 요격 모드로 전환
          updated.state = 'PURSUING';
        }
      }
      break;

    case 'INTERCEPT_RAM':
      ({ updated, interceptResult, failureReason } = handleRamIntercept(
        updated, target, deltaTime, basePosition
      ));
      break;

    case 'INTERCEPT_GUN':
      ({ updated, interceptResult, failureReason } = handleGunIntercept(
        updated, target, deltaTime, basePosition, currentTime
      ));
      break;

    case 'INTERCEPT_NET':
      ({ updated, interceptResult, failureReason } = handleNetIntercept(
        updated, target, deltaTime, basePosition
      ));
      break;

    case 'INTERCEPT_JAM':
      ({ updated, interceptResult, failureReason } = handleJamIntercept(
        updated, target, deltaTime, basePosition
      ));
      break;

    case 'RETURNING':
      updated = returnToBase(updated, basePosition, deltaTime);
      const distToBase = distance3D(updated.position, basePosition);
      if (distToBase < 20) {
        updated.state = 'IDLE';
        updated.velocity = { vx: 0, vy: 0, climbRate: 0 };
        updated.position = { ...basePosition, altitude: basePosition.altitude + 10 };
        updated.method = undefined;
        updated.jamDuration = 0;
        updated.gunAttempts = 0;
      }
      break;
  }

  // 위치 업데이트
  updated.position = {
    x: updated.position.x + updated.velocity.vx * deltaTime,
    y: updated.position.y + updated.velocity.vy * deltaTime,
    altitude: Math.max(10, updated.position.altitude + updated.velocity.climbRate * deltaTime),
  };

  return { interceptor: updated, interceptResult, failureReason, eoConfirmation };
}

// ============================================
// 요격 방식별 핸들러
// ============================================

function getInterceptState(method: InterceptMethod): InterceptorState {
  switch (method) {
    case 'RAM': return 'INTERCEPT_RAM';
    case 'GUN': return 'INTERCEPT_GUN';
    case 'NET': return 'INTERCEPT_NET';
    case 'JAM': return 'INTERCEPT_JAM';
    default: return 'INTERCEPT_RAM';
  }
}

/**
 * RAM 요격 (충돌)
 */
function handleRamIntercept(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone | null,
  deltaTime: number,
  basePosition: Position3D
): { updated: ExtendedInterceptorDrone; interceptResult: 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED' | null; failureReason?: InterceptFailureReason } {
  let updated = { ...interceptor };
  
  if (!target || target.isNeutralized) {
    updated.state = 'RETURNING';
    updated.targetId = null;
    return { updated, interceptResult: 'ABORTED', failureReason: 'target_lost' };
  }

  // 최대 속도로 추격
  updated = pursueTarget(updated, target, deltaTime, 1.2); // 20% 부스트

  const dist = distance3D(updated.position, target.position);
  const config = INTERCEPT_METHOD_CONFIG.RAM;

  if (dist < config.max_distance) {
    // 요격 판정
    const prob = calculateMethodProbability(updated, target, 'RAM');
    
    if (Math.random() < prob) {
      updated.state = 'RETURNING';
      return { updated, interceptResult: 'SUCCESS' };
    } else {
      updated.state = 'RETURNING';
      const reason: InterceptFailureReason = target.isEvading ? 'evaded' : 'collision_avoided';
      return { updated, interceptResult: target.isEvading ? 'EVADED' : 'MISS', failureReason: reason };
    }
  }

  return { updated, interceptResult: null };
}

/**
 * GUN 요격 (사격)
 */
function handleGunIntercept(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone | null,
  deltaTime: number,
  basePosition: Position3D,
  currentTime: number
): { updated: ExtendedInterceptorDrone; interceptResult: 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED' | null; failureReason?: InterceptFailureReason } {
  let updated = { ...interceptor };
  
  if (!target || target.isNeutralized) {
    updated.state = 'RETURNING';
    updated.targetId = null;
    return { updated, interceptResult: 'ABORTED', failureReason: 'target_lost' };
  }

  const dist = distance3D(updated.position, target.position);
  const config = INTERCEPT_METHOD_CONFIG.GUN;

  // 적정 거리 유지하며 추격
  if (dist > config.max_distance) {
    updated = pursueTarget(updated, target, deltaTime);
  } else if (dist < config.min_distance) {
    // 너무 가까우면 거리 벌리기
    updated = maintainDistance(updated, target, deltaTime, config.min_distance + 50);
  } else {
    // 사격 거리 - 사격 시도
    updated.gunAttempts = (updated.gunAttempts || 0) + 1;
    
    if ((updated.gunAttempts || 0) >= (updated.maxGunAttempts || 5)) {
      // 최대 시도 초과
      updated.state = 'RETURNING';
      return { updated, interceptResult: 'MISS', failureReason: 'gun_missed' };
    }

    const prob = calculateMethodProbability(updated, target, 'GUN');
    
    if (Math.random() < prob * deltaTime * 2) { // 시간당 성공 확률
      updated.state = 'RETURNING';
      return { updated, interceptResult: 'SUCCESS' };
    }

    // 추적 유지
    updated = orbitTarget(updated, target, deltaTime, 200);
  }

  return { updated, interceptResult: null };
}

/**
 * NET 요격 (그물)
 */
function handleNetIntercept(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone | null,
  deltaTime: number,
  basePosition: Position3D
): { updated: ExtendedInterceptorDrone; interceptResult: 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED' | null; failureReason?: InterceptFailureReason } {
  let updated = { ...interceptor };
  
  if (!target || target.isNeutralized) {
    updated.state = 'RETURNING';
    updated.targetId = null;
    return { updated, interceptResult: 'ABORTED', failureReason: 'target_lost' };
  }

  const dist = distance3D(updated.position, target.position);
  const config = INTERCEPT_METHOD_CONFIG.NET;

  // 근접 접근
  updated = pursueTarget(updated, target, deltaTime, 0.8); // 천천히

  if (dist < config.max_distance) {
    // 그물 발사 판정
    const prob = calculateMethodProbability(updated, target, 'NET');
    
    if (Math.random() < prob) {
      updated.state = 'RETURNING';
      return { updated, interceptResult: 'SUCCESS' };
    } else {
      updated.state = 'RETURNING';
      return { updated, interceptResult: target.isEvading ? 'EVADED' : 'MISS', failureReason: 'net_missed' };
    }
  }

  return { updated, interceptResult: null };
}

/**
 * JAM 요격 (전자전)
 */
function handleJamIntercept(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone | null,
  deltaTime: number,
  basePosition: Position3D
): { updated: ExtendedInterceptorDrone; interceptResult: 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED' | null; failureReason?: InterceptFailureReason } {
  let updated = { ...interceptor };
  
  if (!target || target.isNeutralized) {
    updated.state = 'RETURNING';
    updated.targetId = null;
    return { updated, interceptResult: 'ABORTED', failureReason: 'target_lost' };
  }

  const dist = distance3D(updated.position, target.position);
  const config = INTERCEPT_METHOD_CONFIG.JAM;

  // 재밍 거리 유지
  if (dist > config.max_distance) {
    updated = pursueTarget(updated, target, deltaTime);
  } else if (dist < config.min_distance) {
    updated = maintainDistance(updated, target, deltaTime, config.min_distance + 30);
  } else {
    // 재밍 중 - 시간 누적
    updated.jamDuration = (updated.jamDuration || 0) + deltaTime;
    
    // 거리 유지하며 추적
    updated = orbitTarget(updated, target, deltaTime, 150);

    // 필요 시간 도달 시 판정
    const requiredTime = config.jam_duration_required || 5;
    if ((updated.jamDuration || 0) >= requiredTime) {
      const prob = calculateMethodProbability(updated, target, 'JAM');
      
      if (Math.random() < prob) {
        updated.state = 'RETURNING';
        return { updated, interceptResult: 'SUCCESS' };
      } else {
        updated.state = 'RETURNING';
        return { updated, interceptResult: 'MISS', failureReason: 'jam_failed' };
      }
    }
  }

  return { updated, interceptResult: null };
}

// ============================================
// 이동 로직
// ============================================

function pursueTarget(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone,
  deltaTime: number,
  speedMultiplier: number = 1
): ExtendedInterceptorDrone {
  const predictedPosition = predictTargetPosition(target, 2);

  const dx = predictedPosition.x - interceptor.position.x;
  const dy = predictedPosition.y - interceptor.position.y;
  const dz = predictedPosition.altitude - interceptor.position.altitude;
  const { nx, ny, nz } = normalize3D(dx, dy, dz);

  const currentSpeed = Math.sqrt(
    interceptor.velocity.vx ** 2 + 
    interceptor.velocity.vy ** 2 + 
    interceptor.velocity.climbRate ** 2
  );

  const targetSpeed = interceptor.config.max_speed * speedMultiplier;
  const newSpeed = Math.min(
    targetSpeed,
    currentSpeed + interceptor.config.acceleration * deltaTime
  );

  return {
    ...interceptor,
    velocity: {
      vx: nx * newSpeed,
      vy: ny * newSpeed,
      climbRate: Math.max(
        -interceptor.config.climb_rate,
        Math.min(interceptor.config.climb_rate, nz * newSpeed)
      ),
    },
  };
}

function orbitTarget(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone,
  deltaTime: number,
  orbitDistance: number
): ExtendedInterceptorDrone {
  const dx = target.position.x - interceptor.position.x;
  const dy = target.position.y - interceptor.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // 접선 방향 + 거리 조절
  const ux = dx / dist;
  const uy = dy / dist;
  
  // 접선 방향 (90도 회전)
  const tx = -uy;
  const ty = ux;
  
  // 거리 조절 벡터
  const distError = dist - orbitDistance;
  const radialFactor = Math.max(-0.5, Math.min(0.5, distError / 100));
  
  const speed = interceptor.config.max_speed * 0.6;
  const vx = (tx * 0.8 + ux * radialFactor) * speed;
  const vy = (ty * 0.8 + uy * radialFactor) * speed;

  // 고도 조절
  const altDiff = target.position.altitude - interceptor.position.altitude;
  const climbRate = Math.max(-5, Math.min(5, altDiff * 0.3));

  return {
    ...interceptor,
    velocity: { vx, vy, climbRate },
  };
}

function maintainDistance(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone,
  deltaTime: number,
  desiredDistance: number
): ExtendedInterceptorDrone {
  const dx = interceptor.position.x - target.position.x;
  const dy = interceptor.position.y - target.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const { nx, ny } = normalize3D(dx, dy, 0);

  const speed = interceptor.config.max_speed * 0.5;

  return {
    ...interceptor,
    velocity: {
      vx: nx * speed,
      vy: ny * speed,
      climbRate: 0,
    },
  };
}

function returnToBase(
  interceptor: ExtendedInterceptorDrone,
  basePosition: Position3D,
  deltaTime: number
): ExtendedInterceptorDrone {
  const dx = basePosition.x - interceptor.position.x;
  const dy = basePosition.y - interceptor.position.y;
  const dz = basePosition.altitude - interceptor.position.altitude;
  const { nx, ny, nz } = normalize3D(dx, dy, dz);

  const returnSpeed = interceptor.config.max_speed * 0.7;

  return {
    ...interceptor,
    velocity: {
      vx: nx * returnSpeed,
      vy: ny * returnSpeed,
      climbRate: Math.max(-5, Math.min(5, nz * returnSpeed)),
    },
  };
}

// ============================================
// 확률 계산
// ============================================

function calculateMethodProbability(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone,
  method: InterceptMethod
): number {
  const config = INTERCEPT_METHOD_CONFIG[method];
  let prob = config.base_success_rate;

  // 상대 속도 영향
  const relativeSpeed = Math.sqrt(
    (interceptor.velocity.vx - target.velocity.vx) ** 2 +
    (interceptor.velocity.vy - target.velocity.vy) ** 2
  );
  prob -= relativeSpeed * config.speed_factor * 0.01;

  // 회피 상태 영향
  if (target.isEvading) {
    prob *= (1 - config.evade_penalty);
  }

  // 거리 영향
  const dist = distance3D(interceptor.position, target.position);
  const optimalDist = (config.min_distance + config.max_distance) / 2;
  const distFactor = 1 - Math.abs(dist - optimalDist) / config.max_distance * 0.3;
  prob *= distFactor;

  return Math.max(0.05, Math.min(0.95, prob));
}

// ============================================
// EO 확인 이벤트 생성
// ============================================

function generateEOConfirmation(
  interceptor: ExtendedInterceptorDrone,
  target: HostileDrone,
  currentTime: number
): EOConfirmationEvent {
  // Ground truth 기반 + 노이즈
  const misclassificationProb = 0.1; // 10% 오분류
  
  let classification: Classification = target.is_hostile ? 'HOSTILE' : 'FRIENDLY';
  if (Math.random() < misclassificationProb) {
    classification = 'UNKNOWN';
  }

  // armed 추정 (드론 속성에서)
  const armed = (target as any).armed ?? (Math.random() > 0.5);

  // 크기 추정
  const sizes: DroneSize[] = ['SMALL', 'MEDIUM', 'LARGE'];
  const sizeClass = (target as any).size_class ?? sizes[Math.floor(Math.random() * 3)];

  // 드론 타입 추정
  const droneType = (target as any).drone_type ?? 'UNKNOWN';

  // 신뢰도 (거리 기반)
  const dist = distance3D(interceptor.position, target.position);
  const confidence = Math.max(0.5, Math.min(0.95, 1 - dist / 300));

  return {
    timestamp: currentTime,
    event: 'eo_confirmation',
    drone_id: target.id,
    interceptor_id: interceptor.id,
    classification,
    armed,
    size_class: sizeClass,
    drone_type: droneType,
    confidence: Math.round(confidence * 100) / 100,
    sensor: 'EO',
    recon_duration: interceptor.reconDuration,
  };
}

// ============================================
// 리셋
// ============================================

export function resetInterceptor(
  interceptor: ExtendedInterceptorDrone,
  basePosition: Position3D
): ExtendedInterceptorDrone {
  return {
    ...interceptor,
    position: { ...basePosition, altitude: basePosition.altitude + 10 },
    velocity: { vx: 0, vy: 0, climbRate: 0 },
    state: 'IDLE',
    targetId: null,
    launchTime: null,
    method: undefined,
    reconStartTime: undefined,
    reconDuration: undefined,
    eoConfirmed: false,
    jamDuration: 0,
    gunAttempts: 0,
  };
}
