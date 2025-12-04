/**
 * 시뮬레이션 엔진
 * 
 * tick 단위로 모든 모델 업데이트
 * 모든 이벤트를 JSONL로 자동 로깅
 */

import { 
  SimulatorToC2Event, 
  DroneStateUpdateEvent,
  InterceptorUpdateEvent,
  InterceptResultEvent,
  SimulationStatusEvent,
  FusedTrackUpdateEvent,
  DEFAULT_RADAR_CONFIG,
  DEFAULT_INTERCEPTOR_CONFIG,
  DEFAULT_HOSTILE_DRONE_CONFIG,
  HostileDroneBehavior,
  RadarDetectionEvent,
  GuidanceMode,
  SensorType,
} from '../../shared/schemas';

import { SimulationWorld, HostileDrone, InterceptorDrone, Position3D } from './types';
import { RadarSensor } from './sensors/radar';
import { AcousticSensor } from './sensors/acousticSensor';
import { EOSensor, EODetectionEvent } from './sensors/eoSensor';
import { createHostileDrone, updateHostileDrone, setDroneBehavior } from './models/hostileDrone';
import { 
  createInterceptor, 
  updateInterceptor, 
  launchInterceptor, 
  resetInterceptor, 
  ExtendedInterceptorDrone,
  setGuidanceMode,
  getInterceptorPNDebugInfo,
} from './models/interceptor';
import { getLogger, ExperimentLogger } from './core/logging/logger';
import { GeneratedScenario, getGenerator } from './core/scenario/generator';
import * as LogEvents from './core/logging/eventSchemas';
import { SensorFusion, SensorObservation, FusedTrack } from './core/fusion';
import { 
  EngagementManager, 
  EngagementMode, 
  EngagementDecision,
  EngageStartLogEvent,
  EngageEndLogEvent,
  AbortReason,
} from './core/engagement';
import { getConfig } from './config';

export class SimulationEngine {
  private world: SimulationWorld;
  private radarSensor: RadarSensor;
  private acousticSensor: AcousticSensor;
  private eoSensor: EOSensor;  // EO 카메라 센서
  private sensorFusion: SensorFusion;
  private engagementManager: EngagementManager;  // 교전 관리자
  private eventQueue: SimulatorToC2Event[] = [];
  private onEvent: (event: SimulatorToC2Event) => void;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private logger: ExperimentLogger;
  private currentScenarioId: number | string = 1;
  private evadingDrones: Set<string> = new Set();  // 회피 중인 드론 추적
  private defaultGuidanceMode: GuidanceMode = 'PN';  // 기본 유도 모드
  private fusionEnabled: boolean = true;  // 센서 융합 활성화 여부
  private autoEngageEnabled: boolean = false;  // 자동 교전 활성화 여부

  constructor(onEvent: (event: SimulatorToC2Event) => void) {
    this.onEvent = onEvent;
    const config = getConfig();
    this.logger = getLogger({ 
      logsDir: config.logsDir, 
      enabled: config.logEnabled, 
      consoleOutput: config.logConsoleOutput 
    });
    
    const basePosition: Position3D = { x: 0, y: 0, altitude: 50 };
    
    this.world = {
      time: 0,
      isRunning: false,
      speedMultiplier: 1,
      tickInterval: 100, // 100ms = 0.1초
      hostileDrones: new Map(),
      interceptors: new Map(),
      radarConfig: DEFAULT_RADAR_CONFIG,
      basePosition,
    };

    this.radarSensor = new RadarSensor(basePosition, this.world.radarConfig);
    this.acousticSensor = new AcousticSensor(basePosition);
    this.eoSensor = new EOSensor(basePosition, {
      maxRange: 350,          // 350m 이내 탐지
      detectionInterval: 1.0, // 1.0초 간격 (더 자주)
      baseDetectionProb: 0.7, // 70% 기본 확률
      hostileAccuracy: 0.92,  // HOSTILE → HOSTILE 92%
      civilAccuracy: 0.85,    // CIVIL → CIVIL 85%
    });
    this.sensorFusion = new SensorFusion(basePosition);
    this.engagementManager = new EngagementManager();  // 교전 관리자 초기화
  }

  /**
   * 시뮬레이션 시작
   */
  start(): void {
    if (this.world.isRunning) return;
    
    this.world.isRunning = true;
    this.tickTimer = setInterval(() => {
      this.tick();
    }, this.world.tickInterval / this.world.speedMultiplier);
    
    // 로깅: simulation_control
    this.logger.log({
      timestamp: this.world.time,
      event: 'simulation_control',
      action: 'start',
    });
    
    this.emitStatusEvent();
  }

  /**
   * 시뮬레이션 일시정지
   */
  pause(): void {
    if (!this.world.isRunning) return;
    
    this.world.isRunning = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    
    // 로깅: simulation_control
    this.logger.log({
      timestamp: this.world.time,
      event: 'simulation_control',
      action: 'pause',
    });
    
    this.emitStatusEvent();
  }

  /**
   * 시뮬레이션 리셋
   */
  reset(): void {
    this.pause();
    
    // 시나리오 종료 로깅
    this.logger.endScenario(this.world.time);
    
    this.world.time = 0;
    this.world.hostileDrones.clear();
    this.world.interceptors.clear();
    this.eventQueue = [];
    this.evadingDrones.clear();
    
    // 센서 및 융합 모듈 리셋
    this.acousticSensor.reset();
    this.sensorFusion.reset();
    
    this.emitStatusEvent();
  }

  /**
   * 속도 배율 설정
   */
  setSpeedMultiplier(multiplier: number): void {
    this.world.speedMultiplier = multiplier;
    
    // 로깅: simulation_control
    this.logger.log({
      timestamp: this.world.time,
      event: 'simulation_control',
      action: 'speed_change',
      speed_multiplier: multiplier,
    });
    
    if (this.world.isRunning && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = setInterval(() => {
        this.tick();
      }, this.world.tickInterval / this.world.speedMultiplier);
    }
  }

