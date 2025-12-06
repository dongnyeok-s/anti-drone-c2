/**
 * 센서 데이터 제공자 인터페이스
 *
 * INTERNAL 모드와 EXTERNAL_AIRSIM 모드를 추상화
 */

import {
  RadarDetectionEvent,
  SensorType,
} from '../../../shared/schemas';
import { AudioDetectionEvent } from '../core/logging/eventSchemas';
import { HostileDrone, Position3D } from '../types';
import { EODetectionEvent } from '../sensors/eoSensor';

/**
 * 센서 설정
 */
export interface SensorConfig {
  radar: {
    scanRate: number;
    maxRange: number;
    radialNoiseSigma: number;
    azimuthNoiseSigma: number;
    falseAlarmRate: number;
    missProbability: number;
  };
  acoustic: {
    maxRange: number;
    detectionInterval: number;
  };
  eo: {
    maxRange: number;
    detectionInterval: number;
    baseDetectionProb: number;
    hostileAccuracy: number;
    civilAccuracy: number;
  };
}

/**
 * 센서 제공자 인터페이스
 *
 * 모든 센서 구현체는 이 인터페이스를 따라야 함
 */
export interface ISensorProvider {
  /**
   * 레이더 스캔 수행
   *
   * @param currentTime 현재 시뮬레이션 시간 (초)
   * @param drones 탐지 대상 드론 맵
   * @returns 레이더 탐지 이벤트 배열
   */
  scanRadar(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<RadarDetectionEvent[]>;

  /**
   * 음향 탐지 수행
   *
   * @param currentTime 현재 시뮬레이션 시간 (초)
   * @param drones 탐지 대상 드론 맵
   * @returns 음향 탐지 이벤트 배열
   */
  detectAudio(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<AudioDetectionEvent[]>;

  /**
   * EO(전자광학) 카메라 탐지 수행
   *
   * @param currentTime 현재 시뮬레이션 시간 (초)
   * @param drones 탐지 대상 드론 맵
   * @returns EO 탐지 이벤트 배열
   */
  detectEO(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<EODetectionEvent[]>;

  /**
   * 센서 설정 업데이트
   *
   * @param config 새로운 센서 설정
   */
  updateConfig(config: Partial<SensorConfig>): void;

  /**
   * 센서 초기화 (시나리오 시작 시)
   */
  reset(): void;
}
