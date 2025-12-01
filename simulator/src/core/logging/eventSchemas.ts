/**
 * 실험 로깅용 이벤트 스키마 정의
 * 
 * 모든 이벤트는 이 스키마를 따라야 합니다.
 * JSONL 형식으로 1줄 1이벤트 저장됩니다.
 */

// ============================================
// 기본 이벤트 인터페이스
// ============================================

export interface BaseEvent {
  timestamp: number;  // 시뮬레이션 시간 (초)
  event: string;      // 이벤트 타입
}

// ============================================
// 공통 타입 정의
// ============================================

/** 드론 타입 */
export type DroneType = 
  | 'RECON_UAV'       // 정찰 드론
  | 'ATTACK_UAV'      // 공격 드론
  | 'LOITER_MUNITION' // 배회형 탄약
  | 'CARGO_UAV'       // 화물 드론
  | 'CIVILIAN'        // 민간 드론
  | 'UNKNOWN';        // 미상

/** 드론 크기 분류 */
export type DroneSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** 드론 활동 상태 (음향 탐지용) */
export type DroneActivityState = 
  | 'IDLE'      // 대기
  | 'TAKEOFF'   // 이륙
  | 'APPROACH'  // 접근
  | 'DEPART'    // 이탈
  | 'LOITER'    // 배회/선회
  | 'HOVER';    // 호버링

/** 요격 방식 */
export type InterceptMethod = 
  | 'RAM'   // 충돌 요격
  | 'GUN'   // 사격 요격
  | 'NET'   // 그물 요격
  | 'JAM';  // 전자전 재밍

/** 요격 드론 상태 */
export type InterceptorState = 
  | 'IDLE'          // 대기
  | 'SCRAMBLE'      // 출격
  | 'PURSUING'      // 추격
  | 'RECON'         // 정찰 모드
  | 'INTERCEPT_RAM' // 충돌 요격 중
  | 'INTERCEPT_GUN' // 사격 요격 중
  | 'INTERCEPT_NET' // 그물 요격 중
  | 'INTERCEPT_JAM' // 재밍 요격 중
  | 'RETURNING'     // 귀환 중
  | 'NEUTRALIZED';  // 무력화

/** 식별 분류 */
export type Classification = 'HOSTILE' | 'FRIENDLY' | 'NEUTRAL' | 'UNKNOWN';

/** 센서 타입 */
export type SensorType = 'RADAR' | 'AUDIO' | 'EO';

// ============================================
// 시나리오 이벤트
// ============================================

export interface ScenarioStartEvent extends BaseEvent {
  event: 'scenario_start';
  scenario_id: number | string;
  scenario_name: string;
  seed?: number;
  config: {
    drone_count: number;
    interceptor_count: number;
    radar_config: {
      scan_rate: number;
      max_range: number;
      radial_noise_sigma: number;
      azimuth_noise_sigma: number;
      false_alarm_rate: number;
      miss_probability: number;
    };
    behavior_distribution?: Record<string, number>;
    audio_model_enabled?: boolean;  // 음향 모델 활성화 여부
    hostile_ratio?: number;         // 적대적 드론 비율
  };
}

export interface ScenarioEndEvent extends BaseEvent {
  event: 'scenario_end';
  scenario_id: number | string;
  duration: number;
  summary: {
    total_drones: number;
    drones_neutralized: number;
    drones_escaped: number;
    intercept_attempts: number;
    intercept_successes: number;
    intercept_failures: number;
    false_alarms: number;
  };
}

// ============================================
// 드론 이벤트
// ============================================

export interface DroneSpawnedEvent extends BaseEvent {
  event: 'drone_spawned';
  drone_id: string;
  position: { x: number; y: number; altitude: number };
  velocity: { vx: number; vy: number; climbRate: number };
  behavior: string;
  is_hostile: boolean;
  // 확장 속성
  drone_type?: DroneType;
  armed?: boolean;
  size_class?: DroneSize;
  recommended_method?: InterceptMethod;  // 권장 요격 방식
}

export interface TrackUpdateEvent extends BaseEvent {
  event: 'track_update';
  drone_id: string;
  position: { x: number; y: number; altitude: number };
  velocity: { vx: number; vy: number; climbRate: number };
  behavior: string;
  is_evading: boolean;
  distance_to_base: number;
}

// ============================================
// 탐지 이벤트
// ============================================