  /**
   * 시나리오 로드
   */
  loadScenario(scenarioId: number | string): void {
    this.reset();
    this.currentScenarioId = scenarioId;
    
    // 기본 시나리오 또는 생성된 시나리오 로드
    if (typeof scenarioId === 'number') {
      switch (scenarioId) {
        case 1:
          this.loadScenario1();
          break;
        case 2:
          this.loadScenario2();
          break;
        case 3:
          this.loadScenario3();
          break;
        default:
          this.loadScenario1();
      }
    } else {
      // 생성된 시나리오 로드
      const generator = getGenerator();
      const scenario = generator.loadScenario(scenarioId);
      if (scenario) {
        this.loadGeneratedScenario(scenario);
      } else {
        this.loadScenario1();
      }
    }

    // 시나리오 시작 로깅
    const scenarioName = typeof scenarioId === 'number' 
      ? `기본 시나리오 ${scenarioId}`
      : `생성 시나리오 ${scenarioId}`;
    
    this.logger.startScenario(
      scenarioId,
      scenarioName,
      {
        drone_count: this.world.hostileDrones.size,
        interceptor_count: this.world.interceptors.size,
        radar_config: this.world.radarConfig,
      }
    );

    // 드론 생성 이벤트 로깅
    this.world.hostileDrones.forEach(drone => {
      this.logger.log({
        timestamp: 0,
        event: 'drone_spawned',
        drone_id: drone.id,
        position: drone.position,
        velocity: drone.velocity,
        behavior: drone.behavior,
        is_hostile: drone.is_hostile ?? true,
        true_label: drone.true_label,  // Ground truth 레이블 포함
      });
    });

    this.emitStatusEvent();
  }

  /**
   * 생성된 시나리오 로드
   */
  private loadGeneratedScenario(scenario: GeneratedScenario): void {
    // 레이더 설정 적용
    this.world.radarConfig = scenario.radar_config;
    this.radarSensor = new RadarSensor(this.world.basePosition, scenario.radar_config);

    // 드론 생성
    scenario.drones.forEach(droneData => {
      const drone = createHostileDrone(
        droneData.position,
        droneData.velocity,
        droneData.behavior,
        droneData.config,
        droneData.target_position,
        droneData.true_label  // Ground truth 레이블 포함
      );
      // ID 및 확장 속성 덮어쓰기
      const droneWithId = { 
        ...drone, 
        id: droneData.id,
        is_hostile: droneData.is_hostile,
        drone_type: droneData.drone_type,
        armed: droneData.armed,
        size_class: droneData.size_class,
        recommended_method: droneData.recommended_method || undefined,  // null을 undefined로 변환
      };
      this.world.hostileDrones.set(droneData.id, droneWithId);
    });

    // 요격기 생성 (기본 유도 모드 적용)
    for (let i = 0; i < scenario.interceptor_count; i++) {
      const interceptor = createInterceptor(
        this.world.basePosition, 
        DEFAULT_INTERCEPTOR_CONFIG,
        this.defaultGuidanceMode
      );
      this.world.interceptors.set(interceptor.id, interceptor);
    }
  }

  /**
   * 시나리오 1: 기본 혼합
   */
  private loadScenario1(): void {
    const hostile1 = createHostileDrone(
      { x: 600, y: 500, altitude: 80 },
      { vx: -12, vy: -10, climbRate: -0.5 },
      'NORMAL',
      DEFAULT_HOSTILE_DRONE_CONFIG,
      undefined,
      'HOSTILE'  // Ground truth 레이블
    );
    
    const hostile2 = createHostileDrone(
      { x: -400, y: 200, altitude: 120 },
      { vx: 5, vy: 8, climbRate: 0 },
      'NORMAL',
      DEFAULT_HOSTILE_DRONE_CONFIG,
      undefined,
      'CIVIL'  // Ground truth 레이블
    );
    
    const hostile3 = createHostileDrone(
      { x: 100, y: -450, altitude: 150 },
      { vx: 0, vy: 5, climbRate: 0 },
      'RECON',
      DEFAULT_HOSTILE_DRONE_CONFIG,
      { x: 0, y: 0, altitude: 150 },
      'HOSTILE'  // Ground truth 레이블
    );

    this.world.hostileDrones.set(hostile1.id, hostile1);
    this.world.hostileDrones.set(hostile2.id, hostile2);
    this.world.hostileDrones.set(hostile3.id, hostile3);

    const int1 = createInterceptor(this.world.basePosition, DEFAULT_INTERCEPTOR_CONFIG, this.defaultGuidanceMode);
    const int2 = createInterceptor(this.world.basePosition, DEFAULT_INTERCEPTOR_CONFIG, this.defaultGuidanceMode);
    
    this.world.interceptors.set(int1.id, int1);
    this.world.interceptors.set(int2.id, int2);
  }

  /**
   * 시나리오 2: 다중 위협
   */
  private loadScenario2(): void {
    const directions = [
      { x: 700, y: 100, vx: -15, vy: -2 },
      { x: 100, y: 700, vx: -2, vy: -15 },
      { x: -600, y: 100, vx: 12, vy: -2 },
      { x: 100, y: -600, vx: -2, vy: 12 },
    ];

    directions.forEach((dir, i) => {
      const hostile = createHostileDrone(
        { x: dir.x, y: dir.y, altitude: 60 + i * 20 },
        { vx: dir.vx, vy: dir.vy, climbRate: 0 },
        'ATTACK_RUN',
        DEFAULT_HOSTILE_DRONE_CONFIG,
        undefined,
        'HOSTILE'  // Ground truth 레이블
      );
      this.world.hostileDrones.set(hostile.id, hostile);
    });

    for (let i = 0; i < 3; i++) {
      const interceptor = createInterceptor(this.world.basePosition, DEFAULT_INTERCEPTOR_CONFIG, this.defaultGuidanceMode);
      this.world.interceptors.set(interceptor.id, interceptor);
    }
  }

