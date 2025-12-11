/**
 * 공통 이벤트 JSON Schema 정의
 * 
 * C2 UI ↔ 시뮬레이터 ↔ 음향모델 간 통신 프로토콜
 */

// ============================================
// 기본 타입
// ============================================

/** 드론 활동 상태 (음향 기반) */
export type DroneActivityState = 
  | 'NOISE'      // 배경 소음
  | 'IDLE'       // 대기
  | 'TAKEOFF'    // 이륙
  | 'HOVER'      // 호버링
  | 'APPROACH'   // 접근
  | 'DEPART'     // 이탈
  | 'LOITER';    // 배회

/** 적 드론 행동 모드 */
export type HostileDroneBehavior = 
  | 'NORMAL'     // 직선 비행
  | 'RECON'      // 정찰 선회
  | 'ATTACK_RUN' // 저고도 급접근
  | 'EVADE';     // 회피 기동

/** 요격 드론 상태 (확장) */
export type InterceptorState = 
  | 'IDLE'          // 대기
  | 'STANDBY'       // 대기 (호환성)
  | 'SCRAMBLE'      // 출격
  | 'LAUNCHING'     // 발진 중
  | 'PURSUING'      // 추격 중
  | 'RECON'         // 정찰 모드
  | 'ENGAGING'      // 교전 중 (호환성)
  | 'INTERCEPT_RAM' // 충돌 요격 중
  | 'INTERCEPT_GUN' // 사격 요격 중
  | 'INTERCEPT_NET' // 그물 요격 중
  | 'INTERCEPT_JAM' // 재밍 요격 중
  | 'RETURNING'     // 귀환 중
  | 'NEUTRALIZED';  // 무력화

/** 요격 방식 */
export type InterceptMethod = 
  | 'RAM'   // 충돌 요격
  | 'GUN'   // 사격 요격
  | 'NET'   // 그물 요격
  | 'JAM';  // 전자전 재밍

/** 유도 모드 */
export type GuidanceMode =
  | 'PURE_PURSUIT'  // 기존 직선 추격
  | 'PN'            // Proportional Navigation (비례 항법)
  | 'APN'           // Augmented PN (타겟 가속도 보정)
  | 'OPTIMAL';      // 최적 유도 (비교용)

/** 센서 유형 */
export type SensorType = 'RADAR' | 'AUDIO' | 'EO';

/** 분류 결과 */
export type Classification = 'HOSTILE' | 'FRIENDLY' | 'CIVIL' | 'UNKNOWN';

/** 위협 레벨 */
export type ThreatLevel = 'INFO' | 'CAUTION' | 'DANGER' | 'CRITICAL';

/** 교전 방법 (레거시 호환성) */
export type EngagementMethod = 
  | 'interceptor_drone'  // 요격 드론
  | 'jamming'            // 전파 교란
  | 'net_gun'            // 그물총
  | 'kinetic'            // 물리적 충돌
  | InterceptMethod;     // 새 요격 방식

/** 요격 결과 */
export type InterceptResult = 
  | 'SUCCESS'    // 요격 성공
  | 'MISS'       // 실패
  | 'EVADED'     // 회피됨
  | 'ABORTED';   // 중단됨

// ============================================
// 시뮬레이터 → C2 이벤트
// ============================================

/** 음향 탐지 이벤트 */
export interface AudioDetectionEvent {
  type: 'audio_detection';
  timestamp: number;
  drone_id: string;
  state: DroneActivityState;
  confidence: number;      // 0~1
  estimated_distance?: number;  // 추정 거리 (m)
  estimated_bearing?: number;   // 추정 방위 (도)
}

/** 레이더 탐지 이벤트 */
export interface RadarDetectionEvent {
  type: 'radar_detection';
  timestamp: number;
  drone_id: string;
  range: number;           // 거리 (m)
  bearing: number;         // 방위각 (도)
  altitude: number;        // 고도 (m)
  radial_velocity?: number; // 접근 속도 (m/s)
  confidence: number;      // 0~1
  is_false_alarm?: boolean; // 오탐 여부
}

/** 드론 상태 업데이트 이벤트 */
export interface DroneStateUpdateEvent {
  type: 'drone_state_update';
  timestamp: number;
  drone_id: string;
  position: { x: number; y: number; altitude: number };
  velocity: { vx: number; vy: number; climbRate: number };
  behavior: HostileDroneBehavior;
  is_evading: boolean;
}

/** 요격 드론 상태 업데이트 */
export interface InterceptorUpdateEvent {
  type: 'interceptor_update';
  timestamp: number;
  interceptor_id: string;
  target_id: string | null;
  state: InterceptorState;
  position: { x: number; y: number; altitude: number };
  distance_to_target?: number;
  method?: InterceptMethod;      // 요격 방식
  guidance_mode?: GuidanceMode;  // 유도 모드 (PN, PURE_PURSUIT)
  eo_confirmed?: boolean;        // EO 정찰 완료 여부
  // PN 유도 디버그 정보
  pn_debug?: {
    closing_speed?: number;      // 접근 속도
    lambda_dot?: number;         // LOS 각속도
    commanded_accel?: number;    // 명령 가속도
  };
}

/** 요격 결과 이벤트 */
export interface InterceptResultEvent {
  type: 'intercept_result';
  timestamp: number;
  interceptor_id: string;
  target_id: string;
  result: InterceptResult;
  details?: string;
}

/** 시뮬레이션 상태 이벤트 */
export interface SimulationStatusEvent {
  type: 'simulation_status';
  timestamp: number;
  sim_time: number;
  is_running: boolean;
  drone_count: number;
  interceptor_count: number;
}

// ============================================
// 센서 융합 관련 이벤트
// ============================================

