/**
 * AirSim 드론 제어자
 *
 * WebSocket을 통해 Python AirSim 브리지와 통신하여 드론 제어
 */

import WebSocket from 'ws';
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
import { HostileDrone, InterceptorDrone, Position3D } from '../types';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, any>;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

export class AirSimDroneController implements IDroneController {
  private ws: WebSocket | null = null;
  private bridgeUrl: string;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = new Map();
  private reconnectInterval = 5000;
  private isConnected = false;

  // 로컬 드론 상태 캐시 (AirSim과 동기화)
  private hostileDrones: Map<string, HostileDrone> = new Map();
  private interceptors: Map<string, InterceptorDrone> = new Map();

  constructor(bridgeUrl: string) {
    this.bridgeUrl = bridgeUrl;
    this.connect();
  }

  private connect(): void {
    console.log(`[AirSimDroneController] 브리지 연결 시도: ${this.bridgeUrl}`);

    this.ws = new WebSocket(this.bridgeUrl);

    this.ws.on('open', () => {
      console.log('[AirSimDroneController] 브리지 연결 성공');
      this.isConnected = true;
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const response: JsonRpcResponse = JSON.parse(data.toString());
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
          this.pendingRequests.delete(response.id);
        }
      } catch (error) {
        console.error('[AirSimDroneController] 메시지 파싱 오류:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[AirSimDroneController] WebSocket 오류:', error);
    });

