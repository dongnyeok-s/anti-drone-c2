/**
 * AirSim 센서 제공자
 *
 * WebSocket을 통해 Python AirSim 브리지와 통신하여 센서 데이터 수집
 */

import WebSocket from 'ws';
import { ISensorProvider, SensorConfig } from './ISensorProvider';
import { RadarDetectionEvent } from '../../../shared/schemas';
import { AudioDetectionEvent } from '../core/logging/eventSchemas';
import { HostileDrone, Position3D } from '../types';
import { EODetectionEvent } from '../sensors/eoSensor';

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

export class AirSimSensorProvider implements ISensorProvider {
  private ws: WebSocket | null = null;
  private bridgeUrl: string;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = new Map();
  private reconnectInterval = 5000;
  private isConnected = false;

  constructor(bridgeUrl: string, basePosition: Position3D, config: SensorConfig) {
    this.bridgeUrl = bridgeUrl;
    this.connect();
  }

  private connect(): void {
    console.log(`[AirSimSensorProvider] 브리지 연결 시도: ${this.bridgeUrl}`);

    this.ws = new WebSocket(this.bridgeUrl);

    this.ws.on('open', () => {
      console.log('[AirSimSensorProvider] 브리지 연결 성공');
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
        console.error('[AirSimSensorProvider] 메시지 파싱 오류:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[AirSimSensorProvider] WebSocket 오류:', error);
    });

    this.ws.on('close', () => {
      console.warn('[AirSimSensorProvider] 브리지 연결 끊김, 재연결 시도...');
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

  async scanRadar(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<RadarDetectionEvent[]> {
    try {
      const result = await this.sendRequest('scanRadar', {
        currentTime,
        droneIds: Array.from(drones.keys()),
      });

      if (!result.success) {
        console.error('[AirSimSensorProvider] 레이더 스캔 실패:', result.error);
        return [];
      }

      // Python 브리지에서 받은 탐지 데이터를 RadarDetectionEvent로 변환
      return result.detections.map((det: any) => ({
        timestamp: det.timestamp,
        track_id: det.track_id,
        position: det.position,
        radial_distance: det.radial_distance,
        azimuth: det.azimuth,
        sensor_type: 'radar' as const,
      }));
    } catch (error) {
      console.error('[AirSimSensorProvider] 레이더 스캔 오류:', error);
      return [];
    }
  }

  async detectAudio(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<AudioDetectionEvent[]> {
    try {
      const result = await this.sendRequest('detectAudio', {
        currentTime,
        droneIds: Array.from(drones.keys()),
      });

      if (!result.success) {
        console.error('[AirSimSensorProvider] 음향 탐지 실패:', result.error);
        return [];
      }

      // Python 브리지에서 받은 탐지 데이터를 AudioDetectionEvent로 변환
      return result.detections.map((det: any) => ({
        event: 'audio_detection' as const,
        timestamp: det.timestamp,
        droneId: det.droneId,
        position: det.position,
        is_first_detection: false, // AirSim 모드에서는 추적하지 않음
        sensor: 'acoustic',
      }));
    } catch (error) {
      console.error('[AirSimSensorProvider] 음향 탐지 오류:', error);
      return [];
    }
  }

  async detectEO(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<EODetectionEvent[]> {
    try {
      const result = await this.sendRequest('detectEO', {
        currentTime,
        droneIds: Array.from(drones.keys()),
      });

      if (!result.success) {
        console.error('[AirSimSensorProvider] EO 탐지 실패:', result.error);
        return [];
      }

      // Python 브리지에서 받은 탐지 데이터를 EODetectionEvent로 변환
      return result.detections.map((det: any) => ({
        timestamp: det.timestamp,
        droneId: det.droneId,
        position: det.position,
        sensor: 'eo',
        confidence: det.confidence,
        classification: det.classification,
      }));
    } catch (error) {
      console.error('[AirSimSensorProvider] EO 탐지 오류:', error);
      return [];
    }
  }

  updateConfig(config: Partial<SensorConfig>): void {
    // 센서 설정 업데이트는 Python 브리지를 통해 수행
    // 현재는 구현하지 않음
    console.warn('[AirSimSensorProvider] updateConfig는 아직 구현되지 않음');
  }

  reset(): void {
    // 센서 초기화 - Python 브리지에 리셋 요청
    this.sendRequest('reset', {}).catch((error) => {
      console.error('[AirSimSensorProvider] 리셋 오류:', error);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}