  /**
   * 시나리오 3: 은밀 접근
   */
  private loadScenario3(): void {
    const hostile1 = createHostileDrone(
      { x: 400, y: 300, altitude: 40 },
      { vx: -2, vy: -1.5, climbRate: 0 },
      'NORMAL',
      { ...DEFAULT_HOSTILE_DRONE_CONFIG, cruise_speed: 5 },
      undefined,
      'HOSTILE'  // Ground truth 레이블
    );
    
    const hostile2 = createHostileDrone(
      { x: -350, y: 400, altitude: 35 },
      { vx: 1.5, vy: -2, climbRate: 0.1 },
      'NORMAL',
      { ...DEFAULT_HOSTILE_DRONE_CONFIG, cruise_speed: 4 },
      undefined,
      'CIVIL'  // Ground truth 레이블
    );
    
    const hostile3 = createHostileDrone(
      { x: 800, y: -200, altitude: 200 },
      { vx: -25, vy: 5, climbRate: -1 },
      'NORMAL',
      { ...DEFAULT_HOSTILE_DRONE_CONFIG, cruise_speed: 25 },
      undefined,
      'HOSTILE'  // Ground truth 레이블
    );

    this.world.hostileDrones.set(hostile1.id, hostile1);
    this.world.hostileDrones.set(hostile2.id, hostile2);
    this.world.hostileDrones.set(hostile3.id, hostile3);

    for (let i = 0; i < 2; i++) {
      const interceptor = createInterceptor(this.world.basePosition, DEFAULT_INTERCEPTOR_CONFIG, this.defaultGuidanceMode);
      this.world.interceptors.set(interceptor.id, interceptor);
    }
  }

  /**
   * 한 틱 실행
   */
  private tick(): void {
    const deltaTime = this.world.tickInterval / 1000;
    this.world.time += deltaTime;

    // 1. 적 드론 업데이트
    this.world.hostileDrones.forEach((drone, id) => {
      const prevEvading = drone.isEvading;
      
      const updated = updateHostileDrone(
        drone,
        deltaTime,
        this.world.basePosition,
        this.world.interceptors
      );
      this.world.hostileDrones.set(id, updated);

      // 회피 시작/종료 로깅 및 센서 융합 업데이트
      if (!prevEvading && updated.isEvading) {
        this.evadingDrones.add(id);
        this.logger.log({
          timestamp: this.world.time,
          event: 'evade_start',
          drone_id: id,
          trigger: 'interceptor_approach',
        });
        // 센서 융합에 회피 상태 반영
        if (this.fusionEnabled) {
          this.sensorFusion.setTrackEvading(id, true);
        }
      } else if (prevEvading && !updated.isEvading) {
        this.evadingDrones.delete(id);
        this.logger.log({
          timestamp: this.world.time,
          event: 'evade_end',
          drone_id: id,
          duration: 0,
          result: 'escaped',
        });
        // 센서 융합에 회피 종료 반영
        if (this.fusionEnabled) {
          this.sensorFusion.setTrackEvading(id, false);
        }
      }

      // 드론 상태 이벤트 발생 (주기적으로)
      if (Math.floor(this.world.time * 2) % 2 === 0) {
        this.emitDroneStateEvent(updated);
      }
    });

    // 2. 요격 드론 업데이트
    this.world.interceptors.forEach((interceptor, id) => {
      const target = interceptor.targetId 
        ? this.world.hostileDrones.get(interceptor.targetId) || null
        : null;

      const { interceptor: updated, interceptResult } = updateInterceptor(
        interceptor as ExtendedInterceptorDrone,
        deltaTime,
        target,
        this.world.basePosition,
        this.world.time
      );

      this.world.interceptors.set(id, updated as InterceptorDrone);

      if (interceptResult) {
        this.handleInterceptResult(updated, target!, interceptResult);
      }

      this.emitInterceptorEvent(updated);
    });

    // 3. 레이더 스캔 및 센서 융합
    const radarEvents = this.radarSensor.scan(this.world.time, this.world.hostileDrones);
    radarEvents.forEach(event => {
      this.onEvent(event);
      
      // 레이더 탐지 로깅
      this.logger.log({
        timestamp: this.world.time,
        event: 'radar_detection',
        drone_id: event.drone_id,
        range: event.range,
        bearing: event.bearing,
        altitude: event.altitude,
        radial_velocity: event.radial_velocity,
        confidence: event.confidence,
        is_false_alarm: event.is_false_alarm || false,
        is_first_detection: false,
      });

      // 센서 융합: 레이더 → Observation 변환
      if (this.fusionEnabled) {
        const observation: SensorObservation = {
          sensor: 'RADAR',
          time: this.world.time,
          droneId: event.is_false_alarm ? null : event.drone_id,
          bearing: event.bearing,
          range: event.range,
          altitude: event.altitude,
          confidence: event.confidence,
          metadata: {
            radialVelocity: event.radial_velocity,
            isFalseAlarm: event.is_false_alarm,
          },
        };
        this.processObservation(observation);
      }
    });

    // 4. 음향 센서 스캔 및 센서 융합
    const audioEvents = this.acousticSensor.scan(this.world.time, this.world.hostileDrones);
    audioEvents.forEach(event => {
      // 원시 이벤트 전송
      this.onEvent({
        type: 'audio_detection',
        timestamp: event.timestamp,
        drone_id: event.drone_id || '',
        state: event.state,
        confidence: event.confidence,
        estimated_distance: event.estimated_distance,
        estimated_bearing: event.estimated_bearing,
      });

      // 음향 탐지 로깅
      this.logger.log({
        timestamp: this.world.time,
        event: 'audio_detection',
        drone_id: event.drone_id,
        state: event.state as LogEvents.DroneActivityState,
        confidence: event.confidence,
        estimated_distance: event.estimated_distance,
        estimated_bearing: event.estimated_bearing,
        is_first_detection: event.is_first_detection,
        is_false_alarm: event.is_false_alarm,
        sensor: 'AUDIO',
      });

      // 센서 융합: 음향 → Observation 변환
      if (this.fusionEnabled && !event.is_false_alarm) {
        const observation: SensorObservation = {
          sensor: 'AUDIO',
          time: this.world.time,
          droneId: event.drone_id || null,
          bearing: event.estimated_bearing || null,
          range: event.estimated_distance || null,
          altitude: null,
          confidence: event.confidence,
          metadata: {
            activityState: event.state,
            isFirstDetection: event.is_first_detection,
          },
        };
        this.processObservation(observation);
      }
    });

    // 5. 센서 융합 트랙 업데이트 (시간 경과에 따른 감쇠)
    if (this.fusionEnabled) {
      const { updated, dropped } = this.sensorFusion.updateTracks(this.world.time);
      
      // 업데이트된 트랙 이벤트 전송
      updated.forEach(track => {
        this.emitFusedTrackEvent(track);
      });

      // 소멸된 트랙 이벤트 전송
      dropped.forEach(dropEvent => {
        this.onEvent({
          type: 'track_dropped',
          timestamp: dropEvent.timestamp,
          track_id: dropEvent.track_id,
          reason: dropEvent.reason,
          lifetime: dropEvent.lifetime,
        });
        
        // 로깅 (타입 안전하게)
        this.logger.log({
          timestamp: this.world.time,
          event: 'track_dropped' as const,
          track_id: dropEvent.track_id,
          reason: dropEvent.reason,
          lifetime: dropEvent.lifetime,
        } as any);
      });
    }

    // 5.5 EO 카메라 센서 스캔 (300m 이내 드론에 대해)
    if (this.fusionEnabled) {
      this.processEOSensorScan();
    }

    // 6. 자동 교전 의사결정 (Threat 기반)
    if (this.autoEngageEnabled) {
      this.processAutoEngagement();
    }

    // 7. 교전 중단 조건 확인
    this.checkEngagementAbortConditions();

    // 8. 주기적 상태 이벤트 (5초마다)
    if (Math.floor(this.world.time) % 5 === 0 && this.world.time % 1 < deltaTime) {
      this.emitStatusEvent();
    }
  }

