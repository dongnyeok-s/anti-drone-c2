/**
 * 드론 제어 인터페이스
 *
 * INTERNAL 모드와 EXTERNAL_AIRSIM 모드를 추상화
 */

import {
  HostileDroneBehavior,
  HostileDroneConfig,
  InterceptorConfig,
  InterceptMethod,
  InterceptResult,
  GuidanceMode,
} from '../../../shared/schemas';
import {
  HostileDrone,
  InterceptorDrone,
  Position3D,
  Velocity3D,
  TrueLabel,
} from '../types';

/**
 * 드론 생성 설정
 */
export interface DroneSpawnConfig {
  position: Position3D;
  velocity: Velocity3D;
  behavior: HostileDroneBehavior;
  config: HostileDroneConfig;
  targetPosition?: Position3D;
  trueLabel: TrueLabel;
}

/**
 * 요격 드론 생성 설정
 */
export interface InterceptorSpawnConfig {
  position: Position3D;
  config: InterceptorConfig;
}

/**
 * 드론 제어 명령
 */
export interface DroneCommand {
  velocity?: Velocity3D;
  targetPosition?: Position3D;
  behavior?: HostileDroneBehavior;
}

/**
 * 요격 드론 제어 명령
 */
export interface InterceptorCommand {
  targetId?: string | null;
  guidanceMode?: GuidanceMode;
  method?: InterceptMethod;
}

/**
 * 드론 제어자 인터페이스
 *
 * 모든 드론 제어 구현체는 이 인터페이스를 따라야 함
 */
export interface IDroneController {
  // ============================================
  // 적 드론 관리
  // ============================================

  /**
   * 적 드론 생성
   *
   * @param config 드론 생성 설정
   * @returns 생성된 드론 ID
   */
  spawnHostileDrone(config: DroneSpawnConfig): Promise<string>;

  /**
   * 적 드론 제거
   *
   * @param droneId 드론 ID
   */
  removeHostileDrone(droneId: string): Promise<void>;

  /**
   * 적 드론 상태 조회
   *
   * @param droneId 드론 ID
   * @returns 드론 상태 또는 undefined
   */
  getHostileDrone(droneId: string): Promise<HostileDrone | undefined>;

  /**
   * 모든 적 드론 상태 조회
   *
   * @returns 드론 ID -> 드론 상태 맵
   */
  getAllHostileDrones(): Promise<Map<string, HostileDrone>>;

  /**
   * 적 드론 업데이트 (1 틱)
   *
   * @param droneId 드론 ID
   * @param deltaTime 경과 시간 (초)
   * @param basePosition 기지 위치
   * @param interceptors 요격 드론 맵 (회피 판단용)
   */
  updateHostileDrone(
    droneId: string,
    deltaTime: number,
    basePosition: Position3D,
    interceptors: Map<string, InterceptorDrone>
  ): Promise<void>;

  /**
   * 적 드론 무력화
   *
   * @param droneId 드론 ID
   */
  neutralizeHostileDrone(droneId: string): Promise<void>;

  /**
   * 적 드론 행동 모드 변경
   *
   * @param droneId 드론 ID
   * @param behavior 새로운 행동 모드
   */
  setHostileDroneBehavior(
    droneId: string,
    behavior: HostileDroneBehavior
  ): Promise<void>;

  // ============================================
  // 요격 드론 관리
  // ============================================

  /**
   * 요격 드론 생성
   *
   * @param config 요격 드론 생성 설정
   * @returns 생성된 요격 드론 ID
   */
  spawnInterceptor(config: InterceptorSpawnConfig): Promise<string>;

  /**
   * 요격 드론 제거
   *
   * @param interceptorId 요격 드론 ID
   */
  removeInterceptor(interceptorId: string): Promise<void>;

  /**
   * 요격 드론 상태 조회
   *
   * @param interceptorId 요격 드론 ID
   * @returns 요격 드론 상태 또는 undefined
   */
  getInterceptor(interceptorId: string): Promise<InterceptorDrone | undefined>;

  /**
   * 모든 요격 드론 상태 조회
   *
   * @returns 요격 드론 ID -> 상태 맵
   */
  getAllInterceptors(): Promise<Map<string, InterceptorDrone>>;

  /**
   * 요격 드론 업데이트 (1 틱)
   *
   * @param interceptorId 요격 드론 ID
   * @param deltaTime 경과 시간 (초)
   * @param hostileDrones 적 드론 맵
   * @param basePosition 기지 위치
   */
  updateInterceptor(
    interceptorId: string,
    deltaTime: number,
    hostileDrones: Map<string, HostileDrone>,
    basePosition: Position3D
  ): Promise<void>;

  /**
   * 요격 드론 발진
   *
   * @param interceptorId 요격 드론 ID
   * @param targetId 목표 드론 ID
   * @param method 요격 방식
   */
  launchInterceptor(
    interceptorId: string,
    targetId: string,
    method?: InterceptMethod
  ): Promise<void>;

  /**
   * 요격 드론 리셋 (귀환 완료 시)
   *
   * @param interceptorId 요격 드론 ID
   * @param basePosition 기지 위치
   */
  resetInterceptor(
    interceptorId: string,
    basePosition: Position3D
  ): Promise<void>;

  /**
   * 요격 드론 유도 모드 변경
   *
   * @param interceptorId 요격 드론 ID
   * @param mode 유도 모드 (PN 또는 PURE_PURSUIT)
   */
  setInterceptorGuidanceMode(
    interceptorId: string,
    mode: GuidanceMode
  ): Promise<void>;

  // ============================================
  // 전체 제어
  // ============================================

  /**
   * 모든 드론 초기화 (시나리오 리셋 시)
   */
  reset(): void;

  /**
   * 월드 시간 업데이트
   *
   * @param time 현재 시뮬레이션 시간 (초)
   */
  setWorldTime(time: number): void;
}
