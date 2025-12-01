/**
 * 음향 탐지 센서 모듈
 * 
 * 드론의 소리(프로펠러, 모터 등)를 기반으로 탐지하는 센서를 시뮬레이션합니다.
 * 실제 CRNN/딥러닝 모델은 나중에 교체 가능하도록 rule-based / 확률적 모델로 구현합니다.
 */

import { 
  AudioDetectionEvent, 
  DroneActivityState 
} from '../core/logging/eventSchemas';
import { HostileDrone, Position3D } from '../types';

// ============================================
// 설정 인터페이스
// ============================================

export interface AcousticSensorConfig {
  detection_range: number;        // 최대 탐지 거리 (m)
  min_detection_range: number;    // 최소 탐지 거리 (m)
  base_detection_prob: number;    // 기본 탐지 확률
  takeoff_boost: number;          // 이륙 시 탐지 확률 증가
  approach_boost: number;         // 접근 시 탐지 확률 증가
  false_alarm_rate: number;       // 오탐률 (0~1)
  miss_probability: number;       // 미탐률 (0~1)
  detection_delay_mean: number;   // 탐지 지연 평균 (초)
  detection_delay_std: number;    // 탐지 지연 표준편차 (초)
  confidence_noise: number;       // 신뢰도 노이즈
  bearing_noise_sigma: number;    // 방위각 노이즈 (도)
  distance_noise_sigma: number;   // 거리 노이즈 (m)
}

export const DEFAULT_ACOUSTIC_CONFIG: AcousticSensorConfig = {
  detection_range: 1000,
  min_detection_range: 50,
  base_detection_prob: 0.6,
  takeoff_boost: 0.3,        // 이륙 시 +30%
  approach_boost: 0.2,       // 접근 시 +20%
  false_alarm_rate: 0.01,    // 1%
  miss_probability: 0.1,     // 10%
  detection_delay_mean: 0.5,
  detection_delay_std: 0.2,
  confidence_noise: 0.1,
  bearing_noise_sigma: 10,   // 방위각 오차 ±10도
  distance_noise_sigma: 50,  // 거리 오차 ±50m
};

// ============================================
// 음향 센서 클래스
// ============================================

export class AcousticSensor {
  private config: AcousticSensorConfig;
  private sensorPosition: Position3D;
  private lastScanTime: number = 0;
  private scanInterval: number = 2; // 2초마다 스캔
  private detectedDrones: Set<string> = new Set();
  private pendingDetections: Map<string, number> = new Map(); // 드론ID -> 탐지 예정 시간
  private enabled: boolean = true;

  constructor(
    sensorPosition: Position3D,
    config: Partial<AcousticSensorConfig> = {}
  ) {
    this.sensorPosition = sensorPosition;
    this.config = { ...DEFAULT_ACOUSTIC_CONFIG, ...config };
  }

  /**
   * 센서 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 드론의 활동 상태 추정
   */
  private estimateActivityState(drone: HostileDrone): DroneActivityState {
    const speed = Math.sqrt(
      drone.velocity.vx ** 2 + 
      drone.velocity.vy ** 2
    );
    const verticalSpeed = Math.abs(drone.velocity.climbRate);
    const distance = this.calculateDistance(drone.position);
    const closingSpeed = this.calculateClosingSpeed(drone);

    // 이륙 감지: 낮은 고도 + 상승 중
    if (drone.position.altitude < 50 && drone.velocity.climbRate > 2) {
      return 'TAKEOFF';
    }
    
    // 접근 감지: 기지 방향으로 이동
    if (closingSpeed > 5 && distance < this.config.detection_range * 0.7) {
      return 'APPROACH';
    }
    
    // 이탈 감지: 기지에서 멀어지는 중
    if (closingSpeed < -5) {
      return 'DEPART';
    }
    
    // 배회/선회 감지: 행동이 RECON이거나 낮은 속도로 선회
    if (drone.behavior === 'RECON' || (speed < 8 && speed > 2)) {
      return 'LOITER';
    }
    
    // 호버링: 거의 정지
    if (speed < 2 && verticalSpeed < 1) {
      return 'HOVER';
    }
    
    return 'IDLE';
  }