  /**
   * 센서 관측치 처리 (센서 융합)
   */
  private processObservation(observation: SensorObservation): void {
    const result = this.sensorFusion.processObservation(observation, this.world.time);
    
    if (result) {
      // 트랙 이벤트 전송
      if (result.event.event === 'track_created') {
        this.onEvent({
          type: 'track_created',
          timestamp: result.event.timestamp,
          track_id: result.event.track_id,
          initial_sensor: result.event.initial_sensor,
          position: result.event.position,
          confidence: result.event.confidence,
        });
        
        // 드론 매칭 확인 및 true_label 가져오기
        const matchedDrone = result.track.droneId 
          ? this.world.hostileDrones.get(result.track.droneId) 
          : null;
        const trueLabel = matchedDrone?.true_label;
        
        // 로깅 (타입 안전하게)
        this.logger.log({
          timestamp: this.world.time,
          event: 'track_created' as const,
          track_id: result.event.track_id,
          drone_id: result.track.droneId || undefined,
          initial_sensor: result.event.initial_sensor,
          position: result.event.position,
          true_label: trueLabel,
        } as any);
      } else {
        this.emitFusedTrackEvent(result.track);
      }
    }
  }

  /**
   * 융합 트랙 이벤트 전송
   */
  private emitFusedTrackEvent(track: FusedTrack): void {
    // 드론 매칭 확인 및 true_label 가져오기
    const matchedDrone = track.droneId 
      ? this.world.hostileDrones.get(track.droneId) 
      : null;
    const trueLabel = matchedDrone?.true_label;
    
    const event: FusedTrackUpdateEvent = {
      type: 'fused_track_update',
      timestamp: this.world.time,
      track_id: track.id,
      drone_id: track.droneId,
      existence_prob: track.existenceProb,
      position: track.position,
      velocity: track.velocity,
      classification: track.classificationInfo.classification,
      class_info: {
        classification: track.classificationInfo.classification,
        confidence: track.classificationInfo.confidence,
        armed: track.classificationInfo.armed,
        sizeClass: track.classificationInfo.sizeClass,
        droneType: track.classificationInfo.droneType,
      },
      threat_score: track.threatScore,
      threat_level: track.threatLevel,
      sensors: {
        radar: track.sensors.radarSeen,
        audio: track.sensors.audioHeard,
        eo: track.sensors.eoSeen,
      },
      quality: track.quality,
      is_evading: track.isEvading,
      is_neutralized: track.isNeutralized,
    };
    
    this.onEvent(event);

    // 주기적 로깅 (50% 확률, 중요 이벤트는 항상 로깅)
    const shouldLog = Math.random() < 0.5 || 
                      track.sensors.eoSeen ||  // EO 탐지 시 항상 로깅
                      track.threatScore >= 70; // 고위협 트랙 항상 로깅
    if (shouldLog) {
      this.logger.log({
        timestamp: this.world.time,
        event: 'fused_track_update' as const,
        track_id: track.id,
        drone_id: track.droneId || undefined,
        // 존재 확률
        existence_prob: Math.round(track.existenceProb * 1000) / 1000,
        // Ground truth 레이블
        true_label: trueLabel,
        // 융합된 위치
        fused_position: {
          x: Math.round(track.position.x * 10) / 10,
          y: Math.round(track.position.y * 10) / 10,
          altitude: Math.round(track.position.altitude * 10) / 10,
        },
        // 융합된 속도
        fused_velocity: {
          vx: Math.round(track.velocity.vx * 10) / 10,
          vy: Math.round(track.velocity.vy * 10) / 10,
          climbRate: Math.round(track.velocity.climbRate * 10) / 10,
        },
        // 융합된 분류
        fused_classification: track.classificationInfo.classification,
        class_confidence: Math.round(track.classificationInfo.confidence * 1000) / 1000,
        armed: track.classificationInfo.armed,
        // 융합된 위협 점수
        fused_threat_score: track.threatScore,
        threat_level: track.threatLevel,
        // 센서 상태
        sensors: {
          radar: track.sensors.radarSeen,
          audio: track.sensors.audioHeard,
          eo: track.sensors.eoSeen,
        },
        // 품질 점수
        quality: Math.round(track.quality * 1000) / 1000,
        // 행동 상태
        is_evading: track.isEvading,
      } as any);
    }
  }

