/**
 * 소부대 대드론 C2 시뮬레이터 - 타입 정의
 * 
 * 이 파일은 시뮬레이터에서 사용하는 모든 데이터 모델을 정의합니다.
 */

// ============================================
// 기본 열거형 타입
// ============================================

/** 드론 식별 상태 */
export type DroneState = "UNKNOWN" | "FRIENDLY" | "HOSTILE" | "CIVILIAN";

/** 교전 상태 */
export type EngagementState = "IGNORE" | "TRACK" | "ENGAGE_PREP" | "ENGAGE";

/** 위협 레벨 */
export type ThreatLevel = "INFO" | "CAUTION" | "DANGER" | "CRITICAL";

/** 탑재체 유형 (무장 가능성 판단용) */
export type PayloadType = "UNKNOWN" | "NONE" | "CAMERA" | "BOMB" | "ROCKET" | "CHEMICAL";

/** 센서 소스 */
export type SensorSource = "EO" | "IR" | "AUDIO" | "RADAR" | "MULTI";

/** 행동 패턴 */
export type BehaviorPattern = 
  | "LINEAR" | "CIRCLING" | "HOVERING" | "APPROACHING" | "RETREATING" | "ERRATIC"
  | "NORMAL" | "RECON" | "ATTACK_RUN" | "EVADE";

// ============================================
// 위치 및 속도 인터페이스
// ============================================

/** 
 * 2D/3D 위치 정보
 * - x, y: 지도 상의 좌표 (미터 단위, 아군 기지 = 0,0)
 * - altitude: 고도 (미터)
 */
export interface Position {
  x: number;
  y: number;
  altitude: number;
}

/**
 * 속도 정보
 * - vx, vy: 수평 속도 (m/s)
 * - climbRate: 상승/하강 속도 (m/s, 양수=상승)
 */
export interface Velocity {
  vx: number;
  vy: number;
  climbRate: number;
}

// ============================================
// 위협 평가 관련 인터페이스
// ============================================

/**
 * 위협도 점수
 */
export interface ThreatScore {
  /** 위협 레벨 */
  level: ThreatLevel;
  
  /** 종합 위협 점수 (0~100) */
  totalScore: number;
  
  /** 거리 점수 (0~1): 가까울수록 높음 */
  distanceScore: number;
  
  /** 속도/접근 점수 (0~1): 아군 방향 접근 속도가 빠를수록 높음 */
  velocityScore: number;
  
  /** 행동 패턴 점수 (0~1): 위협적인 행동일수록 높음 */
  behaviorScore: number;
  
  /** 탑재체 점수 (0~1): 무장 가능성이 높을수록 높음 */
  payloadScore: number;
  
  /** 크기 점수 (0~1) */
  sizeScore: number;
}

/**
 * 위협 평가 가중치 설정
 */
export interface ThreatWeights {
  distance: number;   // 기본값: 0.3
  velocity: number;   // 기본값: 0.25
  altitude: number;   // 기본값: 0.15
  payload: number;    // 기본값: 0.15
  behavior: number;   // 기본값: 0.15
}

// ============================================
// 드론 트랙 인터페이스
// ============================================

/**
 * 드론 트랙 (표적) 데이터
 * 탐지된 드론의 모든 정보를 담는 핵심 인터페이스
 */
export interface DroneTrack {
  /** 고유 식별자 */
  id: string;
  
  /** 현재 위치 */
  position: Position;
  
  /** 현재 속도 */
  velocity: Velocity;
  
  /** 드론 식별 상태 (미상/우군/적/민간) */
  droneState: DroneState;
  
  /** 교전 상태 (무시/추적/요격준비/요격) */
  engagementState: EngagementState;
  
  /** 탐지 센서 소스 */
  sensorSource: SensorSource;
  
  /** 탐지 신뢰도 (0~1) */
  confidence: number;
  
  /** 위협 평가 결과 */
  threat: ThreatScore;
  
  /** 위치 히스토리 (최근 N개) */
  history: Position[];
  
  /** 최초 탐지 시간 (시뮬레이션 시간, 초) */
  createdAt: number;
  
