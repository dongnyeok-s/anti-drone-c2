/**
 * Internal 센서 제공자
 *
 * 기존 2D 시뮬레이션 센서를 ISensorProvider 인터페이스로 래핑
 */

import { ISensorProvider, SensorConfig } from './ISensorProvider';
import { RadarDetectionEvent } from '../../../shared/schemas';
import { AudioDetectionEvent } from '../core/logging/eventSchemas';
import { HostileDrone, Position3D } from '../types';
import { RadarSensor } from '../sensors/radar';
import { AcousticSensor } from '../sensors/acousticSensor';
import { EOSensor, EODetectionEvent } from '../sensors/eoSensor';

export class InternalSensorProvider implements ISensorProvider {
  private radarSensor: RadarSensor;
  private acousticSensor: AcousticSensor;
  private eoSensor: EOSensor;

  constructor(basePosition: Position3D, config: SensorConfig) {
    this.radarSensor = new RadarSensor(basePosition, {
      scan_rate: config.radar.scanRate,
      max_range: config.radar.maxRange,
      radial_noise_sigma: config.radar.radialNoiseSigma,
      azimuth_noise_sigma: config.radar.azimuthNoiseSigma,
      false_alarm_rate: config.radar.falseAlarmRate,
      miss_probability: config.radar.missProbability,
    });

    this.acousticSensor = new AcousticSensor(basePosition);

    this.eoSensor = new EOSensor(basePosition, {
      maxRange: config.eo.maxRange,
      detectionInterval: config.eo.detectionInterval,
      baseDetectionProb: config.eo.baseDetectionProb,
      hostileAccuracy: config.eo.hostileAccuracy,
      civilAccuracy: config.eo.civilAccuracy,
    });
  }

  async scanRadar(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<RadarDetectionEvent[]> {
    // 기존 RadarSensor.scan() 호출 (동기식이지만 async로 래핑)
    return this.radarSensor.scan(currentTime, drones);
  }

  async detectAudio(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<AudioDetectionEvent[]> {
    // 기존 AcousticSensor.scan() 호출
    return this.acousticSensor.scan(currentTime, drones);
  }

  async detectEO(
    currentTime: number,
    drones: Map<string, HostileDrone>
  ): Promise<EODetectionEvent[]> {
    // 기존 EOSensor.scan() 호출
    return this.eoSensor.scan(currentTime, drones);
  }

  updateConfig(config: Partial<SensorConfig>): void {
    // 센서 설정 업데이트 (필요 시 구현)
    // 현재는 런타임 설정 변경이 없으므로 생략
  }

  reset(): void {
    // 센서 초기화
    // RadarSensor, AcousticSensor 등은 상태가 거의 없으므로
    // 필요 시 lastScanTime 등 리셋
  }
}
