/**
 * 센서 융합 시스템 타입 정의
 * 
 * Radar + Audio + EO 센서 데이터를 통합 Track으로 융합
 */

// ============================================
// 센서 타입 정의
// ============================================

/** 센서 유형 */
export type SensorType = 'RADAR' | 'AUDIO' | 'EO';

/** 분류 결과 */
export type Classification = 'HOSTILE' | 'FRIENDLY' | 'CIVIL' | 'UNKNOWN';

// ============================================
// 센서 관측치 (Observation) 인터페이스
// ============================================

/**
 * 센서 관측치 (Observation)
 * 각 센서에서 생성되는 원시 데이터
 */
export interface SensorObservation {
  /** 센서 유형 */
  sensor: SensorType;
  
  /** 관측 시간 (시뮬레이션 시간, 초) */
  time: number;
  
  /** 관측된 드론 ID (알 수 없으면 null) */
  droneId: string | null;
  
  /** 방위각 (도, 0~360), AUDIO는 부정확할 수 있음 */
  bearing: number | null;
  
  /** 거리 (m), AUDIO는 null일 수 있음 */
  range: number | null;
  
  /** 고도 (m), AUDIO는 null일 수 있음 */
  altitude: number | null;
  
  /** 탐지 신뢰도 (0~1) */
  confidence: number;
  
  /** 분류 결과 (EO에서 주로 제공) */
  classification?: Classification;
  
  /** 분류 신뢰도 (0~1) */
  classConfidence?: number;
  
  /** 추가 데이터 */
  metadata?: {
    /** 레이더: 접근 속도 */
    radialVelocity?: number;
    /** 오탐 여부 */
    isFalseAlarm?: boolean;
    /** 음향: 활동 상태 */
    activityState?: string;
    /** 최초 탐지 여부 */
    isFirstDetection?: boolean;
    /** EO: 무장 여부 */
    armed?: boolean;
    /** EO: 크기 분류 */
    sizeClass?: 'SMALL' | 'MEDIUM' | 'LARGE';
    /** EO: 드론 타입 */
    droneType?: string;
  };
}

// ============================================
// 통합 트랙 (Track) 인터페이스
// ============================================

/**
 * 센서별 탐지 상태
 */
export interface SensorStatus {
  /** 레이더 탐지 여부 */
  radarSeen: boolean;
  /** 레이더 마지막 탐지 시간 */
  radarLastSeen: number;
  
  /** 음향 탐지 여부 */
  audioHeard: boolean;
  /** 음향 마지막 탐지 시간 */
  audioLastSeen: number;
  
  /** EO 확인 여부 */
  eoSeen: boolean;
  /** EO 마지막 확인 시간 */
  eoLastSeen: number;
}

/**
 * 위치 정보
 */
export interface TrackPosition {
  x: number;
  y: number;
  altitude: number;
}

/**
 * 속도 정보
 */
export interface TrackVelocity {
  vx: number;
  vy: number;
  climbRate: number;
}

/**
 * 분류 정보
 */
export interface ClassificationInfo {
  /** 분류 결과 */
  classification: Classification;
  /** 분류 신뢰도 (0~1) */
  confidence: number;
  /** 분류 소스 센서 */
  source: SensorType | 'FUSED';
  /** 무장 여부 */
  armed: boolean | null;
  /** 크기 분류 */
  sizeClass: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  /** 드론 타입 */
  droneType: string | null;
}

/**
 * 통합 트랙 (Track)
 * 센서 융합 결과
 */
export interface FusedTrack {
  /** 트랙 고유 ID */
  id: string;
  
  /** 원본 드론 ID (매칭된 경우) */
  droneId: string | null;
  
  /** 융합된 위치 */
  position: TrackPosition;
  
  /** 이전 위치 (속도 계산용) */
  previousPosition: TrackPosition | null;
  
  /** 융합된 속도 */
  velocity: TrackVelocity;
  
  /** 존재 확률 (0~1) */
  existenceProb: number;
  
  /** 마지막 업데이트 시간 */
  lastUpdateTime: number;
  
  /** 트랙 생성 시간 */
  createdTime: number;
  
  /** 센서별 탐지 상태 */
  sensors: SensorStatus;
  
  /** 분류 정보 */
  classificationInfo: ClassificationInfo;
  
  /** 위협 점수 (0~100) */
  threatScore: number;
  
  /** 위협 레벨 */
  threatLevel: 'INFO' | 'CAUTION' | 'DANGER' | 'CRITICAL';
  
  /** 위치 히스토리 */
  positionHistory: TrackPosition[];
  
  /** 트랙 품질 (0~1) - 센서 다양성, 업데이트 빈도 등 */
  quality: number;
  
  /** 연속 미탐지 횟수 */
  missedUpdates: number;
  
  /** 무력화 여부 */
  isNeutralized: boolean;
  
  /** 회피 중 여부 */
  isEvading: boolean;
}