  /**
   * 요격 결과 처리
   */
  private handleInterceptResult(
    interceptor: ExtendedInterceptorDrone,
    target: HostileDrone,
    result: string
  ): void {
    const success = result === 'SUCCESS';
    
    if (success) {
      const updated = { ...target, isNeutralized: true };
      this.world.hostileDrones.set(target.id, updated);
      
      // 센서 융합에 무력화 상태 반영
      if (this.fusionEnabled) {
        this.sensorFusion.setTrackNeutralized(target.id, true);
      }
    }

    // 교전 완료 처리
    this.completeEngagementForDrone(target.id, success);

    const event: InterceptResultEvent = {
      type: 'intercept_result',
      timestamp: this.world.time,
      interceptor_id: interceptor.id,
      target_id: target.id,
      result: result as any,
      details: result === 'SUCCESS' ? '요격 성공' : 
               result === 'EVADED' ? '타겟 회피' :
               result === 'MISS' ? '요격 실패' : '요격 중단',
    };
    this.onEvent(event);

    // 요격 결과 로깅
    const reasonMap: Record<string, LogEvents.InterceptFailureReason | undefined> = {
      '요격 성공': undefined,
      '타겟 회피': 'evaded',
      '요격 실패': 'target_lost',
      '요격 중단': 'timeout',
    };
    
    // PN 통계 정보
    const pnStats = interceptor.pnState ? {
      avg_closing_speed: interceptor.pnState.lastClosingSpeed,
      max_lambda_dot: interceptor.pnState.lastLambdaDot,
      nav_constant: interceptor.pnState.pnConfig.navConstant,
    } : undefined;
    
    this.logger.log({
      timestamp: this.world.time,
      event: 'intercept_result',
      interceptor_id: interceptor.id,
      target_id: target.id,
      method: interceptor.method || 'RAM',
      guidance_mode: interceptor.guidanceMode,
      result: result.toLowerCase() as 'success' | 'miss' | 'evaded' | 'aborted',
      reason: reasonMap[event.details || ''] as LogEvents.InterceptFailureReason,
      engagement_duration: interceptor.launchTime 
        ? this.world.time - interceptor.launchTime 
        : 0,
      pn_stats: pnStats,
    });
  }

  /**
   * 드론 상태 이벤트 발생
   */
  private emitDroneStateEvent(drone: HostileDrone): void {
    const event: DroneStateUpdateEvent = {
      type: 'drone_state_update',
      timestamp: this.world.time,
      drone_id: drone.id,
      position: drone.position,
      velocity: drone.velocity,
      behavior: drone.behavior,
      is_evading: drone.isEvading,
    };
    this.onEvent(event);

    // 트랙 업데이트 로깅 (간헐적)
    if (Math.random() < 0.1) {
      const distance = Math.sqrt(drone.position.x ** 2 + drone.position.y ** 2);
      this.logger.log({
        timestamp: this.world.time,
        event: 'track_update',
        drone_id: drone.id,
        position: drone.position,
        velocity: drone.velocity,
        behavior: drone.behavior,
        is_evading: drone.isEvading,
        distance_to_base: distance,
      });
    }
  }

  /**
   * 요격 드론 상태 이벤트 발생
   */
  private emitInterceptorEvent(interceptor: ExtendedInterceptorDrone): void {
    const target = interceptor.targetId 
      ? this.world.hostileDrones.get(interceptor.targetId)
      : null;

    // PN 디버그 정보 추출
    const pnDebug = interceptor.pnState ? {
      closing_speed: interceptor.pnState.lastClosingSpeed,
      lambda_dot: interceptor.pnState.lastLambdaDot,
      commanded_accel: interceptor.pnState.lastCommandedAccel,
    } : undefined;

    const event: InterceptorUpdateEvent = {
      type: 'interceptor_update',
      timestamp: this.world.time,
      interceptor_id: interceptor.id,
      target_id: interceptor.targetId,
      state: interceptor.state as any, // 상태 타입 호환성
      position: interceptor.position,
      distance_to_target: target 
        ? Math.sqrt(
            (interceptor.position.x - target.position.x) ** 2 +
            (interceptor.position.y - target.position.y) ** 2
          )
        : undefined,
      method: interceptor.method,
      guidance_mode: interceptor.guidanceMode,
      eo_confirmed: interceptor.eoConfirmed,
      pn_debug: pnDebug,
    };
    this.onEvent(event);
  }

  /**
   * 시뮬레이션 상태 이벤트 발생
   */
  private emitStatusEvent(): void {
    const event: SimulationStatusEvent = {
      type: 'simulation_status',
      timestamp: this.world.time,
      sim_time: this.world.time,
      is_running: this.world.isRunning,
      drone_count: this.world.hostileDrones.size,
      interceptor_count: this.world.interceptors.size,
    };
    this.onEvent(event);
  }

  // ============================================
  // 외부 명령 처리
  // ============================================

  /**
   * 요격 명령 처리
   */
  handleEngageCommand(
    droneId: string, 
    interceptorId?: string, 
    issuedBy: 'user' | 'auto' = 'user',
    method: LogEvents.InterceptMethod = 'RAM',
    guidanceMode?: GuidanceMode  // 유도 모드 지정 가능
  ): boolean {
    const target = this.world.hostileDrones.get(droneId);
    if (!target || target.isNeutralized) return false;

    let interceptor: ExtendedInterceptorDrone | undefined;
    
    if (interceptorId) {
      interceptor = this.world.interceptors.get(interceptorId) as ExtendedInterceptorDrone;
    } else {
      this.world.interceptors.forEach((int) => {
        const state = (int as ExtendedInterceptorDrone).state;
        if ((state === 'IDLE' || state === 'STANDBY') && !interceptor) {
          interceptor = int as ExtendedInterceptorDrone;
        }
      });
    }

    if (!interceptor) return false;
    const state = interceptor.state;
    if (state !== 'IDLE' && state !== 'STANDBY') return false;

    // 유도 모드 설정 (지정된 경우 사용, 아니면 기본값)
    const effectiveGuidanceMode = guidanceMode || this.defaultGuidanceMode;
    
    const launched = launchInterceptor(interceptor, droneId, this.world.time, method, effectiveGuidanceMode);
    this.world.interceptors.set(launched.id, launched as InterceptorDrone);

    // 교전 명령 로깅
    this.logger.log({
      timestamp: this.world.time,
      event: 'engage_command',
      drone_id: droneId,
      method: method,
      guidance_mode: effectiveGuidanceMode,
      interceptor_id: launched.id,
      issued_by: issuedBy,
    });

    // 요격기 발진 로깅
    this.logger.log({
      timestamp: this.world.time,
      event: 'interceptor_spawned',
      interceptor_id: launched.id,
      position: launched.position,
      target_id: droneId,
    });
    
    return true;
  }