export interface AudioDetectionEvent extends BaseEvent {
  event: 'audio_detection';
  drone_id: string | null;  // 실제 드론 추정 안 되면 null
  state: DroneActivityState;
  confidence: number;       // 0~1
  estimated_distance?: number;
  estimated_bearing?: number;
  is_first_detection: boolean;
  sensor: 'AUDIO';
  is_false_alarm?: boolean;
}

/** 오탐 유형 */
export type FalseAlarmType = 
  | 'no_object'          // 드론 없음 + 탐지 이벤트 발생
  | 'misclassification'  // 아군/중립 드론을 적으로 분류
  | 'tracking_error';    // 위치/거리 오차가 threshold 초과

export interface RadarDetectionEvent extends BaseEvent {
  event: 'radar_detection';
  drone_id: string;
  range: number;
  bearing: number;
  altitude: number;
  radial_velocity?: number;
  confidence: number;
  is_false_alarm: boolean;
  false_alarm_type?: FalseAlarmType;  // 오탐 유형
  tracking_error?: number;            // 실제 위치와의 오차 (m)
  is_first_detection: boolean;
}

// ============================================
// EO 정찰 이벤트
// ============================================

/** EO 카메라 정찰 확인 이벤트 */
export interface EOConfirmationEvent extends BaseEvent {
  event: 'eo_confirmation';
  drone_id: string;
  interceptor_id: string;
  classification: Classification;
  armed: boolean | null;
  size_class: DroneSize | null;
  drone_type?: DroneType;
  confidence: number;      // 0~1
  sensor: 'EO';
  recon_duration?: number; // 정찰 소요 시간
}

/** 정찰 명령 이벤트 */
export interface ReconCommandEvent extends BaseEvent {
  event: 'recon_command';
  target_drone_id: string;
  interceptor_id: string;
  issued_by: 'user' | 'auto';
}

// ============================================
// 위협 평가 이벤트
// ============================================

export interface ThreatScoreUpdateEvent extends BaseEvent {
  event: 'threat_score_update';
  drone_id: string;
  threat_level: string;
  total_score: number;
  factors: {
    distance_score: number;
    velocity_score: number;
    behavior_score: number;
    payload_score: number;
    size_score: number;
    audio_detection_score?: number;  // 음향 탐지 가중치
    eo_confirmed_score?: number;     // EO 확인 가중치
    armed_score?: number;            // 무장 여부 가중치
  };
  previous_level?: string;
  eo_confirmed?: boolean;            // EO 정찰 확인 여부
}

// ============================================
// 교전 이벤트
// ============================================

export interface EngageCommandEvent extends BaseEvent {
  event: 'engage_command';
  drone_id: string;
  method: InterceptMethod;  // 요격 방식
  interceptor_id?: string;
  issued_by: 'user' | 'auto';
}

export interface InterceptorSpawnedEvent extends BaseEvent {
  event: 'interceptor_spawned';
  interceptor_id: string;
  position: { x: number; y: number; altitude: number };
  target_id: string;
}

export interface InterceptAttemptEvent extends BaseEvent {
  event: 'intercept_attempt';
  interceptor_id: string;
  target_id: string;
  method: InterceptMethod;    // 요격 방식
  distance_at_attempt: number;
  relative_speed: number;
  target_evading: boolean;
  success_probability: number;
}

/** 요격 실패 원인 */
export type InterceptFailureReason = 
  | 'evaded'            // 타겟이 회피 성공
  | 'distance_exceeded' // 최대 추적 거리 초과
  | 'timeout'           // 교전 시간 초과
  | 'low_speed'         // 요격기 속도 부족
  | 'sensor_error'      // 센서 오류로 타겟 손실
  | 'fuel_depleted'     // 연료/배터리 소진
  | 'target_lost'       // 타겟 추적 실패
  | 'jam_failed'        // 재밍 실패
  | 'gun_missed'        // 사격 빗나감
  | 'net_missed'        // 그물 빗나감
  | 'collision_avoided'; // 충돌 회피됨

/** 적 드론 무력화 상태 */
export type NeutralizationStatus = 
  | 'DESTROYED'     // 파괴됨
  | 'CAPTURED'      // 포획됨 (그물)
  | 'JAMMED'        // 재밍 무력화
  | 'DISABLED'      // 비활성화
  | 'ESCAPED';      // 이탈