  /** 마지막 업데이트 시간 (시뮬레이션 시간, 초) */
  lastUpdatedAt: number;
  
  /** 현재 행동 패턴 (옵션) */
  behaviorPattern?: BehaviorPattern;
  
  /** 추정 탑재체 유형 (옵션) */
  payloadType?: PayloadType;
  
  // ===== 확장 속성 (v2) =====
  
  /** 드론 타입 */
  droneType?: DroneType;
  
  /** 무장 여부 */
  armed?: boolean;
  
  /** 크기 분류 */
  sizeClass?: DroneSize;
  
  /** 권장 요격 방식 */
  recommendedMethod?: InterceptMethod;
  
  /** EO 정찰 결과 */
  eoConfirmation?: EOConfirmation;
  
  /** 음향 탐지 여부 */
  audioDetected?: boolean;
  
  /** 음향 탐지 상태 */
  audioState?: DroneActivityState;
  
  /** 회피 중 여부 */
  isEvading?: boolean;
  
  // ===== 센서 융합 속성 (v3) =====
  
  /** 융합 트랙 ID */
  fusedTrackId?: string;
  
  /** 존재 확률 (0~1) */
  existenceProb?: number;
  
  /** 센서 탐지 상태 */
  sensorStatus?: TrackSensorStatus;
  
  /** 트랙 품질 (0~1) */
  trackQuality?: number;
  
  /** 분류 정보 (융합 결과) */
  fusedClassification?: FusedClassification;
}

// ============================================
// 시뮬레이션 관련 인터페이스
// ============================================

/**
 * 시뮬레이션 로그 항목
 */
export interface LogEntry {
  /** 시뮬레이션 시간 (초) */
  time: number;
  
  /** 로그 유형 */
  type: "DETECTION" | "THREAT" | "SYSTEM" | "ENGAGEMENT" | "AUDIO" | "RECON" | "INTERCEPT";
  
  /** 로그 메시지 */
  message: string;
  
  /** 관련 드론 ID (있는 경우) */
  droneId?: string;
  
  /** 요격 방식 (있는 경우) */
  method?: InterceptMethod;
  
  /** 요격기 ID (있는 경우) */
  interceptorId?: string;
  
  /** 세부 데이터 */
  data?: Record<string, unknown>;
}

/**
 * 시뮬레이션 상태
 */
export interface SimulationState {
  /** 현재 시뮬레이션 시간 (초) */
  currentTime: number;
  
  /** 시뮬레이션 실행 중 여부 */
  isRunning: boolean;
  
  /** 시뮬레이션 속도 배율 (1 = 실시간) */
  speedMultiplier: number;
  
  /** 틱 간격 (초) */
  tickInterval: number;
  
  /** 모든 드론 트랙 */
  drones: DroneTrack[];
  
  /** 이벤트 로그 */
  logs: LogEntry[];
  
  /** 선택된 드론 ID */
  selectedDroneId: string | null;
}

/**
 * 시뮬레이션 설정
 */
export interface SimulationConfig {
  /** 맵 크기 (미터) */
  mapSize: number;
  
  /** 안전 거리 (미터) */
  safeDistance: number;
  
  /** 위험 거리 (미터) */
  dangerDistance: number;
  
  /** 위협 평가 가중치 */
  threatWeights: ThreatWeights;
  
  /** 위치 히스토리 최대 개수 */
  maxHistoryLength: number;
}

// ============================================
// 기본 설정값
// ============================================

/** 기본 위협 평가 가중치 */
export const DEFAULT_THREAT_WEIGHTS: ThreatWeights = {
  distance: 0.3,
  velocity: 0.25,
  altitude: 0.15,
  payload: 0.15,
  behavior: 0.15,
};

/** 기본 시뮬레이션 설정 */
export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  mapSize: 1000,           // 1km x 1km 맵
  safeDistance: 500,       // 500m 이상 = 안전
  dangerDistance: 100,     // 100m 이하 = 위험
  threatWeights: DEFAULT_THREAT_WEIGHTS,
  maxHistoryLength: 50,    // 최근 50개 위치 저장
};

