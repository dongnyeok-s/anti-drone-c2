/**
 * 시뮬레이터 내부 타입 정의
 */

import {
  HostileDroneBehavior,
  InterceptorState,
  RadarConfig,
  InterceptorConfig,
  HostileDroneConfig,
} from '../../shared/schemas';

/** 3D 위치 */
export interface Position3D {
  x: number;
  y: number;
  altitude: number;
}

/** 3D 속도 */
export interface Velocity3D {
  vx: number;
  vy: number;
  climbRate: number;
}

/** 드론 타입 */
export type DroneType = 
  | 'RECON_UAV' | 'ATTACK_UAV' | 'LOITER_MUNITION' 
  | 'CARGO_UAV' | 'CIVILIAN' | 'UNKNOWN';

/** 드론 크기 */
export type DroneSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** Ground truth 레이블 (정답 레이블) */
export type TrueLabel = 'HOSTILE' | 'CIVIL' | 'UNKNOWN';

/** 적 드론 시뮬레이션 객체 */
export interface HostileDrone {
  id: string;
  position: Position3D;
  velocity: Velocity3D;
  behavior: HostileDroneBehavior;
  config: HostileDroneConfig;
  isEvading: boolean;
  targetPosition?: Position3D;  // 목표 지점 (RECON, ATTACK_RUN 모드용)
  spawnTime: number;
  lastRadarDetection: number;
  isNeutralized: boolean;
  
  // Ground truth 레이블 (정답 레이블) - 시뮬레이션 동안 변하지 않음
  true_label: TrueLabel;
  
  // 확장 속성
  is_hostile?: boolean;          // 적대성 여부
  drone_type?: DroneType;        // 드론 타입
  armed?: boolean;               // 무장 여부
  size_class?: DroneSize;        // 크기 분류
  recommended_method?: string;   // 권장 요격 방식
}

/** 요격 드론 시뮬레이션 객체 */
export interface InterceptorDrone {
  id: string;
  position: Position3D;
  velocity: Velocity3D;
  state: InterceptorState;
  config: InterceptorConfig;
  targetId: string | null;
  launchTime: number | null;
}

/** 시뮬레이션 전체 상태 */
export interface SimulationWorld {
  time: number;
  isRunning: boolean;
  speedMultiplier: number;
  tickInterval: number;       // 밀리초
  hostileDrones: Map<string, HostileDrone>;
  interceptors: Map<string, InterceptorDrone>;
  radarConfig: RadarConfig;
  basePosition: Position3D;   // 아군 기지 위치
}

/** 시뮬레이션 이벤트 큐 아이템 */
export interface EventQueueItem {
  time: number;
  event: unknown;
}