/** 센서 상태 */
export interface TrackSensorStatus {
  radar: boolean;
  audio: boolean;
  eo: boolean;
}

/** 분류 정보 */
export interface TrackClassificationInfo {
  classification: Classification;
  confidence: number;
  armed: boolean | null;
  sizeClass: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  droneType: string | null;
}

/** 융합 트랙 업데이트 이벤트 */
export interface FusedTrackUpdateEvent {
  type: 'fused_track_update';
  timestamp: number;
  track_id: string;
  drone_id: string | null;
  existence_prob: number;
  position: { x: number; y: number; altitude: number };
  velocity: { vx: number; vy: number; climbRate: number };
  classification: Classification;
  class_info: TrackClassificationInfo;
  threat_score: number;
  threat_level: ThreatLevel;
  sensors: TrackSensorStatus;
  quality: number;
  is_evading: boolean;
  is_neutralized: boolean;
}

/** 트랙 생성 이벤트 */
export interface TrackCreatedEvent {
  type: 'track_created';
  timestamp: number;
  track_id: string;
  initial_sensor: SensorType;
  position: { x: number; y: number; altitude: number };
  confidence: number;
}

/** 트랙 소멸 이벤트 */
export interface TrackDroppedEvent {
  type: 'track_dropped';
  timestamp: number;
  track_id: string;
  reason: 'timeout' | 'neutralized' | 'low_existence';
  lifetime: number;
}

// ============================================
// C2 → 시뮬레이터 명령
// ============================================

/** 교전 명령 */
export interface EngageCommand {
  type: 'engage_command';
  drone_id: string;
  method: EngagementMethod | InterceptMethod;
  interceptor_id?: string;  // 특정 요격기 지정
}

/** 교전 상태 변경 명령 */
export interface EngagementStateCommand {
  type: 'engagement_state_command';
  drone_id: string;
  state: 'IGNORE' | 'TRACK' | 'ENGAGE_PREP' | 'ENGAGE';
}

/** 시뮬레이션 제어 명령 */
export interface SimulationControlCommand {
  type: 'simulation_control';
  action: 'start' | 'pause' | 'reset' | 'set_speed';
  speed_multiplier?: number;
  scenario_id?: number | string;  // 기본 시나리오는 number, 생성 시나리오는 string
}

/** 요격 드론 발진 명령 */
export interface LaunchInterceptorCommand {
  type: 'launch_interceptor';
  interceptor_id: string;
  target_id: string;
}

// ============================================
// 통합 이벤트 타입
// ============================================

/** 시뮬레이터 → C2 모든 이벤트 */
export type SimulatorToC2Event = 
  | AudioDetectionEvent
  | RadarDetectionEvent
  | DroneStateUpdateEvent
  | InterceptorUpdateEvent
  | InterceptResultEvent
  | SimulationStatusEvent
  | FusedTrackUpdateEvent
  | TrackCreatedEvent
  | TrackDroppedEvent;

/** C2 → 시뮬레이터 모든 명령 */
export type C2ToSimulatorCommand = 
  | EngageCommand
  | EngagementStateCommand
  | SimulationControlCommand
  | LaunchInterceptorCommand;

// ============================================
// 센서 설정
// ============================================

/** 레이더 설정 */
export interface RadarConfig {
  scan_rate: number;          // 초당 회전수 (기본: 1)
  max_range: number;          // 최대 탐지 거리 (기본: 1000m)
  radial_noise_sigma: number; // 거리 노이즈 표준편차 (기본: 10m)
  azimuth_noise_sigma: number; // 방위각 노이즈 표준편차 (기본: 2도)
  false_alarm_rate: number;   // 오탐율 (기본: 0.015)
  miss_probability: number;   // 미탐율 (기본: 0.07)
}

/** 음향 센서 설정 */
export interface AudioSensorConfig {
  sample_rate: number;        // 샘플링 레이트
  detection_range: number;    // 탐지 범위 (m)
  confidence_threshold: number; // 최소 신뢰도
}

// ============================================
// 행동 모델 설정
// ============================================

/** 요격 드론 설정 */
export interface InterceptorConfig {
  max_speed: number;          // 최대 속도 (m/s)
  acceleration: number;       // 가속도 (m/s²)
  turn_rate: number;          // 선회율 (도/s)
  climb_rate: number;         // 상승률 (m/s)
  engagement_range: number;   // 교전 거리 (m)
  base_success_rate: number;  // 기본 요격 성공률
}

/** 적 드론 설정 */
export interface HostileDroneConfig {
  max_speed: number;          // 최대 속도 (m/s)
  cruise_speed: number;       // 순항 속도 (m/s)
  acceleration: number;       // 가속도 (m/s²)
  turn_rate: number;          // 선회율 (도/s)
  evasion_trigger_distance: number; // 회피 시작 거리 (m)
  evasion_maneuver_strength: number; // 회피 기동 강도
}

// ============================================
// 기본 설정값
// ============================================

export const DEFAULT_RADAR_CONFIG: RadarConfig = {
  scan_rate: 1,
  max_range: 1000,
  radial_noise_sigma: 10,
  azimuth_noise_sigma: 2,
  false_alarm_rate: 0.015,
  miss_probability: 0.07,
};

export const DEFAULT_INTERCEPTOR_CONFIG: InterceptorConfig = {
  max_speed: 35,
  acceleration: 8,
  turn_rate: 90,
  climb_rate: 10,
  engagement_range: 15,
  base_success_rate: 0.75,
};

export const DEFAULT_HOSTILE_DRONE_CONFIG: HostileDroneConfig = {
  max_speed: 25,
  cruise_speed: 15,
  acceleration: 5,
  turn_rate: 60,
  evasion_trigger_distance: 100,
  evasion_maneuver_strength: 0.8,
};