  /**
   * 센서와 드론 간 거리 계산
   */
  private calculateDistance(dronePos: Position3D): number {
    const dx = dronePos.x - this.sensorPosition.x;
    const dy = dronePos.y - this.sensorPosition.y;
    const dz = dronePos.altitude - this.sensorPosition.altitude;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * 접근 속도 계산 (음수면 멀어지는 중)
   */
  private calculateClosingSpeed(drone: HostileDrone): number {
    const dx = drone.position.x - this.sensorPosition.x;
    const dy = drone.position.y - this.sensorPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return 0;
    
    // 단위 벡터
    const ux = dx / dist;
    const uy = dy / dist;
    
    // 속도 벡터와 방향 벡터의 내적 (음수면 접근)
    return -(drone.velocity.vx * ux + drone.velocity.vy * uy);
  }

  /**
   * 방위각 계산 (도)
   */
  private calculateBearing(dronePos: Position3D): number {
    const dx = dronePos.x - this.sensorPosition.x;
    const dy = dronePos.y - this.sensorPosition.y;
    let bearing = Math.atan2(dy, dx) * (180 / Math.PI);
    bearing = (90 - bearing + 360) % 360; // 북쪽 기준으로 변환
    return bearing;
  }

  /**
   * 탐지 확률 계산
   */
  private calculateDetectionProbability(
    drone: HostileDrone,
    state: DroneActivityState
  ): number {
    const distance = this.calculateDistance(drone.position);
    
    // 범위 밖
    if (distance > this.config.detection_range) return 0;
    if (distance < this.config.min_detection_range) return 0.95;
    
    // 거리에 따른 기본 확률 (역제곱 법칙 근사)
    const distanceFactor = 1 - (distance / this.config.detection_range) ** 1.5;
    let prob = this.config.base_detection_prob * distanceFactor;
    
    // 상태별 부스트
    if (state === 'TAKEOFF') {
      prob += this.config.takeoff_boost;
    } else if (state === 'APPROACH') {
      prob += this.config.approach_boost;
    }
    
    // 미탐 확률 적용
    prob *= (1 - this.config.miss_probability);
    
    return Math.min(0.95, Math.max(0, prob));
  }

  /**
   * 가우시안 노이즈 추가
   */
  private addGaussianNoise(value: number, sigma: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return value + z * sigma;
  }

  /**
   * 탐지 지연 시간 생성
   */
  private generateDetectionDelay(): number {
    const delay = this.addGaussianNoise(
      this.config.detection_delay_mean,
      this.config.detection_delay_std
    );
    return Math.max(0.1, delay);
  }

  /**
   * 오탐 이벤트 생성
   */
  private generateFalseAlarm(simTime: number): AudioDetectionEvent | null {
    if (Math.random() > this.config.false_alarm_rate) return null;
    
    // 랜덤 방향의 오탐 생성
    const randomBearing = Math.random() * 360;
    const randomDistance = Math.random() * this.config.detection_range * 0.8;
    
    return {
      timestamp: simTime,
      event: 'audio_detection',
      drone_id: null,
      state: Math.random() > 0.5 ? 'APPROACH' : 'LOITER',
      confidence: 0.3 + Math.random() * 0.3, // 낮은 신뢰도
      estimated_bearing: randomBearing,
      estimated_distance: randomDistance,
      is_first_detection: false,
      sensor: 'AUDIO',
      is_false_alarm: true,
    };
  }

  /**
   * 메인 스캔 함수
   */
  scan(
    simTime: number,
    drones: Map<string, HostileDrone>
  ): AudioDetectionEvent[] {
    if (!this.enabled) return [];
    
    // 스캔 간격 체크
    if (simTime - this.lastScanTime < this.scanInterval) {
      // 보류 중인 탐지 이벤트 처리
      return this.processPendingDetections(simTime, drones);
    }
    this.lastScanTime = simTime;
    
    const events: AudioDetectionEvent[] = [];
    
    // 각 드론에 대해 탐지 시도
    drones.forEach((drone, droneId) => {
      if (drone.isNeutralized) return;
      
      const state = this.estimateActivityState(drone);
      const detectProb = this.calculateDetectionProbability(drone, state);
      
      // 탐지 성공 여부
      if (Math.random() < detectProb) {
        // 탐지 지연 적용
        const delay = this.generateDetectionDelay();
        const detectionTime = simTime + delay;
        
        // 이미 탐지 예정이면 스킵
        if (!this.pendingDetections.has(droneId)) {
          this.pendingDetections.set(droneId, detectionTime);
        }
      }
    });
    
    // 보류 중인 탐지 이벤트 처리
    events.push(...this.processPendingDetections(simTime, drones));
    
    // 오탐 생성
    const falseAlarm = this.generateFalseAlarm(simTime);
    if (falseAlarm) {
      events.push(falseAlarm);
    }
    
    return events;
  }

  /**
   * 보류 중인 탐지 이벤트 처리
   */
  private processPendingDetections(
    simTime: number,
    drones: Map<string, HostileDrone>
  ): AudioDetectionEvent[] {
    const events: AudioDetectionEvent[] = [];
    
    this.pendingDetections.forEach((detectionTime, droneId) => {
      if (simTime >= detectionTime) {
        const drone = drones.get(droneId);
        if (drone && !drone.isNeutralized) {
          const state = this.estimateActivityState(drone);
          const distance = this.calculateDistance(drone.position);
          const bearing = this.calculateBearing(drone.position);
          
          // 노이즈 추가
          const noisyDistance = this.addGaussianNoise(
            distance,
            this.config.distance_noise_sigma
          );
          const noisyBearing = this.addGaussianNoise(
            bearing,
            this.config.bearing_noise_sigma
          );
          
          // 신뢰도 계산
          const baseConfidence = 0.6 + 0.3 * (1 - distance / this.config.detection_range);
          const confidence = Math.min(0.95, Math.max(0.3,
            this.addGaussianNoise(baseConfidence, this.config.confidence_noise)
          ));
          
          const isFirstDetection = !this.detectedDrones.has(droneId);
          this.detectedDrones.add(droneId);
          
          events.push({
            timestamp: simTime,
            event: 'audio_detection',
            drone_id: droneId,
            state,
            confidence: Math.round(confidence * 100) / 100,
            estimated_distance: Math.round(noisyDistance),
            estimated_bearing: Math.round(noisyBearing * 10) / 10,
            is_first_detection: isFirstDetection,
            sensor: 'AUDIO',
          });
        }
        
        this.pendingDetections.delete(droneId);
      }
    });
    
    return events;
  }

  /**
   * 센서 리셋
   */
  reset(): void {
    this.lastScanTime = 0;
    this.detectedDrones.clear();
    this.pendingDetections.clear();
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<AcousticSensorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 외부 모델 인터페이스 (Python/ML 모델 연동용)
   * 나중에 실제 딥러닝 모델로 교체 가능
   */
  async processExternalModelResult(
    droneId: string,
    result: {
      state: DroneActivityState;
      confidence: number;
      bearing?: number;
      distance?: number;
    },
    simTime: number
  ): Promise<AudioDetectionEvent | null> {
    if (!this.enabled) return null;
    
    const isFirstDetection = !this.detectedDrones.has(droneId);
    this.detectedDrones.add(droneId);
    
    return {
      timestamp: simTime,
      event: 'audio_detection',
      drone_id: droneId,
      state: result.state,
      confidence: result.confidence,
      estimated_bearing: result.bearing,
      estimated_distance: result.distance,
      is_first_detection: isFirstDetection,
      sensor: 'AUDIO',
    };
  }
}