  /**
   * 드론 행동 변경
   */
  setDroneBehaviorMode(droneId: string, behavior: HostileDroneBehavior): boolean {
    const drone = this.world.hostileDrones.get(droneId);
    if (!drone) return false;

    const updated = setDroneBehavior(drone, behavior);
    this.world.hostileDrones.set(droneId, updated);
    return true;
  }

  /**
   * manual_action 로깅 (UI에서 호출)
   */
  logManualAction(action: string, targetId?: string, details?: Record<string, unknown>): void {
    this.logger.log({
      timestamp: this.world.time,
      event: 'manual_action',
      action,
      target_id: targetId,
      details,
    });
  }

  /**
   * 현재 상태 반환
   */
  getState(): {
    time: number;
    isRunning: boolean;
    drones: HostileDrone[];
    interceptors: InterceptorDrone[];
    radarConfig: typeof DEFAULT_RADAR_CONFIG;
    fusedTracks: FusedTrack[];
    fusionEnabled: boolean;
  } {
    return {
      time: this.world.time,
      isRunning: this.world.isRunning,
      drones: Array.from(this.world.hostileDrones.values()),
      interceptors: Array.from(this.world.interceptors.values()),
      radarConfig: this.world.radarConfig,
      fusedTracks: this.sensorFusion.getAllTracks(),
      fusionEnabled: this.fusionEnabled,
    };
  }

  /**
   * 센서 융합 활성화/비활성화
   */
  setFusionEnabled(enabled: boolean): void {
    this.fusionEnabled = enabled;
    console.log(`[SimulationEngine] 센서 융합 ${enabled ? '활성화' : '비활성화'}`);
  }

  /**
   * 융합 트랙 반환
   */
  getFusedTracks(): FusedTrack[] {
    return this.sensorFusion.getAllTracks();
  }

  /**
   * 특정 드론의 융합 트랙 반환
   */
  getFusedTrackByDroneId(droneId: string): FusedTrack | undefined {
    return this.sensorFusion.getTrackByDroneId(droneId);
  }

  /**
   * EO 정찰 결과 처리 (외부에서 호출)
   */
  processEOConfirmation(
    droneId: string,
    interceptorId: string,
    classification: 'HOSTILE' | 'FRIENDLY' | 'NEUTRAL' | 'UNKNOWN',
    armed: boolean | null,
    sizeClass: 'SMALL' | 'MEDIUM' | 'LARGE' | null,
    droneType: string | null,
    confidence: number
  ): void {
    if (!this.fusionEnabled) return;

    // null을 undefined로 변환
    const observation: SensorObservation = {
      sensor: 'EO',
      time: this.world.time,
      droneId,
      bearing: null,
      range: null,
      altitude: null,
      confidence,
      classification: classification === 'NEUTRAL' ? 'CIVIL' : classification,
      classConfidence: confidence,
      metadata: {
        armed: armed ?? undefined,
        sizeClass: sizeClass ?? undefined,
        droneType: droneType ?? undefined,
      },
    };

    this.processObservation(observation);

    // EO 확인 로깅
    this.logger.log({
      timestamp: this.world.time,
      event: 'eo_confirmation',
      drone_id: droneId,
      interceptor_id: interceptorId,
      classification: classification as LogEvents.Classification,
      armed: armed,
      size_class: sizeClass as LogEvents.DroneSize | null,
      drone_type: droneType ? (droneType as LogEvents.DroneType) : undefined,
      confidence,
      sensor: 'EO',
    });
  }

  /**
   * 레이더 설정 반환
   */
  getRadarConfig(): typeof DEFAULT_RADAR_CONFIG {
    return this.world.radarConfig;
  }

  /**
   * 로거 반환
   */
  getLogger(): ExperimentLogger {
    return this.logger;
  }

  // ============================================
  // 유도 모드 관련 API
  // ============================================

  /**
   * 기본 유도 모드 설정
   */
  setDefaultGuidanceMode(mode: GuidanceMode): void {
    this.defaultGuidanceMode = mode;
    console.log(`[SimulationEngine] 기본 유도 모드 변경: ${mode}`);
    
    // 로깅
    this.logger.log({
      timestamp: this.world.time,
      event: 'manual_action',
      action: 'set_guidance_mode',
      details: { guidance_mode: mode },
    });
  }

  /**
   * 현재 기본 유도 모드 반환
   */
  getDefaultGuidanceMode(): GuidanceMode {
    return this.defaultGuidanceMode;
  }

  /**
   * 특정 요격기의 유도 모드 변경
   */
  setInterceptorGuidanceMode(interceptorId: string, mode: GuidanceMode): boolean {
    const interceptor = this.world.interceptors.get(interceptorId) as ExtendedInterceptorDrone;
    if (!interceptor) return false;
    
    const updated = setGuidanceMode(interceptor, mode);
    this.world.interceptors.set(interceptorId, updated as InterceptorDrone);
    
    console.log(`[SimulationEngine] 요격기 ${interceptorId} 유도 모드 변경: ${mode}`);
    return true;
  }

  /**
   * 모든 요격기 유도 모드 정보 반환
   */
  getInterceptorGuidanceInfo(): Array<{
    id: string;
    guidanceMode: GuidanceMode;
    pnDebug?: Record<string, unknown>;
  }> {
    const result: Array<{
      id: string;
      guidanceMode: GuidanceMode;
      pnDebug?: Record<string, unknown>;
    }> = [];
    
    this.world.interceptors.forEach((interceptor, id) => {
      const ext = interceptor as ExtendedInterceptorDrone;
      result.push({
        id,
        guidanceMode: ext.guidanceMode || 'PN',
        pnDebug: getInterceptorPNDebugInfo(ext) || undefined,
      });
    });
    
    return result;
  }

