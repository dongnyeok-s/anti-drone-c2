/**
 * EO(Electro-Optical) 카메라 센서 모듈
 * 
 * 가짜 EO 센서: 일정 거리 이내 드론에 대해 정찰 이벤트를 발생시키고,
 * classification + confidence 정보를 제공합니다.
 * 
 * 실제 카메라/YOLO는 연결하지 않고, 시뮬레이션용 가짜 센서로 동작합니다.
 */

import { HostileDrone, Position3D } from '../types';
import { SensorObservation, Classification } from '../core/fusion/types';

// ============================================
// EO 센서 설정
// ============================================

export interface EOSensorConfig {
  /** 최대 탐지 거리 (m) */
  maxRange: number;
  /** 최소 탐지 거리 (m) */
  minRange: number;
  /** 시야각 (±도, 0이면 전방향) */
  fieldOfView: number;
  /** 드론당 최소 탐지 간격 (초) */
  detectionInterval: number;
  /** 기본 탐지 확률 */
  baseDetectionProb: number;
  /** HOSTILE 분류 정확도 (HOSTILE일 때 HOSTILE로 분류할 확률) */
  hostileAccuracy: number;
  /** CIVIL 분류 정확도 (CIVIL일 때 CIVIL로 분류할 확률) */
  civilAccuracy: number;
  /** 방위각 노이즈 (도) */
  bearingNoiseSigma: number;
  /** 거리 노이즈 (m) */
  rangeNoiseSigma: number;
  /** 오분류 시 UNKNOWN으로 분류할 확률 */
  unknownFallbackProb: number;
}

export const DEFAULT_EO_CONFIG: EOSensorConfig = {
  maxRange: 350,              // 350m 이내 탐지 (확장)
  minRange: 8,                // 8m 이상
  fieldOfView: 180,           // ±90도 (전방 180도)
  detectionInterval: 1.0,     // 1.0초 간격 (더 자주)
  baseDetectionProb: 0.75,    // 75% 기본 확률 (향상)
  hostileAccuracy: 0.94,      // HOSTILE → HOSTILE 94% (향상)
  civilAccuracy: 0.88,        // CIVIL → CIVIL 88% (향상)
  bearingNoiseSigma: 2.5,     // ±2.5도 오차 (개선)
  rangeNoiseSigma: 4,         // ±4m 오차 (개선)
  unknownFallbackProb: 0.75,  // 오분류 시 75% UNKNOWN
};

// ============================================
// EO 탐지 이벤트
// ============================================

export interface EODetectionEvent {
  timestamp: number;
  event: 'eo_detection';
  drone_id: string;
  bearing: number;
  range: number;
  altitude: number;
  classification: Classification;
  class_confidence: number;
  confidence: number;
  armed: boolean | null;
  size_class: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  drone_type: string | null;
  is_first_detection: boolean;
}

// ============================================
// EO 센서 클래스
// ============================================

export class EOSensor {
  private config: EOSensorConfig;
  private sensorPosition: Position3D;
  private lastDetectionTime: Map<string, number> = new Map();
  private detectedDrones: Set<string> = new Set();
  private enabled: boolean = true;

  constructor(
    sensorPosition: Position3D,
    config: Partial<EOSensorConfig> = {}
  ) {
    this.sensorPosition = sensorPosition;
    this.config = { ...DEFAULT_EO_CONFIG, ...config };
  }