// ============================================
// 융합 설정 인터페이스
// ============================================

/**
 * 센서별 가중치 설정
 */
export interface SensorWeights {
  /** 레이더 존재 확률 가중치 */
  radarExistence: number;
  /** 레이더 위치 가중치 */
  radarPosition: number;
  
  /** 음향 존재 확률 가중치 */
  audioExistence: number;
  /** 음향 방향 가중치 */
  audioBearing: number;
  
  /** EO 존재 확률 가중치 */
  eoExistence: number;
  /** EO 분류 가중치 */
  eoClassification: number;
}

/**
 * 트랙 매칭 설정
 */
export interface TrackMatchingConfig {
  /** 같은 트랙으로 판단하는 최대 거리 (m) */
  maxDistanceThreshold: number;
  /** 같은 트랙으로 판단하는 최대 방위각 차이 (도) */
  maxBearingThreshold: number;
  /** 트랙 소멸까지 최대 미탐지 시간 (초) */
  trackDropTimeout: number;
  /** 존재 확률 감쇠율 (초당) */
  existenceDecayRate: number;
}

/**
 * 위협 평가 설정
 */
export interface ThreatAssessmentConfig {
  /** 기지 위치 */
  basePosition: TrackPosition;
  /** 안전 거리 (m) */
  safeDistance: number;
  /** 위험 거리 (m) */
  dangerDistance: number;
  /** 위협 점수 가중치 */
  weights: {
    existence: number;
    classification: number;
    distance: number;
    velocity: number;
    behavior: number;
  };
}

/**
 * 센서 융합 전체 설정
 */
export interface FusionConfig {
  /** 센서 가중치 */
  sensorWeights: SensorWeights;
  /** 트랙 매칭 설정 */
  trackMatching: TrackMatchingConfig;
  /** 위협 평가 설정 */
  threatAssessment: ThreatAssessmentConfig;
  /** 위치 히스토리 최대 개수 */
  maxHistoryLength: number;
}

// ============================================
// 기본 설정값
// ============================================

/**
 * 센서 가중치 설정
 * 
 * Radar = 0.6 (위치 정확, 분류 불가)
 * Audio = 0.3 (방향만, 존재 확인)
 * EO = 0.9 (분류 가능, 가장 신뢰)
 */
export const DEFAULT_SENSOR_WEIGHTS: SensorWeights = {
  radarExistence: 0.6,   // 레이더 존재 확률 기여도
  radarPosition: 0.7,    // 레이더 위치 정확도
  audioExistence: 0.3,   // 음향 존재 확률 기여도
  audioBearing: 0.25,    // 음향 방향 정확도 (조금 낮춤)
  eoExistence: 0.9,      // EO 존재 확률 기여도 (가장 높음)
  eoClassification: 0.9, // EO 분류 신뢰도
};

export const DEFAULT_TRACK_MATCHING: TrackMatchingConfig = {
  maxDistanceThreshold: 100,    // 100m 이내면 같은 트랙
  maxBearingThreshold: 15,      // 15도 이내면 같은 방향
  trackDropTimeout: 10,         // 10초 미탐지시 트랙 제거
  existenceDecayRate: 0.05,     // 초당 5% 감쇠
};

export const DEFAULT_THREAT_ASSESSMENT: ThreatAssessmentConfig = {
  basePosition: { x: 0, y: 0, altitude: 50 },
  safeDistance: 500,
  dangerDistance: 100,
  weights: {
    existence: 0.2,
    classification: 0.3,
    distance: 0.25,
    velocity: 0.15,
    behavior: 0.1,
  },
};

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  sensorWeights: DEFAULT_SENSOR_WEIGHTS,
  trackMatching: DEFAULT_TRACK_MATCHING,
  threatAssessment: DEFAULT_THREAT_ASSESSMENT,
  maxHistoryLength: 50,
};

// ============================================
// 융합 이벤트 타입
// ============================================

/**
 * 트랙 업데이트 이벤트
 */
export interface TrackUpdateEvent {
  timestamp: number;
  event: 'track_update';
  track_id: string;
  drone_id: string | null;
  existence_prob: number;
  position: TrackPosition;
  velocity: TrackVelocity;
  classification: Classification;
  threat_score: number;
  threat_level: string;
  sensors: {
    radar: boolean;
    audio: boolean;
    eo: boolean;
  };
  quality: number;
}

/**
 * 트랙 생성 이벤트
 */
export interface TrackCreatedEvent {
  timestamp: number;
  event: 'track_created';
  track_id: string;
  initial_sensor: SensorType;
  position: TrackPosition;
  confidence: number;
}

/**
 * 트랙 소멸 이벤트
 */
export interface TrackDroppedEvent {
  timestamp: number;
  event: 'track_dropped';
  track_id: string;
  reason: 'timeout' | 'neutralized' | 'low_existence';
  lifetime: number;
  final_existence_prob: number;
}

