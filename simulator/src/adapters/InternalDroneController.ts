/**
 * Internal 드론 제어자
 *
 * 기존 2D 시뮬레이션 드론 모델을 IDroneController 인터페이스로 래핑
 */

import {
  IDroneController,
  DroneSpawnConfig,
  InterceptorSpawnConfig,
} from './IDroneController';
import {
  HostileDroneBehavior,
  GuidanceMode,
  InterceptMethod,
} from '../../../shared/schemas';
import { HostileDrone, InterceptorDrone, Position3D, SimulationWorld } from '../types';
import {
  createHostileDrone,
  updateHostileDrone,
  setDroneBehavior,
} from '../models/hostileDrone';
import {
  createInterceptor,
  updateInterceptor,
  launchInterceptor,
  resetInterceptor,
  ExtendedInterceptorDrone,
  setGuidanceMode,
} from '../models/interceptor';

export class InternalDroneController implements IDroneController {
  private world: SimulationWorld;

  constructor(world: SimulationWorld) {
    this.world = world;
  }

  // ============================================
  // 적 드론 관리
  // ============================================

  async spawnHostileDrone(config: DroneSpawnConfig): Promise<string> {
    const drone = createHostileDrone(
      config.position,
      config.velocity,
      config.behavior,
      config.config,
      config.targetPosition,
      config.trueLabel
    );

    // spawnTime 설정
    drone.spawnTime = this.world.time;

    this.world.hostileDrones.set(drone.id, drone);
    return drone.id;
  }

  async removeHostileDrone(droneId: string): Promise<void> {
    this.world.hostileDrones.delete(droneId);
  }

  async getHostileDrone(droneId: string): Promise<HostileDrone | undefined> {
    return this.world.hostileDrones.get(droneId);
  }

  async getAllHostileDrones(): Promise<Map<string, HostileDrone>> {
    return new Map(this.world.hostileDrones);
  }

  async updateHostileDrone(
    droneId: string,
    deltaTime: number,
    basePosition: Position3D,
    interceptors: Map<string, InterceptorDrone>
  ): Promise<void> {
    const drone = this.world.hostileDrones.get(droneId);
    if (!drone) return;

    // 기존 updateHostileDrone() 호출
    const updated = updateHostileDrone(
      drone,
      deltaTime,
      basePosition,
      interceptors
    );

    this.world.hostileDrones.set(droneId, updated);
  }

  async neutralizeHostileDrone(droneId: string): Promise<void> {
    const drone = this.world.hostileDrones.get(droneId);
    if (!drone) return;

    drone.isNeutralized = true;
    this.world.hostileDrones.set(droneId, drone);
  }

  async setHostileDroneBehavior(
    droneId: string,
    behavior: HostileDroneBehavior
  ): Promise<void> {
    const drone = this.world.hostileDrones.get(droneId);
    if (!drone) return;

    const updated = setDroneBehavior(drone, behavior);
    this.world.hostileDrones.set(droneId, updated);
  }

  // ============================================
  // 요격 드론 관리
  // ============================================

  async spawnInterceptor(config: InterceptorSpawnConfig): Promise<string> {
    const interceptor = createInterceptor(config.position, config.config);
    this.world.interceptors.set(interceptor.id, interceptor);
    return interceptor.id;
  }

  async removeInterceptor(interceptorId: string): Promise<void> {
    this.world.interceptors.delete(interceptorId);
  }

  async getInterceptor(
    interceptorId: string
  ): Promise<InterceptorDrone | undefined> {
    return this.world.interceptors.get(interceptorId);
  }

  async getAllInterceptors(): Promise<Map<string, InterceptorDrone>> {
    return new Map(this.world.interceptors);
  }

  async updateInterceptor(
    interceptorId: string,
    deltaTime: number,
    hostileDrones: Map<string, HostileDrone>,
    basePosition: Position3D
  ): Promise<void> {
    const interceptor = this.world.interceptors.get(
      interceptorId
    ) as ExtendedInterceptorDrone;
    if (!interceptor) return;

    // 타겟 드론 찾기
    const target = interceptor.targetId
      ? hostileDrones.get(interceptor.targetId) || null
      : null;

    // 기존 updateInterceptor() 호출
    const result = updateInterceptor(
      interceptor,
      deltaTime,
      target,
      basePosition,
      this.world.time
    );

    this.world.interceptors.set(interceptorId, result.interceptor as InterceptorDrone);
  }

  async launchInterceptor(
    interceptorId: string,
    targetId: string,
    method?: InterceptMethod
  ): Promise<void> {
    const interceptor = this.world.interceptors.get(
      interceptorId
    ) as ExtendedInterceptorDrone;
    if (!interceptor) return;

    // 기존 launchInterceptor() 호출
    const updated = launchInterceptor(
      interceptor,
      targetId,
      this.world.time,
      method
    );

    this.world.interceptors.set(interceptorId, updated);
  }

  async resetInterceptor(
    interceptorId: string,
    basePosition: Position3D
  ): Promise<void> {
    const interceptor = this.world.interceptors.get(
      interceptorId
    ) as ExtendedInterceptorDrone;
    if (!interceptor) return;

    // 기존 resetInterceptor() 호출
    const updated = resetInterceptor(interceptor, basePosition);
    this.world.interceptors.set(interceptorId, updated);
  }

  async setInterceptorGuidanceMode(
    interceptorId: string,
    mode: GuidanceMode
  ): Promise<void> {
    const interceptor = this.world.interceptors.get(
      interceptorId
    ) as ExtendedInterceptorDrone;
    if (!interceptor) return;

    // 기존 setGuidanceMode() 호출
    const updated = setGuidanceMode(interceptor, mode);
    this.world.interceptors.set(interceptorId, updated);
  }

  // ============================================
  // 전체 제어
  // ============================================

  reset(): void {
    this.world.hostileDrones.clear();
    this.world.interceptors.clear();
    this.world.time = 0;
  }

  setWorldTime(time: number): void {
    this.world.time = time;
  }
}