export interface InterceptResultEvent extends BaseEvent {
  event: 'intercept_result';
  interceptor_id: string;
  target_id: string;
  method: InterceptMethod;            // 요격 방식
  result: 'success' | 'miss' | 'evaded' | 'aborted';
  reason?: InterceptFailureReason;    // 실패 원인 (실패 시)
  engagement_duration: number;
  final_distance?: number;            // 최종 거리
  target_was_evading?: boolean;       // 타겟 회피 여부
  relative_speed_at_intercept?: number; // 요격 시점 상대속도
  neutralization_status?: NeutralizationStatus; // 무력화 상태
}

// ============================================
// 회피 이벤트
// ============================================

export interface EvadeStartEvent extends BaseEvent {
  event: 'evade_start';
  drone_id: string;
  trigger: 'interceptor_approach' | 'manual' | 'auto';
  interceptor_distance?: number;
}

export interface EvadeEndEvent extends BaseEvent {
  event: 'evade_end';
  drone_id: string;
  duration: number;
  result: 'escaped' | 'caught' | 'timeout';
}

// ============================================
// UI/사용자 조작 이벤트
// ============================================

export interface ManualActionEvent extends BaseEvent {
  event: 'manual_action';
  action: string;
  target_id?: string;
  details?: Record<string, unknown>;
}

export interface SelectedDroneEvent extends BaseEvent {
  event: 'selected_drone';
  drone_id: string | null;
  previous_id?: string | null;
}

export interface ClickedEngageEvent extends BaseEvent {
  event: 'clicked_engage';
  drone_id: string;
  engagement_state: string;
}

export interface ClickedIgnoreEvent extends BaseEvent {
  event: 'clicked_ignore';
  drone_id: string;
}

export interface SimulationControlEvent extends BaseEvent {
  event: 'simulation_control';
  action: 'start' | 'pause' | 'reset' | 'speed_change';
  speed_multiplier?: number;
  scenario_id?: number | string;
}

// ============================================
// 통합 이벤트 타입
// ============================================

export type LogEvent =
  | ScenarioStartEvent
  | ScenarioEndEvent
  | DroneSpawnedEvent
  | TrackUpdateEvent
  | AudioDetectionEvent
  | RadarDetectionEvent
  | EOConfirmationEvent
  | ReconCommandEvent
  | ThreatScoreUpdateEvent
  | EngageCommandEvent
  | InterceptorSpawnedEvent
  | InterceptAttemptEvent
  | InterceptResultEvent
  | EvadeStartEvent
  | EvadeEndEvent
  | ManualActionEvent
  | SelectedDroneEvent
  | ClickedEngageEvent
  | ClickedIgnoreEvent
  | SimulationControlEvent;

// ============================================
// 이벤트 생성 헬퍼 함수
// ============================================

export function createEvent<T extends LogEvent>(
  event: Omit<T, 'timestamp'>,
  timestamp: number
): T {
  return { ...event, timestamp } as T;
}

// 이벤트 타입 목록
export const EVENT_TYPES = [
  'scenario_start',
  'scenario_end',
  'drone_spawned',
  'track_update',
  'audio_detection',
  'radar_detection',
  'eo_confirmation',
  'recon_command',
  'threat_score_update',
  'engage_command',
  'interceptor_spawned',
  'intercept_attempt',
  'intercept_result',
  'evade_start',
  'evade_end',
  'manual_action',
  'selected_drone',
  'clicked_engage',
  'clicked_ignore',
  'simulation_control',
] as const;

// 요격 방식별 설정
export const INTERCEPT_METHOD_CONFIG = {
  RAM: {
    name: '충돌 요격',
    min_distance: 0,        // 최소 거리 (m)
    max_distance: 30,       // 최대 요격 거리 (m)
    base_success_rate: 0.7, // 기본 성공률
    speed_factor: 0.3,      // 속도 영향
    evade_penalty: 0.4,     // 회피 시 성공률 감소
  },
  GUN: {
    name: '사격 요격',
    min_distance: 100,
    max_distance: 400,
    base_success_rate: 0.5,
    speed_factor: 0.2,
    evade_penalty: 0.3,
  },
  NET: {
    name: '그물 요격',
    min_distance: 0,
    max_distance: 80,
    base_success_rate: 0.8,
    speed_factor: 0.4,
    evade_penalty: 0.5,
  },
  JAM: {
    name: '전자전 재밍',
    min_distance: 50,
    max_distance: 300,
    base_success_rate: 0.6,
    speed_factor: 0.1,
    evade_penalty: 0.1,
    jam_duration_required: 5, // 재밍 필요 시간 (초)
  },
} as const;