  /**
   * 센서 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 메인 스캔 함수
   */
  scan(
    simTime: number,
    drones: Map<string, HostileDrone>
  ): EODetectionEvent[] {
    if (!this.enabled) return [];

    const events: EODetectionEvent[] = [];

    drones.forEach((drone, droneId) => {
      if (drone.isNeutralized) return;

      // 거리 계산
      const distance = this.calculateDistance(drone.position);

      // 범위 체크
      if (distance > this.config.maxRange || distance < this.config.minRange) {
        return;
      }

      // 시야각 체크 (fieldOfView > 0인 경우)
      if (this.config.fieldOfView > 0) {
        const bearing = this.calculateBearing(drone.position);
        // 시야각 범위 밖이면 스킵 (단순화: 0도 기준)
        if (Math.abs(bearing - 180) > this.config.fieldOfView / 2) {
          // 현재는 단순화하여 스킵하지 않음 (전방향 탐지)
        }
      }

      // 탐지 간격 체크
      const lastDetection = this.lastDetectionTime.get(droneId) || 0;
      if (simTime - lastDetection < this.config.detectionInterval) {
        return;
      }

      // 거리 기반 탐지 확률 계산
      const detectProb = this.calculateDetectionProbability(distance);
      if (Math.random() > detectProb) {
        return;
      }

      // 탐지 성공!
      this.lastDetectionTime.set(droneId, simTime);
      const isFirstDetection = !this.detectedDrones.has(droneId);
      this.detectedDrones.add(droneId);

      // 분류 결과 생성 (ground truth 기반)
      const { classification, classConfidence } = this.classifyDrone(drone, distance);

      // 방위각/거리 계산 (노이즈 추가)
      const bearing = this.addNoise(
        this.calculateBearing(drone.position),
        this.config.bearingNoiseSigma
      );
      const range = this.addNoise(distance, this.config.rangeNoiseSigma);

      // 탐지 신뢰도 (거리 기반)
      const confidence = this.calculateConfidence(distance);

      // 무장 여부 추정 (ground truth + 노이즈)
      const armed = this.estimateArmed(drone);

      // 크기 분류
      const sizeClass = this.estimateSizeClass(drone);

      // 드론 타입 추정
      const droneType = (drone as any).drone_type || 'UNKNOWN';

      events.push({
        timestamp: simTime,
        event: 'eo_detection',
        drone_id: droneId,
        bearing: Math.round(bearing * 10) / 10,
        range: Math.round(range * 10) / 10,
        altitude: drone.position.altitude,
        classification,
        class_confidence: Math.round(classConfidence * 1000) / 1000,
        confidence: Math.round(confidence * 1000) / 1000,
        armed,
        size_class: sizeClass,
        drone_type: droneType,
        is_first_detection: isFirstDetection,
      });
    });

    return events;
  }