    this.ws.on('close', () => {
      console.warn('[AirSimDroneController] 브리지 연결 끊김, 재연결 시도...');
      this.isConnected = false;
      setTimeout(() => this.connect(), this.reconnectInterval);
    });
  }

  private async sendRequest(method: string, params: Record<string, any>): Promise<any> {
    if (!this.ws || !this.isConnected) {
      throw new Error('AirSim 브리지가 연결되지 않음');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.ws!.send(JSON.stringify(request), (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });

      // 타임아웃 설정 (10초)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  // ============================================
  // 적 드론 관리
  // ============================================

  async spawnHostileDrone(config: DroneSpawnConfig): Promise<string> {
    try {
      const droneId = `hostile_${Date.now()}`;
      const result = await this.sendRequest('spawnDrone', {
        droneId,
        type: 'hostile',
        position: config.position,
        velocity: config.velocity,
        config: config.config,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // 로컬 캐시에 드론 추가
      const drone: HostileDrone = {
        id: result.droneId,
        position: config.position,
        velocity: config.velocity || { vx: 0, vy: 0, climbRate: 0 },
        behavior: config.behavior || 'direct_attack',
        config: config.config || {},
        targetPosition: config.targetPosition,
        isNeutralized: false,
        isEvading: false,
        spawnTime: Date.now() / 1000,
        lastRadarDetection: 0,
        true_label: config.trueLabel,
      };

      this.hostileDrones.set(result.droneId, drone);
      return result.droneId;
    } catch (error) {
      console.error('[AirSimDroneController] 적 드론 생성 실패:', error);
      throw error;
    }
  }

  async removeHostileDrone(droneId: string): Promise<void> {
    try {
      await this.sendRequest('removeDrone', { droneId });
      this.hostileDrones.delete(droneId);
    } catch (error) {
      console.error('[AirSimDroneController] 적 드론 제거 실패:', error);
      throw error;
    }
  }

  async getHostileDrone(droneId: string): Promise<HostileDrone | undefined> {
    return this.hostileDrones.get(droneId);
  }

  async getAllHostileDrones(): Promise<Map<string, HostileDrone>> {
    return new Map(this.hostileDrones);
  }

  async updateHostileDrone(
    droneId: string,
    deltaTime: number,
    basePosition: Position3D,
    interceptors: Map<string, InterceptorDrone>
  ): Promise<void> {
    const drone = this.hostileDrones.get(droneId);
    if (!drone) return;

    // AirSim에서 실제 위치 업데이트
    try {
      const result = await this.sendRequest('getDroneState', { droneId });

      if (result.success && result.state) {
        // 로컬 캐시 업데이트
        drone.position = result.state.position;
        drone.velocity = result.state.velocity;
        this.hostileDrones.set(droneId, drone);
      }
    } catch (error) {
      console.error('[AirSimDroneController] 드론 상태 조회 실패:', error);
    }
  }

  async neutralizeHostileDrone(droneId: string): Promise<void> {
    const drone = this.hostileDrones.get(droneId);
    if (!drone) return;

    drone.isNeutralized = true;
    this.hostileDrones.set(droneId, drone);

    // AirSim에서 드론 제거
    await this.removeHostileDrone(droneId);
  }

  async setHostileDroneBehavior(
    droneId: string,
    behavior: HostileDroneBehavior
  ): Promise<void> {
    const drone = this.hostileDrones.get(droneId);
    if (!drone) return;

    drone.behavior = behavior;
    this.hostileDrones.set(droneId, drone);

    // AirSim에 행동 변경 알림 (필요 시 구현)
  }

  // ============================================
  // 요격 드론 관리
  // ============================================

  async spawnInterceptor(config: InterceptorSpawnConfig): Promise<string> {
    try {
      const interceptorId = `interceptor_${Date.now()}`;
      const result = await this.sendRequest('spawnDrone', {
        droneId: interceptorId,
        type: 'interceptor',
        position: config.position,
        velocity: { vx: 0, vy: 0, climbRate: 0 },
        config: config.config,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // 로컬 캐시에 요격기 추가
      const interceptor: InterceptorDrone = {
        id: result.droneId,
        position: config.position,
        velocity: { vx: 0, vy: 0, climbRate: 0 },
        state: 'STANDBY',
        config: config.config || {},
        targetId: null,
        launchTime: null,
      };

      this.interceptors.set(result.droneId, interceptor);
      return result.droneId;
    } catch (error) {
      console.error('[AirSimDroneController] 요격기 생성 실패:', error);
      throw error;
    }
  }

  async removeInterceptor(interceptorId: string): Promise<void> {
    try {
      await this.sendRequest('removeDrone', { droneId: interceptorId });
      this.interceptors.delete(interceptorId);
    } catch (error) {
      console.error('[AirSimDroneController] 요격기 제거 실패:', error);
      throw error;
    }
  }

  async getInterceptor(interceptorId: string): Promise<InterceptorDrone | undefined> {
    return this.interceptors.get(interceptorId);
  }

  async getAllInterceptors(): Promise<Map<string, InterceptorDrone>> {
    return new Map(this.interceptors);
  }

  async updateInterceptor(
    interceptorId: string,
    deltaTime: number,
    hostileDrones: Map<string, HostileDrone>,
    basePosition: Position3D
  ): Promise<void> {
    const interceptor = this.interceptors.get(interceptorId);
    if (!interceptor) return;

    // AirSim에서 실제 위치 업데이트
    try {
      const result = await this.sendRequest('getDroneState', { droneId: interceptorId });

      if (result.success && result.state) {
        interceptor.position = result.state.position;
        interceptor.velocity = result.state.velocity;
        this.interceptors.set(interceptorId, interceptor);
      }
    } catch (error) {
      console.error('[AirSimDroneController] 요격기 상태 조회 실패:', error);
    }
  }

  async launchInterceptor(
    interceptorId: string,
    targetId: string,
    method?: InterceptMethod
  ): Promise<void> {
    const interceptor = this.interceptors.get(interceptorId);
    if (!interceptor) return;

    interceptor.state = 'LAUNCHING';
    this.interceptors.set(interceptorId, interceptor);

    // AirSim에 발사 명령 전달
    try {
      await this.sendRequest('updateDrone', {
        droneId: interceptorId,
        targetId,
        method,
      });
    } catch (error) {
      console.error('[AirSimDroneController] 요격기 발사 실패:', error);
    }
  }

  async resetInterceptor(
    interceptorId: string,
    basePosition: Position3D
  ): Promise<void> {
    const interceptor = this.interceptors.get(interceptorId);
    if (!interceptor) return;

    interceptor.state = 'STANDBY';
    interceptor.position = basePosition;
    interceptor.velocity = { vx: 0, vy: 0, climbRate: 0 };
    this.interceptors.set(interceptorId, interceptor);

    // AirSim에 위치 리셋 전달
    try {
      await this.sendRequest('updateDrone', {
        droneId: interceptorId,
        position: basePosition,
        velocity: { x: 0, y: 0, z: 0 },
      });
    } catch (error) {
      console.error('[AirSimDroneController] 요격기 리셋 실패:', error);
    }
  }

  async setInterceptorGuidanceMode(
    interceptorId: string,
    mode: GuidanceMode
  ): Promise<void> {
    // AirSim에 유도 모드 변경 알림 (필요 시 구현)
    console.log(`[AirSimDroneController] 유도 모드 변경: ${interceptorId} -> ${mode}`);
  }

  // ============================================
  // 전체 제어
  // ============================================

  reset(): void {
    this.hostileDrones.clear();
    this.interceptors.clear();

    // AirSim 리셋
    this.sendRequest('reset', {}).catch((error) => {
      console.error('[AirSimDroneController] 리셋 실패:', error);
    });
  }

  setWorldTime(time: number): void {
    // AirSim은 실시간 시뮬레이션이므로 별도의 시간 설정 없음
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}