  // ============================================
  // EO 카메라 센서 스캔
  // ============================================

  /**
   * EO 카메라 센서 스캔 처리
   * EOSensor 모듈을 사용하여 300m 이내 드론 탐지
   */
  private processEOSensorScan(): void {
    const currentTime = this.world.time;

    // EOSensor로 드론 스캔
    const eoEvents = this.eoSensor.scan(currentTime, this.world.hostileDrones);

    eoEvents.forEach(event => {
      // SensorObservation으로 변환
      const observation = EOSensor.toObservation(event);

      // 센서 융합 처리
      this.processObservation(observation);

      // EO 탐지 이벤트 전송 (C2 UI로)
      this.onEvent({
        type: 'eo_detection',
        timestamp: event.timestamp,
        drone_id: event.drone_id,
        bearing: event.bearing,
        range: event.range,
        altitude: event.altitude,
        classification: event.classification,
        confidence: event.confidence,
        class_confidence: event.class_confidence,
        armed: event.armed,
        size_class: event.size_class,
        drone_type: event.drone_type,
        is_first_detection: event.is_first_detection,
      } as any);

      // 상세 로깅 (EO 탐지 이벤트)
      this.logger.log({
        timestamp: currentTime,
        event: 'eo_detection' as const,
        drone_id: event.drone_id,
        bearing: event.bearing,
        range: event.range,
        altitude: event.altitude,
        classification: event.classification as LogEvents.Classification,
        class_confidence: event.class_confidence,
        confidence: event.confidence,
        armed: event.armed,
        size_class: event.size_class as LogEvents.DroneSize ?? undefined,
        drone_type: event.drone_type as LogEvents.DroneType ?? undefined,
        is_first_detection: event.is_first_detection,
        sensor: 'EO',
      } as any);

      // eo_confirmation 이벤트도 기록 (기존 호환성)
      this.logger.log({
        timestamp: currentTime,
        event: 'eo_confirmation',
        drone_id: event.drone_id,
        interceptor_id: 'AUTO_EO',
        classification: event.classification as LogEvents.Classification,
        armed: event.armed,
        size_class: event.size_class as LogEvents.DroneSize ?? undefined,
        drone_type: event.drone_type as LogEvents.DroneType ?? undefined,
        confidence: event.confidence,
        class_confidence: event.class_confidence,
        sensor: 'EO',
      });
    });
  }

  // ============================================
  // 자동 교전 의사결정 시스템
  // ============================================

  /**
   * 자동 교전 활성화/비활성화
   */
  setAutoEngageEnabled(enabled: boolean): void {
    this.autoEngageEnabled = enabled;
    console.log(`[SimulationEngine] 자동 교전 ${enabled ? '활성화' : '비활성화'}`);
  }

  /**
   * 교전 모드 설정 (BASELINE or FUSION)
   */
  setEngagementMode(mode: EngagementMode): void {
    this.engagementManager.setMode(mode);
    console.log(`[SimulationEngine] 교전 모드 변경: ${mode}`);
  }

  /**
   * 교전 모드 반환
   */
  getEngagementMode(): EngagementMode {
    return this.engagementManager.getMode();
  }

  /**
   * 자동 교전 처리
   */
  private processAutoEngagement(): void {
    const basePos = { x: this.world.basePosition.x, y: this.world.basePosition.y };
    const mode = this.engagementManager.getMode();

    if (mode === 'FUSION' && this.fusionEnabled) {
      // Fusion 모드: 트랙 기반 교전
      const tracks = this.sensorFusion.getAllTracks();
      const decisions = this.engagementManager.evaluateEngagementCandidates(
        tracks,
        this.world.time,
        basePos
      );

      for (const decision of decisions) {
        if (decision.action === 'ENGAGE') {
          this.executeEngageDecision(decision);
        }
      }
    } else {
      // Baseline 모드: 드론 직접 기반 교전
      this.processBaselineAutoEngagement();
    }
  }

  /**
   * Baseline 모드 자동 교전 (레이더 거리 기반)
   */
  private processBaselineAutoEngagement(): void {
    const config = this.engagementManager.getConfig();
    const basePos = this.world.basePosition;

    for (const [droneId, drone] of this.world.hostileDrones) {
      if (drone.isNeutralized) continue;

      // 거리 계산
      const dx = drone.position.x - basePos.x;
      const dy = drone.position.y - basePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // 거리 기반 교전 조건
      if (distance <= config.BASELINE_ENGAGE_DISTANCE) {
        // 이미 교전 중인지 확인
        const track = this.sensorFusion.getTrackByDroneId(droneId);
        const trackId = track?.id || `baseline_${droneId}`;
        const info = this.engagementManager.getEngagementInfo(trackId);
        
        if (info && (info.state === 'ENGAGING' || info.state === 'COMPLETED')) {
          continue;
        }

        // 랜덤 확률 적용
        if (Math.random() < config.BASELINE_ENGAGE_PROBABILITY) {
          // 사용 가능한 인터셉터 찾기
          const availableInterceptor = this.findAvailableInterceptor();
          if (!availableInterceptor) continue;

          // 간단한 교전 결정 생성
          const decision: EngagementDecision = {
            trackId,
            action: 'ENGAGE',
            reason: `거리 ${distance.toFixed(0)}m ≤ ${config.BASELINE_ENGAGE_DISTANCE}m (Baseline)`,
            priorityScore: 1000 - distance,
            threatScore: 0,
            existenceProb: 1,
            distance,
            classification: 'UNKNOWN',
            classConfidence: 0,
            sensors: { radar: true, audio: false, eo: false },
          };

          // 교전 개시
          const engageInfo = this.engagementManager.startEngagement(
            trackId,
            availableInterceptor.id,
            decision,
            this.world.time
          );

          // 인터셉터 발진
          const launched = launchInterceptor(
            availableInterceptor as ExtendedInterceptorDrone,
            droneId,
            this.world.time,
            'RAM',
            this.defaultGuidanceMode
          );
          this.world.interceptors.set(launched.id, launched);

          // 로깅
          this.logger.log({
            timestamp: this.world.time,
            event: 'engage_start',
            track_id: trackId,
            drone_id: droneId,
            mode: 'BASELINE',
            threat_score: 0,
            existence_prob: 1,
            distance_to_base: distance,
            classification: 'UNKNOWN',
            class_confidence: 0,
            engage_reason: decision.reason,
            interceptor_id: availableInterceptor.id,
          } as any);

          this.logger.log({
            timestamp: this.world.time,
            event: 'engage_command',
            drone_id: droneId,
            method: 'RAM' as LogEvents.InterceptMethod,
            guidance_mode: this.defaultGuidanceMode,
            interceptor_id: availableInterceptor.id,
            issued_by: 'auto',
            engage_mode: 'BASELINE',
          } as any);

          // 인터셉터 생성 이벤트
          this.onEvent({
            type: 'interceptor_spawned',
            timestamp: this.world.time,
            interceptor_id: launched.id,
            position: launched.position,
            target_id: droneId,
          } as any);

          this.logger.log({
            timestamp: this.world.time,
            event: 'interceptor_spawned',
            interceptor_id: launched.id,
            position: launched.position,
            target_id: droneId,
          });
        }
      }
    }
  }