/** 탑재체 유형별 위협 점수 */
export const PAYLOAD_THREAT_SCORES: Record<PayloadType, number> = {
  UNKNOWN: 0.5,
  NONE: 0.1,
  CAMERA: 0.4,
  BOMB: 0.9,
  ROCKET: 1.0,
  CHEMICAL: 0.95,
};

// ============================================
// 시뮬레이터 통신 타입 (WebSocket)
// ============================================

/** 드론 활동 상태 (음향 기반) */
export type DroneActivityState = 
  | 'NOISE' | 'IDLE' | 'TAKEOFF' | 'HOVER' | 'APPROACH' | 'DEPART';

/** 요격 드론 상태 (확장) */
export type InterceptorState = 
  | 'IDLE' | 'STANDBY' | 'SCRAMBLE' | 'LAUNCHING' | 'PURSUING' 
  | 'RECON' | 'ENGAGING'
  | 'INTERCEPT_RAM' | 'INTERCEPT_GUN' | 'INTERCEPT_NET' | 'INTERCEPT_JAM'
  | 'RETURNING' | 'NEUTRALIZED';

/** 요격 결과 */
export type InterceptResult = 'SUCCESS' | 'MISS' | 'EVADED' | 'ABORTED';

/** 요격 방식 */
export type InterceptMethod = 'RAM' | 'GUN' | 'NET' | 'JAM';

/** 요격 방식별 정보 */
export const INTERCEPT_METHOD_INFO: Record<InterceptMethod, { 
  name: string; 
  icon: string; 
  color: string;
  description: string;
}> = {
  RAM: { name: '충돌', icon: '💥', color: '#ef4444', description: '직접 충돌 요격' },
  GUN: { name: '사격', icon: '🔫', color: '#f97316', description: '원거리 사격 요격' },
  NET: { name: '그물', icon: '🕸️', color: '#22c55e', description: '그물 포획 요격' },
  JAM: { name: '재밍', icon: '📡', color: '#3b82f6', description: '전자전 무력화' },
};

/** 유도 모드 */
export type GuidanceMode = 'PURE_PURSUIT' | 'PN';

/** 유도 모드별 정보 */
export const GUIDANCE_MODE_INFO: Record<GuidanceMode, {
  name: string;
  icon: string;
  description: string;
}> = {
  PURE_PURSUIT: { 
    name: '직선 추격', 
    icon: '➡️', 
    description: '목표를 향해 직선 이동 (기존 방식)' 
  },
  PN: { 
    name: '비례 항법 (PN)', 
    icon: '🎯', 
    description: 'Proportional Navigation - 회피 기동에 효과적' 
  },
};

/** 드론 타입 */
export type DroneType = 
  | 'RECON_UAV'       // 정찰 드론
  | 'ATTACK_UAV'      // 공격 드론
  | 'LOITER_MUNITION' // 배회형 탄약
  | 'CARGO_UAV'       // 화물 드론
  | 'CIVILIAN'        // 민간 드론
  | 'UNKNOWN';

/** 드론 크기 */
export type DroneSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** 식별 분류 */
export type Classification = 'HOSTILE' | 'FRIENDLY' | 'NEUTRAL' | 'UNKNOWN';

/** EO 정찰 결과 */
export interface EOConfirmation {
  confirmed: boolean;
  classification?: Classification;
  armed?: boolean;
  sizeClass?: DroneSize;
  droneType?: DroneType;
  confidence?: number;
  timestamp?: number;
}

/** 음향 탐지 이벤트 */
export interface AudioDetectionEvent {
  type: 'audio_detection';
  timestamp: number;
  drone_id: string;
  state: DroneActivityState;
  confidence: number;
  estimated_distance?: number;
  estimated_bearing?: number;
}

/** 레이더 탐지 이벤트 */
export interface RadarDetectionEvent {
  type: 'radar_detection';
  timestamp: number;
  drone_id: string;
  range: number;
  bearing: number;
  altitude: number;
  radial_velocity?: number;
  confidence: number;
  is_false_alarm?: boolean;
}

/** 드론 상태 업데이트 이벤트 */
export interface DroneStateUpdateEvent {
  type: 'drone_state_update';
  timestamp: number;
  drone_id: string;
  position: { x: number; y: number; altitude: number };
  velocity: { vx: number; vy: number; climbRate: number };
  behavior: string;
  is_evading: boolean;
}

