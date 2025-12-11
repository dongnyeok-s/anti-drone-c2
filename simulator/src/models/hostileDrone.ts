/**
 * 적 드론 행동 모델
 * 
 * 행동 모드:
 * - NORMAL: 직선 비행
 * - RECON: 목표 상공 선회
 * - ATTACK_RUN: 저고도 급접근
 * - EVADE: 요격 탐지 시 급선회 + 가속
 */

import { HostileDroneBehavior, HostileDroneConfig, DEFAULT_HOSTILE_DRONE_CONFIG } from '../../../shared/schemas';
import { HostileDrone, Position3D, Velocity3D, InterceptorDrone, TrueLabel } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * 두 위치 간 거리 계산
 */
function distance3D(p1: Position3D, p2: Position3D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.altitude - p1.altitude;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 두 위치 간 2D 거리 (수평)
 */
function distance2D(p1: Position3D, p2: Position3D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 방향 벡터 정규화
 */
function normalize(vx: number, vy: number): { nx: number; ny: number } {
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len < 0.001) return { nx: 0, ny: 0 };
  return { nx: vx / len, ny: vy / len };
}

/**
 * 적 드론 생성
 */
export function createHostileDrone(
  position: Position3D,
  velocity: Velocity3D,
  behavior: HostileDroneBehavior = 'NORMAL',
  config: HostileDroneConfig = DEFAULT_HOSTILE_DRONE_CONFIG,
  targetPosition?: Position3D,
  trueLabel: TrueLabel = 'HOSTILE'  // 기본값: HOSTILE
): HostileDrone {
  return {
    id: `HOSTILE-${uuidv4().substring(0, 6).toUpperCase()}`,
    position: { ...position },
    velocity: { ...velocity },
    behavior,
    config,
    isEvading: false,
    targetPosition,
    spawnTime: 0,
    lastRadarDetection: 0,
    isNeutralized: false,
    true_label: trueLabel,  // Ground truth 레이블
  };
}

/**
 * 적 드론 행동 업데이트 (한 틱)
 */
export function updateHostileDrone(
  drone: HostileDrone,
  deltaTime: number,
  basePosition: Position3D,
  interceptors: Map<string, InterceptorDrone>
): HostileDrone {
  if (drone.isNeutralized) return drone;

  let updatedDrone = { ...drone };
  
  // 요격 드론 접근 체크 → 회피 모드 전환
  const nearestInterceptor = findNearestPursuingInterceptor(drone, interceptors);
  if (nearestInterceptor) {
    const distToInterceptor = distance3D(drone.position, nearestInterceptor.position);
    if (distToInterceptor < drone.config.evasion_trigger_distance) {
      updatedDrone.isEvading = true;
      updatedDrone.behavior = 'EVADE';
    }
  } else if (drone.isEvading && !nearestInterceptor) {
    // 요격 드론이 없으면 회피 모드 해제
    updatedDrone.isEvading = false;
    updatedDrone.behavior = 'NORMAL';
  }

  // 행동 모드별 속도 업데이트
  switch (updatedDrone.behavior) {
    case 'NORMAL':
      updatedDrone = updateNormalBehavior(updatedDrone, deltaTime, basePosition);
      break;
    case 'RECON':
      updatedDrone = updateReconBehavior(updatedDrone, deltaTime);
      break;
    case 'ATTACK_RUN':
      updatedDrone = updateAttackRunBehavior(updatedDrone, deltaTime, basePosition);
      break;
    case 'EVADE':
      if (nearestInterceptor) {
        updatedDrone = updateEvadeBehavior(updatedDrone, deltaTime, nearestInterceptor);
      } else {
        // 요격 드론이 없으면 NORMAL 행동으로 대체
        updatedDrone = updateNormalBehavior(updatedDrone, deltaTime, basePosition);
        updatedDrone.isEvading = false;
      }
      break;
  }

  // 위치 업데이트
  updatedDrone.position = {
    x: updatedDrone.position.x + updatedDrone.velocity.vx * deltaTime,
    y: updatedDrone.position.y + updatedDrone.velocity.vy * deltaTime,
    altitude: Math.max(10, updatedDrone.position.altitude + updatedDrone.velocity.climbRate * deltaTime),
  };

  return updatedDrone;
}

/**
 * 가장 가까운 추격 중인 요격 드론 찾기
 */
function findNearestPursuingInterceptor(
  drone: HostileDrone,
  interceptors: Map<string, InterceptorDrone>
): InterceptorDrone | null {
  let nearest: InterceptorDrone | null = null;
  let minDist = Infinity;

  interceptors.forEach((interceptor) => {
    if (interceptor.state === 'PURSUING' || interceptor.state === 'ENGAGING') {
      if (interceptor.targetId === drone.id) {
        const dist = distance3D(drone.position, interceptor.position);
        if (dist < minDist) {
          minDist = dist;
          nearest = interceptor;
        }
      }
    }
  });

  return nearest;
}

/**
 * NORMAL 모드: 직선 비행 (기지 방향)
 */
function updateNormalBehavior(
  drone: HostileDrone,
  deltaTime: number,
  basePosition: Position3D
): HostileDrone {
  const dx = basePosition.x - drone.position.x;
  const dy = basePosition.y - drone.position.y;
  const { nx, ny } = normalize(dx, dy);

  const targetSpeed = drone.config.cruise_speed;
  const currentSpeed = Math.sqrt(drone.velocity.vx ** 2 + drone.velocity.vy ** 2);

  // 부드러운 가속
  const newSpeed = Math.min(
    targetSpeed,
    currentSpeed + drone.config.acceleration * deltaTime
  );

  return {
    ...drone,
    velocity: {
      vx: nx * newSpeed,
      vy: ny * newSpeed,
      climbRate: drone.velocity.climbRate * 0.95, // 서서히 수평 비행
    },
  };
}

/**
 * RECON 모드: 목표 상공 선회
 */
function updateReconBehavior(drone: HostileDrone, deltaTime: number): HostileDrone {
  const target = drone.targetPosition || { x: 0, y: 0, altitude: 150 };
  const dist = distance2D(drone.position, target);

  // 선회 반경 (100m)
  const orbitRadius = 100;
  const orbitSpeed = drone.config.cruise_speed * 0.7;

  if (dist > orbitRadius + 50) {
    // 선회 지점으로 이동
    const dx = target.x - drone.position.x;
    const dy = target.y - drone.position.y;
    const { nx, ny } = normalize(dx, dy);
    return {
      ...drone,
      velocity: {
        vx: nx * orbitSpeed,
        vy: ny * orbitSpeed,
        climbRate: (target.altitude - drone.position.altitude) * 0.1,
      },
    };
  } else {
    // 선회 비행
    const angle = Math.atan2(drone.position.y - target.y, drone.position.x - target.x);
    const angularVelocity = orbitSpeed / orbitRadius;
    const newAngle = angle + angularVelocity * deltaTime;

    return {
      ...drone,
      velocity: {
        vx: -Math.sin(newAngle) * orbitSpeed,
        vy: Math.cos(newAngle) * orbitSpeed,
        climbRate: (target.altitude - drone.position.altitude) * 0.05,
      },
    };
  }
}

/**
 * ATTACK_RUN 모드: 저고도 급접근
 */
function updateAttackRunBehavior(
  drone: HostileDrone,
  deltaTime: number,
  basePosition: Position3D
): HostileDrone {
  const dx = basePosition.x - drone.position.x;
  const dy = basePosition.y - drone.position.y;
  const { nx, ny } = normalize(dx, dy);

  const targetSpeed = drone.config.max_speed;
  const currentSpeed = Math.sqrt(drone.velocity.vx ** 2 + drone.velocity.vy ** 2);
  const newSpeed = Math.min(targetSpeed, currentSpeed + drone.config.acceleration * deltaTime);

  // 저고도 유지 (50m)
  const targetAltitude = 50;
  const climbRate = (targetAltitude - drone.position.altitude) * 0.3;

  return {
    ...drone,
    velocity: {
      vx: nx * newSpeed,
      vy: ny * newSpeed,
      climbRate: Math.max(-10, Math.min(10, climbRate)),
    },
  };
}

/**
 * EVADE 모드: 급선회 + 가속
 */
function updateEvadeBehavior(
  drone: HostileDrone,
  deltaTime: number,
  interceptor: InterceptorDrone
): HostileDrone {
  // 요격 드론 반대 방향 + 90도 선회
  const dx = drone.position.x - interceptor.position.x;
  const dy = drone.position.y - interceptor.position.y;
  const { nx, ny } = normalize(dx, dy);

  // 90도 회전 (랜덤하게 좌/우)
  const turnDirection = drone.id.charCodeAt(0) % 2 === 0 ? 1 : -1;
  const evadeNx = nx * Math.cos(Math.PI / 4 * turnDirection) - ny * Math.sin(Math.PI / 4 * turnDirection);
  const evadeNy = nx * Math.sin(Math.PI / 4 * turnDirection) + ny * Math.cos(Math.PI / 4 * turnDirection);

  const evasionSpeed = drone.config.max_speed * drone.config.evasion_maneuver_strength;
  const currentSpeed = Math.sqrt(drone.velocity.vx ** 2 + drone.velocity.vy ** 2);
  const newSpeed = Math.min(evasionSpeed, currentSpeed + drone.config.acceleration * 2 * deltaTime);

  // 급상승/급하강 (랜덤)
  const climbRate = (Math.random() > 0.5 ? 1 : -1) * 5;

  return {
    ...drone,
    velocity: {
      vx: evadeNx * newSpeed,
      vy: evadeNy * newSpeed,
      climbRate,
    },
  };
}

/**
 * 행동 모드 강제 변경
 */
export function setDroneBehavior(
  drone: HostileDrone,
  behavior: HostileDroneBehavior,
  targetPosition?: Position3D
): HostileDrone {
  return {
    ...drone,
    behavior,
    targetPosition: targetPosition || drone.targetPosition,
    isEvading: behavior === 'EVADE',
  };
}