  /**
   * 교전 결정 실행
   */
  private executeEngageDecision(decision: EngagementDecision): void {
    const track = this.sensorFusion.getTrack(decision.trackId);
    if (!track) return;

    // 드론 ID 가져오기
    const droneId = track.droneId;
    if (!droneId) return;

    // 드론 존재 확인
    const drone = this.world.hostileDrones.get(droneId);
    if (!drone || drone.isNeutralized) return;

    // 사용 가능한 인터셉터 찾기
    const availableInterceptor = this.findAvailableInterceptor();
    if (!availableInterceptor) return;

    // 교전 개시
    const info = this.engagementManager.startEngagement(
      decision.trackId,
      availableInterceptor.id,
      decision,
      this.world.time
    );

    // 인터셉터 발진
    const launched = launchInterceptor(
      availableInterceptor as ExtendedInterceptorDrone,
      droneId,
      this.world.time,
      'RAM',
      this.defaultGuidanceMode
    );
    this.world.interceptors.set(launched.id, launched);

    // 교전 개시 로그 이벤트
    const startLog = this.engagementManager.createEngageStartLog(
      info,
      decision,
      droneId,
      this.world.time
    );

    // 로깅
    this.logger.log(startLog as any);

    // 기존 engage_command 로그도 유지 (호환성)
    this.logger.log({
      timestamp: this.world.time,
      event: 'engage_command',
      drone_id: droneId,
      method: 'RAM' as LogEvents.InterceptMethod,
      guidance_mode: this.defaultGuidanceMode,
      interceptor_id: availableInterceptor.id,
      issued_by: 'auto',
      threat_score: decision.threatScore,
      existence_prob: decision.existenceProb,
      engage_mode: this.engagementManager.getMode(),
    } as any);

    // 인터셉터 생성 이벤트
    this.onEvent({
      type: 'interceptor_spawned',
      timestamp: this.world.time,
      interceptor_id: launched.id,
      position: launched.position,
      target_id: droneId,
    } as any);

    this.logger.log({
      timestamp: this.world.time,
      event: 'interceptor_spawned',
      interceptor_id: launched.id,
      position: launched.position,
      target_id: droneId,
    });
  }

  /**
   * 사용 가능한 인터셉터 찾기
   */
  private findAvailableInterceptor(): InterceptorDrone | null {
    for (const [, interceptor] of this.world.interceptors) {
      if (interceptor.state === 'IDLE' || interceptor.state === 'STANDBY') {
        return interceptor;
      }
    }
    return null;
  }

  /**
   * 교전 중단 조건 확인
   */
  private checkEngagementAbortConditions(): void {
    const basePos = { x: this.world.basePosition.x, y: this.world.basePosition.y };

    for (const info of this.engagementManager.getAllEngagementInfos()) {
      if (info.state !== 'ENGAGING') continue;

      const track = this.sensorFusion.getTrack(info.trackId);
      const abortReason = this.engagementManager.checkAbortConditions(
        info.trackId,
        track || null,
        basePos
      );

      if (abortReason) {
        this.abortEngagement(info.trackId, abortReason, track?.droneId || null);
      }
    }
  }

  /**
   * 교전 중단 처리
   */
  private abortEngagement(trackId: string, reason: AbortReason, droneId: string | null): void {
    const info = this.engagementManager.abortEngagement(trackId, reason, this.world.time);
    if (!info) return;

    // 인터셉터 리셋 (있는 경우)
    if (info.assignedInterceptorId) {
      const interceptor = this.world.interceptors.get(info.assignedInterceptorId);
      if (interceptor) {
        const reset = resetInterceptor(
          interceptor as ExtendedInterceptorDrone,
          this.world.basePosition
        );
        this.world.interceptors.set(interceptor.id, reset);
      }
    }

    // 교전 종료 로그
    const endLog = this.engagementManager.createEngageEndLog(info, droneId, this.world.time);
    this.logger.log(endLog as any);

    console.log(`[EngagementManager] 교전 중단: ${trackId}, 사유: ${reason}`);
  }

  /**
   * 교전 완료 처리 (요격 성공/실패 시 호출)
   */
  completeEngagementForDrone(droneId: string, success: boolean): void {
    // 드론 ID로 트랙 찾기
    const track = this.sensorFusion.getTrackByDroneId(droneId);
    if (!track) return;

    const info = this.engagementManager.completeEngagement(track.id, success, this.world.time);
    if (!info) return;

    // 교전 종료 로그
    const endLog = this.engagementManager.createEngageEndLog(info, droneId, this.world.time);
    this.logger.log(endLog as any);
  }

  /**
   * 교전 관리자 반환
   */
  getEngagementManager(): EngagementManager {
    return this.engagementManager;
  }

  /**
   * 리셋 시 교전 관리자도 리셋
   */
  resetEngagement(): void {
    this.engagementManager.reset();
  }
}