  /**
   * 거리 계산
   */
  private calculateDistance(dronePos: Position3D): number {
    const dx = dronePos.x - this.sensorPosition.x;
    const dy = dronePos.y - this.sensorPosition.y;
    const dz = dronePos.altitude - this.sensorPosition.altitude;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * 방위각 계산 (도)
   */
  private calculateBearing(dronePos: Position3D): number {
    const dx = dronePos.x - this.sensorPosition.x;
    const dy = dronePos.y - this.sensorPosition.y;
    let bearing = Math.atan2(dx, dy) * (180 / Math.PI);
    if (bearing < 0) bearing += 360;
    return bearing;
  }

  /**
   * 탐지 확률 계산 (거리 기반)
   */
  private calculateDetectionProbability(distance: number): number {
    // 가까울수록 높은 확률 (더 공격적인 확률 계산)
    const distanceRatio = 1 - (distance / this.config.maxRange);
    
    // 100m 이내: 매우 높은 확률 (85~98%)
    if (distance < 100) {
      return 0.85 + 0.13 * (1 - distance / 100);
    }
    // 100~200m: 높은 확률 (70~85%)
    if (distance < 200) {
      return 0.70 + 0.15 * (1 - (distance - 100) / 100);
    }
    // 200~350m: 기본 확률 (50~70%)
    const prob = this.config.baseDetectionProb + 0.20 * distanceRatio;
    return Math.min(0.95, Math.max(0.45, prob));
  }

  /**
   * 탐지 신뢰도 계산 (거리 기반)
   */
  private calculateConfidence(distance: number): number {
    // conf = clamp(1.2 - distance/400, 0.5, 0.95)
    const conf = 1.2 - distance / 400;
    return Math.min(0.95, Math.max(0.5, conf));
  }

  /**
   * 드론 분류 (ground truth 기반 + 노이즈)
   */
  private classifyDrone(
    drone: HostileDrone,
    distance: number
  ): { classification: Classification; classConfidence: number } {
    const isHostile = drone.is_hostile;
    const random = Math.random();

    let classification: Classification;
    let baseConfidence: number;

    if (isHostile) {
      // HOSTILE 드론 분류
      if (random < this.config.hostileAccuracy) {
        // 정확하게 HOSTILE로 분류
        classification = 'HOSTILE';
        baseConfidence = 0.85 + Math.random() * 0.1;
      } else if (random < this.config.hostileAccuracy + (1 - this.config.hostileAccuracy) * this.config.unknownFallbackProb) {
        // UNKNOWN으로 오분류
        classification = 'UNKNOWN';
        baseConfidence = 0.5 + Math.random() * 0.2;
      } else {
        // CIVIL로 오분류 (드묾)
        classification = 'CIVIL';
        baseConfidence = 0.4 + Math.random() * 0.2;
      }
    } else {
      // CIVIL 드론 분류
      if (random < this.config.civilAccuracy) {
        // 정확하게 CIVIL로 분류
        classification = 'CIVIL';
        baseConfidence = 0.8 + Math.random() * 0.15;
      } else if (random < this.config.civilAccuracy + (1 - this.config.civilAccuracy) * this.config.unknownFallbackProb) {
        // UNKNOWN으로 오분류
        classification = 'UNKNOWN';
        baseConfidence = 0.5 + Math.random() * 0.2;
      } else {
        // HOSTILE로 오분류 (드묾)
        classification = 'HOSTILE';
        baseConfidence = 0.4 + Math.random() * 0.2;
      }
    }

    // 거리에 따른 신뢰도 감소
    const distanceFactor = Math.max(0.6, 1 - distance / (this.config.maxRange * 1.5));
    const classConfidence = baseConfidence * distanceFactor;

    return {
      classification,
      classConfidence: Math.min(0.98, Math.max(0.3, classConfidence)),
    };
  }

  /**
   * 무장 여부 추정
   */
  private estimateArmed(drone: HostileDrone): boolean | null {
    // ground truth에서 가져오기
    const groundTruthArmed = (drone as any).armed;
    if (groundTruthArmed !== undefined) {
      // 90% 확률로 정확하게 추정
      if (Math.random() < 0.9) {
        return groundTruthArmed;
      }
      return null; // 10% 확률로 불확실
    }

    // ground truth가 없으면 HOSTILE 여부로 추정
    if (drone.is_hostile) {
      return Math.random() < 0.7; // 70% 무장
    }
    return Math.random() < 0.1; // 10% 무장
  }

  /**
   * 크기 분류 추정
   */
  private estimateSizeClass(drone: HostileDrone): 'SMALL' | 'MEDIUM' | 'LARGE' | null {
    const groundTruthSize = (drone as any).size_class;
    if (groundTruthSize) {
      return groundTruthSize;
    }

    // 랜덤 추정
    const sizes: Array<'SMALL' | 'MEDIUM' | 'LARGE'> = ['SMALL', 'MEDIUM', 'LARGE'];
    return sizes[Math.floor(Math.random() * 3)];
  }

  /**
   * 가우시안 노이즈 추가
   */
  private addNoise(value: number, sigma: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return value + z * sigma;
  }

  /**
   * 센서 리셋
   */
  reset(): void {
    this.lastDetectionTime.clear();
    this.detectedDrones.clear();
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<EOSensorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 센서 위치 업데이트
   */
  updatePosition(position: Position3D): void {
    this.sensorPosition = position;
  }

  /**
   * SensorObservation 형태로 변환
   */
  static toObservation(event: EODetectionEvent): SensorObservation {
    return {
      sensor: 'EO',
      time: event.timestamp,
      droneId: event.drone_id,
      bearing: event.bearing,
      range: event.range,
      altitude: event.altitude,
      confidence: event.confidence,
      classification: event.classification,
      classConfidence: event.class_confidence,
      metadata: {
        armed: event.armed ?? undefined,
        sizeClass: event.size_class ?? undefined,
        droneType: event.drone_type ?? undefined,
        isFirstDetection: event.is_first_detection,
      },
    };
  }
}

export default EOSensor;