/** 요격 드론 업데이트 이벤트 */
export interface InterceptorUpdateEvent {
  type: 'interceptor_update';
  timestamp: number;
  interceptor_id: string;
  target_id: string | null;
  state: InterceptorState;
  position: { x: number; y: number; altitude: number };
  distance_to_target?: number;
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

/** 시뮬레이터 → C2 이벤트 통합 */
export type SimulatorEvent = 
  | AudioDetectionEvent
  | RadarDetectionEvent
  | DroneStateUpdateEvent
  | InterceptorUpdateEvent
  | InterceptResultEvent
  | FusedTrackUpdateEvent
  | TrackCreatedEvent
  | TrackDroppedEvent
  | { type: 'simulation_status'; [key: string]: unknown }
  | { type: 'initial_state'; [key: string]: unknown };

/** 요격기 정보 (확장) */
export interface Interceptor {
  id: string;
  position: Position;
  state: InterceptorState;
  targetId: string | null;
  distanceToTarget?: number;
  /** 요격 방식 */
  method?: InterceptMethod;
  /** 유도 모드 */
  guidanceMode?: GuidanceMode;
  /** EO 정찰 완료 여부 */
  eoConfirmed?: boolean;
  /** 재밍 누적 시간 */
  jamDuration?: number;
  /** 사격 시도 횟수 */
  gunAttempts?: number;
  /** PN 디버그 정보 */
  pnDebug?: {
    closingSpeed?: number;
    lambdaDot?: number;
    commandedAccel?: number;
  };
}

/** EO 확인 이벤트 */
export interface EOConfirmationEvent {
  type: 'eo_confirmation';
  timestamp: number;
  drone_id: string;
  interceptor_id: string;
  classification: Classification;
  armed: boolean | null;
  size_class: DroneSize | null;
  drone_type?: DroneType;
  confidence: number;
}

/** 정찰 명령 이벤트 */
export interface ReconCommandEvent {
  type: 'recon_command';
  target_drone_id: string;
  interceptor_id: string;
}

/** 교전 명령 이벤트 (확장) */
export interface EngageCommandEvent {
  type: 'engage_command';
  drone_id: string;
  method: InterceptMethod;
  guidance_mode?: GuidanceMode;
  interceptor_id?: string;
}

// ============================================
// 센서 융합 관련 타입
// ============================================

/** 센서 유형 */
export type SensorType = 'RADAR' | 'AUDIO' | 'EO';

/** 분류 결과 (융합) */
export type FusedClassification = 'HOSTILE' | 'FRIENDLY' | 'CIVIL' | 'UNKNOWN';

/** 센서 상태 */
export interface TrackSensorStatus {
  radar: boolean;
  audio: boolean;
  eo: boolean;
}

/** 분류 정보 */
export interface TrackClassificationInfo {
  classification: FusedClassification;
  confidence: number;
  armed: boolean | null;
  sizeClass: DroneSize | null;
  droneType: string | null;
}

/** 융합 트랙 */
export interface FusedTrack {
  /** 트랙 고유 ID */
  trackId: string;
  /** 원본 드론 ID */
  droneId: string | null;
  /** 존재 확률 (0~1) */
  existenceProb: number;
  /** 위치 */
  position: Position;
  /** 속도 */
  velocity: Velocity;
  /** 분류 */
  classification: FusedClassification;
  /** 상세 분류 정보 */
  classInfo: TrackClassificationInfo;
  /** 위협 점수 (0~100) */
  threatScore: number;
  /** 위협 레벨 */
  threatLevel: ThreatLevel;
  /** 센서 상태 */
  sensors: TrackSensorStatus;
  /** 품질 (0~1) */
  quality: number;
  /** 회피 중 여부 */
  isEvading: boolean;
  /** 무력화 여부 */
  isNeutralized: boolean;
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
  classification: FusedClassification;
  class_info: {
    classification: FusedClassification;
    confidence: number;
    armed: boolean | null;
    sizeClass: DroneSize | null;
    droneType: string | null;
  };
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
