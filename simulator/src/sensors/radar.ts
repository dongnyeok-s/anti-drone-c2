/**
 * Pseudo-Radar 시뮬레이션 모델
 * 
 * 레이더 파라미터:
 * - scan_rate: 초당 1회 회전
 * - max_range: 1000m
 * - radial_noise_sigma: 5~15m
 * - azimuth_noise_sigma: 1~3도
 * - false_alarm_rate: 1~2%
 * - miss_probability: 5~10%
 */

import { RadarConfig, RadarDetectionEvent, DEFAULT_RADAR_CONFIG } from '../../../shared/schemas';
import { HostileDrone, Position3D } from '../types';

/**
 * 가우시안 노이즈 생성 (Box-Muller 변환)
 */
function gaussianNoise(mean: number = 0, sigma: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * sigma + mean;
}

/**
 * 두 위치 간 거리 계산
 */
function calculateDistance(p1: Position3D, p2: Position3D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.altitude - p1.altitude;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 두 위치 간 방위각 계산 (도)
 */
function calculateBearing(from: Position3D, to: Position3D): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let bearing = Math.atan2(dx, dy) * (180 / Math.PI);
  if (bearing < 0) bearing += 360;
  return bearing;
}

/**
 * 접근 속도 계산 (양수 = 접근 중)
 */
function calculateClosingVelocity(
  dronePos: Position3D,
  droneVel: { vx: number; vy: number },
  basePos: Position3D
): number {
  const dist = calculateDistance(dronePos, basePos);
  if (dist < 1) return 0;
  
  const ux = (basePos.x - dronePos.x) / dist;
  const uy = (basePos.y - dronePos.y) / dist;
  
  return droneVel.vx * ux + droneVel.vy * uy;
}

export class RadarSensor {
  private config: RadarConfig;
  private basePosition: Position3D;
  private lastScanTime: number = 0;
  private scanCounter: number = 0;

  constructor(basePosition: Position3D, config: RadarConfig = DEFAULT_RADAR_CONFIG) {
    this.basePosition = basePosition;
    this.config = config;
  }

  /**
   * 레이더 스캔 수행
   * 
   * @param currentTime 현재 시뮬레이션 시간 (초)
   * @param drones 탐지 대상 드론 맵
   * @returns 탐지 이벤트 배열
   */
  scan(currentTime: number, drones: Map<string, HostileDrone>): RadarDetectionEvent[] {
    const scanInterval = 1 / this.config.scan_rate;
    
    // 스캔 간격 체크
    if (currentTime - this.lastScanTime < scanInterval) {
      return [];
    }
    
    this.lastScanTime = currentTime;
    this.scanCounter++;
    
    const events: RadarDetectionEvent[] = [];
    
    // 각 드론에 대해 탐지 시도
    drones.forEach((drone, droneId) => {
      if (drone.isNeutralized) return;
      
      const actualRange = calculateDistance(this.basePosition, drone.position);
      
      // 최대 탐지 거리 체크
      if (actualRange > this.config.max_range) return;
      
      // 미탐 확률 체크
      if (Math.random() < this.config.miss_probability) return;
      
      // 노이즈가 추가된 측정값 생성
      const noisyRange = actualRange + gaussianNoise(0, this.config.radial_noise_sigma);
      const actualBearing = calculateBearing(this.basePosition, drone.position);
      const noisyBearing = (actualBearing + gaussianNoise(0, this.config.azimuth_noise_sigma) + 360) % 360;
      const noisyAltitude = drone.position.altitude + gaussianNoise(0, this.config.radial_noise_sigma * 0.5);
      
      // 신뢰도 계산 (거리가 멀수록, 노이즈가 클수록 낮음)
      const distanceFactor = 1 - (actualRange / this.config.max_range) * 0.3;
      const confidence = Math.max(0.5, Math.min(0.99, distanceFactor + gaussianNoise(0, 0.05)));
      
      // 접근 속도
      const radialVelocity = calculateClosingVelocity(drone.position, drone.velocity, this.basePosition);
      
      events.push({
        type: 'radar_detection',
        timestamp: currentTime,
        drone_id: droneId,
        range: Math.max(0, noisyRange),
        bearing: noisyBearing,
        altitude: Math.max(0, noisyAltitude),
        radial_velocity: radialVelocity + gaussianNoise(0, 1),
        confidence,
        is_false_alarm: false,
      });
    });
    
    // 오탐 생성
    if (Math.random() < this.config.false_alarm_rate) {
      const falseAlarmRange = Math.random() * this.config.max_range;
      const falseAlarmBearing = Math.random() * 360;
      const falseAlarmAltitude = 30 + Math.random() * 200;
      
      events.push({
        type: 'radar_detection',
        timestamp: currentTime,
        drone_id: `FALSE-${this.scanCounter}-${Math.random().toString(36).substr(2, 4)}`,
        range: falseAlarmRange,
        bearing: falseAlarmBearing,
        altitude: falseAlarmAltitude,
        radial_velocity: gaussianNoise(0, 5),
        confidence: 0.3 + Math.random() * 0.3,
        is_false_alarm: true,
      });
    }
    
    return events;
  }

  /**
   * 레이더 설정 업데이트
   */
  updateConfig(config: Partial<RadarConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 기지 위치 업데이트
   */
  updateBasePosition(position: Position3D): void {
    this.basePosition = position;
  }
}

