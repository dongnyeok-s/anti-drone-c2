/**
 * 센서 융합 모듈
 * 
 * Radar + Audio + EO 센서 데이터를 통합 Track으로 융합
 * 
 * 알고리즘:
 * 1. 존재 확률 업데이트 (베이즈 기반)
 * 2. 위치/속도 융합 (가중 평균)
 * 3. 분류/위협도 융합
 */

import {
  SensorType,
  SensorObservation,
  FusedTrack,
  TrackPosition,
  TrackVelocity,
  Classification,
  ClassificationInfo,
  SensorStatus,
  FusionConfig,
  DEFAULT_FUSION_CONFIG,
  TrackUpdateEvent,
  TrackCreatedEvent,
  TrackDroppedEvent,
} from './types';

import {
  computeThreatScore as computeThreat,
  getThreatLevel,
  ThreatScoreConfig,
  DEFAULT_THREAT_SCORE_CONFIG,
} from './threatScore';

// ============================================
// 유틸리티 함수
// ============================================

/**
 * 고유 ID 생성
 */
function generateTrackId(): string {
  return `TRK-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
}

/**
 * 두 위치 간 거리 계산
 */
function calculateDistance(p1: TrackPosition, p2: TrackPosition): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = p2.altitude - p1.altitude;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 방위각과 거리로 위치 계산
 */
function bearingRangeToPosition(
  basePos: TrackPosition,
  bearing: number,
  range: number,
  altitude: number
): TrackPosition {
  const bearingRad = (bearing * Math.PI) / 180;
  return {
    x: basePos.x + range * Math.sin(bearingRad),
    y: basePos.y + range * Math.cos(bearingRad),
    altitude: altitude,
  };
}

/**
 * 위치로 방위각 계산
 */
function positionToBearing(basePos: TrackPosition, targetPos: TrackPosition): number {
  const dx = targetPos.x - basePos.x;
  const dy = targetPos.y - basePos.y;
  let bearing = Math.atan2(dx, dy) * (180 / Math.PI);
  if (bearing < 0) bearing += 360;
  return bearing;
}

/**
 * 값을 범위 내로 제한
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 두 방위각 차이 계산 (0~180)
 */
function bearingDifference(b1: number, b2: number): number {
  let diff = Math.abs(b1 - b2);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

// ============================================
// 센서 융합 클래스
// ============================================

export class SensorFusion {
  private config: FusionConfig;
  private tracks: Map<string, FusedTrack> = new Map();
  private droneIdToTrackId: Map<string, string> = new Map();
  private basePosition: TrackPosition;

  constructor(basePosition: TrackPosition, config: Partial<FusionConfig> = {}) {
    this.basePosition = basePosition;
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config };
    if (config.threatAssessment) {
      this.config.threatAssessment = { 
        ...DEFAULT_FUSION_CONFIG.threatAssessment, 
        ...config.threatAssessment 
      };
    }
  }

  // ============================================
  // 메인 융합 함수
  // ============================================

  /**
   * 센서 관측치를 처리하여 트랙 업데이트
   */
  processObservation(
    obs: SensorObservation,
    currentTime: number
  ): {
    track: FusedTrack;
    event: TrackUpdateEvent | TrackCreatedEvent;
  } | null {
    // 오탐인 경우 무시
    if (obs.metadata?.isFalseAlarm) {
      return null;
    }

    // 매칭되는 트랙 찾기 또는 생성
    let track = this.findMatchingTrack(obs);
    let isNewTrack = false;

    if (!track) {
      track = this.createNewTrack(obs, currentTime);
      isNewTrack = true;
    }

    // 트랙 업데이트
    const deltaTime = currentTime - track.lastUpdateTime;
    track = this.updateTrackWithObservation(track, obs, deltaTime, currentTime);

    // 저장
    this.tracks.set(track.id, track);
    if (track.droneId) {
      this.droneIdToTrackId.set(track.droneId, track.id);
    }

    // 이벤트 생성
    if (isNewTrack) {
      const event: TrackCreatedEvent = {
        timestamp: currentTime,
        event: 'track_created',
        track_id: track.id,
        initial_sensor: obs.sensor,
        position: track.position,
        confidence: obs.confidence,
      };
      return { track, event };
    } else {
      const event = this.createTrackUpdateEvent(track, currentTime);
      return { track, event };
    }
  }

  /**
   * 트랙 업데이트 (관측치 없이 시간 경과만)
   */
  updateTracks(currentTime: number): {
    updated: FusedTrack[];
    dropped: TrackDroppedEvent[];
  } {
    const updated: FusedTrack[] = [];
    const dropped: TrackDroppedEvent[] = [];

    this.tracks.forEach((track, trackId) => {
      const timeSinceUpdate = currentTime - track.lastUpdateTime;

      // 존재 확률 감쇠
      track.existenceProb = clamp(
        track.existenceProb - this.config.trackMatching.existenceDecayRate * timeSinceUpdate,
        0,
        1
      );

      // 위치 예측 (속도 기반)
      if (timeSinceUpdate > 0) {
        track.position = {
          x: track.position.x + track.velocity.vx * timeSinceUpdate,
          y: track.position.y + track.velocity.vy * timeSinceUpdate,
          altitude: track.position.altitude + track.velocity.climbRate * timeSinceUpdate,
        };
        track.missedUpdates++;
      }

      // 트랙 소멸 조건 체크
      const shouldDrop = 
        track.existenceProb < 0.1 ||
        timeSinceUpdate > this.config.trackMatching.trackDropTimeout ||
        track.isNeutralized;

      if (shouldDrop) {
        const dropEvent: TrackDroppedEvent = {
          timestamp: currentTime,
          event: 'track_dropped',
          track_id: trackId,
          reason: track.isNeutralized ? 'neutralized' :
                  track.existenceProb < 0.1 ? 'low_existence' : 'timeout',
          lifetime: currentTime - track.createdTime,
          final_existence_prob: track.existenceProb,
        };
        dropped.push(dropEvent);
        this.tracks.delete(trackId);
        if (track.droneId) {
          this.droneIdToTrackId.delete(track.droneId);
        }
      } else {
        // 위협 점수 재계산
        track.threatScore = this.computeThreatScore(track);
        track.threatLevel = getThreatLevel(track.threatScore);
        track.lastUpdateTime = currentTime;
        updated.push(track);
      }
    });

    return { updated, dropped };
  }

  // ============================================
  // 트랙 매칭
  // ============================================

  /**
   * 관측치와 매칭되는 기존 트랙 찾기
   */
  private findMatchingTrack(obs: SensorObservation): FusedTrack | null {
    // 1. 드론 ID로 직접 매칭
    if (obs.droneId) {
      const trackId = this.droneIdToTrackId.get(obs.droneId);
      if (trackId) {
        return this.tracks.get(trackId) || null;
      }
    }

    // 2. 위치/방위각으로 매칭
    let bestMatch: FusedTrack | null = null;
    let bestScore = Infinity;

    const obsPosition = this.getPositionFromObservation(obs);
    const obsBearing = obs.bearing;

    this.tracks.forEach(track => {
      // 거리 기반 점수
      let score = Infinity;

      if (obsPosition) {
        const dist = calculateDistance(track.position, obsPosition);
        if (dist < this.config.trackMatching.maxDistanceThreshold) {
          score = dist;
        }
      } else if (obsBearing !== null) {
        // 방위각만 있는 경우 (AUDIO)
        const trackBearing = positionToBearing(this.basePosition, track.position);
        const bearingDiff = bearingDifference(obsBearing, trackBearing);
        if (bearingDiff < this.config.trackMatching.maxBearingThreshold) {
          score = bearingDiff * 10; // 방위각 점수를 거리 스케일로 변환
        }
      }

      if (score < bestScore) {
        bestScore = score;
        bestMatch = track;
      }
    });

    return bestMatch;
  }

  /**
   * 관측치에서 위치 추출
   */
  private getPositionFromObservation(obs: SensorObservation): TrackPosition | null {
    if (obs.range !== null && obs.bearing !== null) {
      return bearingRangeToPosition(
        this.basePosition,
        obs.bearing,
        obs.range,
        obs.altitude ?? 100
      );
    }
    return null;
  }

  // ============================================
  // 트랙 생성
  // ============================================

  /**
   * 새 트랙 생성
   */
  private createNewTrack(obs: SensorObservation, currentTime: number): FusedTrack {
    const id = generateTrackId();
    
    // 초기 위치 계산
    let position: TrackPosition;
    if (obs.range !== null && obs.bearing !== null) {
      position = bearingRangeToPosition(
        this.basePosition,
        obs.bearing,
        obs.range,
        obs.altitude ?? 100
      );
    } else if (obs.bearing !== null) {
      // 방위각만 있는 경우 (AUDIO) - 기본 거리 가정
      position = bearingRangeToPosition(
        this.basePosition,
        obs.bearing,
        500, // 기본 거리 500m 가정
        obs.altitude ?? 100
      );
    } else {
      // 위치 정보 없음 - 기지 근처로 설정
      position = { x: 0, y: 0, altitude: 100 };
    }

    // 센서 상태 초기화
    const sensors: SensorStatus = {
      radarSeen: obs.sensor === 'RADAR',
      radarLastSeen: obs.sensor === 'RADAR' ? currentTime : 0,
      audioHeard: obs.sensor === 'AUDIO',
      audioLastSeen: obs.sensor === 'AUDIO' ? currentTime : 0,
      eoSeen: obs.sensor === 'EO',
      eoLastSeen: obs.sensor === 'EO' ? currentTime : 0,
    };

    // 분류 정보 초기화
    const classificationInfo: ClassificationInfo = {
      classification: obs.classification || 'UNKNOWN',
      confidence: obs.classConfidence || 0.5,
      source: obs.sensor,
      armed: obs.metadata?.armed ?? null,
      sizeClass: obs.metadata?.sizeClass ?? null,
      droneType: obs.metadata?.droneType ?? null,
    };

    // 초기 존재 확률 (센서별 가중치 적용) - 더 높은 초기값
    let initialExistence = this.getSensorExistenceWeight(obs.sensor) * obs.confidence;
    
    // EO는 더 높은 초기 확률
    if (obs.sensor === 'EO') {
      initialExistence = Math.max(initialExistence, 0.65);
    }
    // RADAR도 높은 확률
    if (obs.sensor === 'RADAR' && obs.confidence > 0.7) {
      initialExistence = Math.max(initialExistence, 0.55);
    }

    const track: FusedTrack = {
      id,
      droneId: obs.droneId,
      position,
      previousPosition: null,
      velocity: { vx: 0, vy: 0, climbRate: 0 },
      existenceProb: clamp(initialExistence, 0.35, 0.95),
      lastUpdateTime: currentTime,
      createdTime: currentTime,
      sensors,
      classificationInfo,
      threatScore: 0,
      threatLevel: 'INFO',
      positionHistory: [position],
      quality: obs.confidence,
      missedUpdates: 0,
      isNeutralized: false,
      isEvading: false,
    };

    // 위협 점수 계산
    track.threatScore = this.computeThreatScore(track);
    track.threatLevel = getThreatLevel(track.threatScore);

    return track;
  }

  // ============================================
  // 트랙 업데이트 (핵심 융합 로직)
  // ============================================

  /**
   * 관측치로 트랙 업데이트
   */
  private updateTrackWithObservation(
    track: FusedTrack,
    obs: SensorObservation,
    deltaTime: number,
    currentTime: number
  ): FusedTrack {
    // (A) 존재 확률 업데이트
    track = this.updateExistenceProb(track, obs);

    // (B) 위치/속도 융합
    track = this.updatePositionVelocity(track, obs, deltaTime, currentTime);

    // (C) 분류 정보 업데이트
    track = this.updateClassification(track, obs);

    // (D) 센서 상태 업데이트
    track = this.updateSensorStatus(track, obs, currentTime);

    // (E) 위협 점수 재계산
    track.threatScore = this.computeThreatScore(track);
    track.threatLevel = getThreatLevel(track.threatScore);

    // 품질 업데이트
    track.quality = this.calculateTrackQuality(track);
    track.missedUpdates = 0;
    track.lastUpdateTime = currentTime;

    return track;
  }

  /**
   * (A) 존재 확률 업데이트 (베이즈 기반)
   * 
   * 공식: p' = clamp(p + w_sensor * (2*conf - 1), 0, 1)
   * 
   * - 탐지 신뢰도 > 0.5: 존재 확률 증가
   * - 탐지 신뢰도 < 0.5: 존재 확률 감소
   * - EO 센서: 가장 큰 영향력 (분류 포함)
   * - AUDIO 센서: 보조적 역할
   * - 다중 센서 확인 시 시너지 효과
   */
  private updateExistenceProb(track: FusedTrack, obs: SensorObservation): FusedTrack {
    const weight = this.getSensorExistenceWeight(obs.sensor);
    const conf = obs.confidence;
    const p = track.existenceProb;

    // 탐지되면 확률 증가 (공식 그대로 적용)
    // delta = w * (2*conf - 1)
    // conf = 1.0 -> delta = +w
    // conf = 0.5 -> delta = 0
    // conf = 0.0 -> delta = -w
    let delta = weight * (2 * conf - 1);
    
    // 업데이트 강도 (센서별 차등 적용) - 향상됨
    let updateRate = 0.5;  // 기본 업데이트 강도 (증가)
    if (obs.sensor === 'EO') {
      updateRate = 0.7;  // EO는 더 강한 영향력
      // EO가 HOSTILE로 분류하면 추가 부스트
      if (obs.classification === 'HOSTILE' && obs.classConfidence && obs.classConfidence > 0.7) {
        delta += 0.2;  // 추가 존재 확률 증가
      }
    } else if (obs.sensor === 'AUDIO') {
      updateRate = 0.4;  // AUDIO도 영향력 증가
    } else if (obs.sensor === 'RADAR') {
      updateRate = 0.55;  // RADAR도 약간 증가
    }
    
    // 다중 센서 시너지 (이미 다른 센서로 탐지된 경우 수렴 가속)
    let sensorCount = 0;
    if (track.sensors.radarSeen) sensorCount++;
    if (track.sensors.audioHeard) sensorCount++;
    if (track.sensors.eoSeen) sensorCount++;
    
    if (sensorCount >= 2) {
      updateRate *= 1.2;  // 20% 추가 가속
    }
    if (sensorCount >= 3) {
      updateRate *= 1.3;  // 총 30% 추가 가속 (3개 모두 탐지)
    }
    
    const newProb = clamp(p + delta * updateRate, 0.05, 0.99);

    return { ...track, existenceProb: newProb };
  }

  /**
   * (B) 위치/속도 융합 (가중 평균)
   */
  private updatePositionVelocity(
    track: FusedTrack,
    obs: SensorObservation,
    deltaTime: number,
    currentTime: number
  ): FusedTrack {
    const obsPosition = this.getPositionFromObservation(obs);

    // 이전 위치 저장
    const previousPosition = { ...track.position };

    if (obsPosition) {
      // 레이더/EO: 위치 정보가 있는 경우
      const posWeight = this.getSensorPositionWeight(obs.sensor);
      const oldWeight = 1 - posWeight;

      const newPosition: TrackPosition = {
        x: track.position.x * oldWeight + obsPosition.x * posWeight,
        y: track.position.y * oldWeight + obsPosition.y * posWeight,
        altitude: track.position.altitude * oldWeight + obsPosition.altitude * posWeight,
      };

      // 속도 계산 (deltaTime > 0인 경우)
      let velocity = track.velocity;
      if (deltaTime > 0.05) { // 50ms 이상일 때만 속도 계산
        const alpha = 0.3; // 속도 스무딩 팩터
        velocity = {
          vx: velocity.vx * (1 - alpha) + ((newPosition.x - previousPosition.x) / deltaTime) * alpha,
          vy: velocity.vy * (1 - alpha) + ((newPosition.y - previousPosition.y) / deltaTime) * alpha,
          climbRate: velocity.climbRate * (1 - alpha) + ((newPosition.altitude - previousPosition.altitude) / deltaTime) * alpha,
        };
      }

      // 레이더에서 접근 속도 정보가 있으면 활용
      if (obs.sensor === 'RADAR' && obs.metadata?.radialVelocity !== undefined) {
        const bearing = obs.bearing! * Math.PI / 180;
        const radialVel = obs.metadata.radialVelocity;
        // 접근 속도를 속도 벡터에 반영 (가중 평균)
        velocity.vx = velocity.vx * 0.7 + (-radialVel * Math.sin(bearing)) * 0.3;
        velocity.vy = velocity.vy * 0.7 + (-radialVel * Math.cos(bearing)) * 0.3;
      }

      // 위치 히스토리 업데이트
      const history = [...track.positionHistory, newPosition];
      if (history.length > this.config.maxHistoryLength) {
        history.shift();
      }

      return {
        ...track,
        position: newPosition,
        previousPosition,
        velocity,
        positionHistory: history,
      };
    } else if (obs.bearing !== null) {
      // AUDIO: 방위각만 있는 경우
      // 기존 위치를 해당 방위각 방향으로 보정
      const currentDist = calculateDistance(this.basePosition, track.position);
      const newPosition = bearingRangeToPosition(
        this.basePosition,
        obs.bearing,
        currentDist,
        track.position.altitude
      );

      // 부드러운 보정 (30%만 적용)
      const correctedPosition: TrackPosition = {
        x: track.position.x * 0.7 + newPosition.x * 0.3,
        y: track.position.y * 0.7 + newPosition.y * 0.3,
        altitude: track.position.altitude,
      };

      return { ...track, position: correctedPosition, previousPosition };
    }

    return { ...track, previousPosition };
  }

  /**
   * (C) 분류 정보 업데이트
   */
  private updateClassification(track: FusedTrack, obs: SensorObservation): FusedTrack {
    // EO 센서의 분류 정보가 가장 신뢰도 높음
    if (obs.sensor === 'EO' && obs.classification) {
      return {
        ...track,
        classificationInfo: {
          classification: obs.classification,
          confidence: obs.classConfidence || 0.8,
          source: 'EO',
          armed: obs.metadata?.armed ?? track.classificationInfo.armed,
          sizeClass: obs.metadata?.sizeClass ?? track.classificationInfo.sizeClass,
          droneType: obs.metadata?.droneType ?? track.classificationInfo.droneType,
        },
      };
    }

    // 레이더: 분류는 없지만 존재 확인
    if (obs.sensor === 'RADAR') {
      // 기존 분류 유지, 신뢰도만 약간 증가
      const newConfidence = Math.min(track.classificationInfo.confidence + 0.05, 0.95);
      return {
        ...track,
        classificationInfo: {
          ...track.classificationInfo,
          confidence: newConfidence,
        },
      };
    }

    return track;
  }

  /**
   * (D) 센서 상태 업데이트
   */
  private updateSensorStatus(
    track: FusedTrack,
    obs: SensorObservation,
    currentTime: number
  ): FusedTrack {
    const sensors = { ...track.sensors };

    switch (obs.sensor) {
      case 'RADAR':
        sensors.radarSeen = true;
        sensors.radarLastSeen = currentTime;
        break;
      case 'AUDIO':
        sensors.audioHeard = true;
        sensors.audioLastSeen = currentTime;
        break;
      case 'EO':
        sensors.eoSeen = true;
        sensors.eoLastSeen = currentTime;
        break;
    }

    // 드론 ID 업데이트
    let droneId = track.droneId;
    if (obs.droneId && !droneId) {
      droneId = obs.droneId;
    }

    return { ...track, sensors, droneId };
  }

  // ============================================
  // 위협 평가 (새로운 threatScore 모듈 사용)
  // ============================================

  /**
   * 위협 점수 계산
   * threatScore.ts 모듈을 사용하여 계산
   */
  computeThreatScore(track: FusedTrack): number {
    const threatConfig: ThreatScoreConfig = {
      basePosition: this.basePosition,
      safeDistance: this.config.threatAssessment.safeDistance,
      dangerDistance: this.config.threatAssessment.dangerDistance,
      criticalDistance: 80,
      threatSpeedThreshold: 10,
      highSpeedThreshold: 25,
    };
    
    return computeThreat(track, threatConfig);
  }


  // ============================================
  // 품질 계산
  // ============================================

  /**
   * 트랙 품질 계산
   */
  private calculateTrackQuality(track: FusedTrack): number {
    let quality = 0;

    // 센서 다양성 (여러 센서로 탐지될수록 품질 높음)
    let sensorCount = 0;
    if (track.sensors.radarSeen) sensorCount++;
    if (track.sensors.audioHeard) sensorCount++;
    if (track.sensors.eoSeen) sensorCount++;
    quality += sensorCount * 0.2;

    // 존재 확률
    quality += track.existenceProb * 0.3;

    // 분류 신뢰도
    quality += track.classificationInfo.confidence * 0.3;

    // 업데이트 빈도 (미탐지가 적을수록 좋음)
    const freshness = 1 / (1 + track.missedUpdates * 0.1);
    quality += freshness * 0.2;

    return clamp(quality, 0, 1);
  }

  // ============================================
  // 센서 가중치
  // ============================================

  private getSensorExistenceWeight(sensor: SensorType): number {
    switch (sensor) {
      case 'RADAR':
        return this.config.sensorWeights.radarExistence;
      case 'AUDIO':
        return this.config.sensorWeights.audioExistence;
      case 'EO':
        return this.config.sensorWeights.eoExistence;
    }
  }

  private getSensorPositionWeight(sensor: SensorType): number {
    switch (sensor) {
      case 'RADAR':
        return this.config.sensorWeights.radarPosition;
      case 'AUDIO':
        return this.config.sensorWeights.audioBearing;
      case 'EO':
        return 0.8; // EO는 위치 정확도 높음
    }
  }

  // ============================================
  // 이벤트 생성
  // ============================================

  private createTrackUpdateEvent(track: FusedTrack, timestamp: number): TrackUpdateEvent {
    return {
      timestamp,
      event: 'track_update',
      track_id: track.id,
      drone_id: track.droneId,
      existence_prob: track.existenceProb,
      position: track.position,
      velocity: track.velocity,
      classification: track.classificationInfo.classification,
      threat_score: track.threatScore,
      threat_level: track.threatLevel,
      sensors: {
        radar: track.sensors.radarSeen,
        audio: track.sensors.audioHeard,
        eo: track.sensors.eoSeen,
      },
      quality: track.quality,
    };
  }

  // ============================================
  // 공개 API
  // ============================================

  /**
   * 모든 트랙 반환
   */
  getAllTracks(): FusedTrack[] {
    return Array.from(this.tracks.values());
  }

  /**
   * 특정 트랙 반환
   */
  getTrack(trackId: string): FusedTrack | undefined {
    return this.tracks.get(trackId);
  }

  /**
   * 드론 ID로 트랙 찾기
   */
  getTrackByDroneId(droneId: string): FusedTrack | undefined {
    const trackId = this.droneIdToTrackId.get(droneId);
    return trackId ? this.tracks.get(trackId) : undefined;
  }

  /**
   * 트랙 무력화 설정
   */
  setTrackNeutralized(droneId: string, neutralized: boolean = true): void {
    const trackId = this.droneIdToTrackId.get(droneId);
    if (trackId) {
      const track = this.tracks.get(trackId);
      if (track) {
        track.isNeutralized = neutralized;
      }
    }
  }

  /**
   * 트랙 회피 상태 설정
   */
  setTrackEvading(droneId: string, evading: boolean): void {
    const trackId = this.droneIdToTrackId.get(droneId);
    if (trackId) {
      const track = this.tracks.get(trackId);
      if (track) {
        track.isEvading = evading;
      }
    }
  }

  /**
   * 리셋
   */
  reset(): void {
    this.tracks.clear();
    this.droneIdToTrackId.clear();
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<FusionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 기지 위치 업데이트
   */
  updateBasePosition(position: TrackPosition): void {
    this.basePosition = position;
    this.config.threatAssessment.basePosition = position;
  }
}

export default SensorFusion;

