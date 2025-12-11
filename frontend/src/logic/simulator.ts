/**
 * 로컬 시뮬레이션 로직
 * 
 * 시뮬레이터 서버 미연결 시 로컬에서 시뮬레이션 수행
 */

import { 
  SimulationState, 
  SimulationConfig, 
  DroneTrack, 
  EngagementState, 
  DroneState,
  ThreatLevel,
  LogEntry,
  Position,
  Velocity,
  ThreatScore,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

// 시나리오 정의
export interface Scenario {
  id: number;
  name: string;
  description: string;
  drones: Omit<DroneTrack, 'id' | 'history' | 'createdAt' | 'lastUpdatedAt'>[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    name: '기본 혼합',
    description: '다양한 위협 수준의 드론 3대',
    drones: [
      {
        position: { x: 300, y: 250, altitude: 80 },
        velocity: { vx: -12, vy: -10, climbRate: -0.5 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'RADAR',
        confidence: 0.9,
        threat: {
          level: 'DANGER',
          totalScore: 72,
          distanceScore: 0.6,
          velocityScore: 0.8,
          behaviorScore: 0.7,
          payloadScore: 0.5,
          sizeScore: 0.5,
        },
      },
      {
        position: { x: -200, y: 100, altitude: 120 },
        velocity: { vx: 3, vy: 5, climbRate: 0 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'RADAR',
        confidence: 0.85,
        threat: {
          level: 'CAUTION',
          totalScore: 45,
          distanceScore: 0.5,
          velocityScore: 0.3,
          behaviorScore: 0.4,
          payloadScore: 0.3,
          sizeScore: 0.4,
        },
      },
      {
        position: { x: 50, y: -350, altitude: 150 },
        velocity: { vx: 0, vy: 8, climbRate: 0 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'RADAR',
        confidence: 0.75,
        threat: {
          level: 'INFO',
          totalScore: 28,
          distanceScore: 0.3,
          velocityScore: 0.2,
          behaviorScore: 0.3,
          payloadScore: 0.2,
          sizeScore: 0.3,
        },
      },
    ],
  },
  {
    id: 2,
    name: '다중 위협',
    description: '4방향 동시 고속 접근',
    drones: [
      {
        position: { x: 450, y: 50, altitude: 60 },
        velocity: { vx: -18, vy: -2, climbRate: 0 },
        droneState: 'HOSTILE',
        engagementState: 'TRACK',
        sensorSource: 'RADAR',
        confidence: 0.92,
        threat: {
          level: 'CRITICAL',
          totalScore: 88,
          distanceScore: 0.85,
          velocityScore: 0.95,
          behaviorScore: 0.9,
          payloadScore: 0.7,
          sizeScore: 0.6,
        },
      },
      {
        position: { x: 50, y: 420, altitude: 70 },
        velocity: { vx: -2, vy: -16, climbRate: 0 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'RADAR',
        confidence: 0.88,
        threat: {
          level: 'DANGER',
          totalScore: 75,
          distanceScore: 0.7,
          velocityScore: 0.85,
          behaviorScore: 0.75,
          payloadScore: 0.5,
          sizeScore: 0.5,
        },
      },
      {
        position: { x: -380, y: 60, altitude: 55 },
        velocity: { vx: 15, vy: -3, climbRate: 0.5 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'RADAR',
        confidence: 0.9,
        threat: {
          level: 'DANGER',
          totalScore: 70,
          distanceScore: 0.65,
          velocityScore: 0.8,
          behaviorScore: 0.7,
          payloadScore: 0.5,
          sizeScore: 0.5,
        },
      },
      {
        position: { x: 30, y: -400, altitude: 80 },
        velocity: { vx: -1, vy: 14, climbRate: 0 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'RADAR',
        confidence: 0.86,
        threat: {
          level: 'CAUTION',
          totalScore: 55,
          distanceScore: 0.55,
          velocityScore: 0.7,
          behaviorScore: 0.5,
          payloadScore: 0.4,
          sizeScore: 0.4,
        },
      },
    ],
  },
  {
    id: 3,
    name: '은밀 접근',
    description: '저속 은밀 침투 + 주의분산용 고속기',
    drones: [
      {
        position: { x: 250, y: 200, altitude: 35 },
        velocity: { vx: -2, vy: -1.5, climbRate: 0 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'AUDIO',
        confidence: 0.65,
        threat: {
          level: 'CAUTION',
          totalScore: 48,
          distanceScore: 0.5,
          velocityScore: 0.15,
          behaviorScore: 0.65,
          payloadScore: 0.6,
          sizeScore: 0.3,
        },
      },
      {
        position: { x: -200, y: 280, altitude: 40 },
        velocity: { vx: 1.2, vy: -1.8, climbRate: 0 },
        droneState: 'UNKNOWN',
        engagementState: 'IGNORE',
        sensorSource: 'AUDIO',
        confidence: 0.6,
        threat: {
          level: 'CAUTION',
          totalScore: 45,
          distanceScore: 0.45,
          velocityScore: 0.12,
          behaviorScore: 0.6,
          payloadScore: 0.55,
          sizeScore: 0.3,
        },
      },
      {
        position: { x: 500, y: -150, altitude: 180 },
        velocity: { vx: -28, vy: 6, climbRate: -1 },
        droneState: 'UNKNOWN',
        engagementState: 'TRACK',
        sensorSource: 'RADAR',
        confidence: 0.95,
        threat: {
          level: 'DANGER',
          totalScore: 65,
          distanceScore: 0.6,
          velocityScore: 0.95,
          behaviorScore: 0.5,
          payloadScore: 0.35,
          sizeScore: 0.55,
        },
      },
    ],
  },
];

/**
 * 드론 트랙 생성
 */
export function createDroneTrack(params: {
  position: Position;
  velocity: Velocity;
  sensorSource: DroneTrack['sensorSource'];
  confidence: number;
  currentTime: number;
}): DroneTrack {
  const { position, velocity, sensorSource, confidence, currentTime } = params;
  
  // 위협 점수 계산
  const threat = calculateThreat(position, velocity, confidence);
  
  return {
    id: `DRONE-${uuidv4().substring(0, 6).toUpperCase()}`,
    position,
    velocity,
    droneState: 'UNKNOWN',
    engagementState: 'IGNORE',
    sensorSource,
    confidence,
    threat,
    history: [{ ...position }],
    createdAt: currentTime,
    lastUpdatedAt: currentTime,
  };
}

/**
 * 위협 점수 계산
 */
function calculateThreat(position: Position, velocity: Velocity, confidence: number): ThreatScore {
  const distance = Math.sqrt(position.x ** 2 + position.y ** 2);
  const speed = Math.sqrt(velocity.vx ** 2 + velocity.vy ** 2);
  
  // 접근 속도 계산
  const closingSpeed = -(position.x * velocity.vx + position.y * velocity.vy) / Math.max(distance, 1);
  
  // 각 요소별 점수 (0~1)
  const distanceScore = Math.min(1, Math.max(0, 1 - distance / 500));
  const velocityScore = Math.min(1, Math.max(0, closingSpeed / 30));
  const behaviorScore = closingSpeed > 5 ? 0.7 : 0.3;
  const payloadScore = 0.5; // 기본값
  const sizeScore = 0.5; // 기본값
  
  // 가중 합산
  const weights = { distance: 0.3, velocity: 0.25, behavior: 0.2, payload: 0.15, size: 0.1 };
  const totalScore = (
    distanceScore * weights.distance +
    velocityScore * weights.velocity +
    behaviorScore * weights.behavior +
    payloadScore * weights.payload +
    sizeScore * weights.size
  ) * 100 * confidence;
  
  // 위협 레벨 결정
  let level: ThreatLevel;
  if (totalScore >= 75) level = 'CRITICAL';
  else if (totalScore >= 50) level = 'DANGER';
  else if (totalScore >= 25) level = 'CAUTION';
  else level = 'INFO';
  
  return {
    level,
    totalScore,
    distanceScore,
    velocityScore,
    behaviorScore,
    payloadScore,
    sizeScore,
  };
}

/**
 * 초기 시뮬레이션 상태 생성
 */
export function createInitialState(scenarioId: number = 1): SimulationState {
  const scenario = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
  
  const drones: DroneTrack[] = scenario.drones.map((d, i) => ({
    ...d,
    id: `DRONE-${String.fromCharCode(65 + i)}${Math.floor(Math.random() * 10)}`,
    history: [{ ...d.position }],
    createdAt: 0,
    lastUpdatedAt: 0,
  }));
  
  const logs: LogEntry[] = [
    { time: 0, type: 'SYSTEM', message: `시나리오 "${scenario.name}" 로드 완료` },
    { time: 0, type: 'SYSTEM', message: `${drones.length}개 표적 초기화` },
  ];
  
  return {
    currentTime: 0,
    isRunning: false,
    speedMultiplier: 1,
    tickInterval: 0.1,
    drones,
    logs,
    selectedDroneId: null,
  };
}

/**
 * 시뮬레이션 한 틱 진행
 */
export function simulationTick(state: SimulationState, config: SimulationConfig): SimulationState {
  const deltaTime = state.tickInterval * state.speedMultiplier;
  const newTime = state.currentTime + deltaTime;
  const newLogs = [...state.logs];
  
  // 드론 위치 업데이트
  const newDrones = state.drones.map(drone => {
    // 위치 업데이트
    const newPosition: Position = {
      x: drone.position.x + drone.velocity.vx * deltaTime,
      y: drone.position.y + drone.velocity.vy * deltaTime,
      altitude: Math.max(10, drone.position.altitude + drone.velocity.climbRate * deltaTime),
    };
    
    // 위협 재계산
    const threat = calculateThreat(newPosition, drone.velocity, drone.confidence);
    
    // 위협 레벨 변경 시 로그
    if (threat.level !== drone.threat.level && threat.level === 'CRITICAL') {
      newLogs.push({
        time: newTime,
        type: 'THREAT',
        message: `위협 등급 상승: ${drone.threat.level} → ${threat.level}`,
        droneId: drone.id,
      });
    }
    
    // 궤적 업데이트 (5틱마다)
    const history = Math.floor(newTime * 10) % 5 === 0
      ? [...drone.history.slice(-49), { ...newPosition }]
      : drone.history;
    
    return {
      ...drone,
      position: newPosition,
      threat,
      history,
      lastUpdatedAt: newTime,
    };
  });
  
  return {
    ...state,
    currentTime: newTime,
    drones: newDrones,
    logs: newLogs.slice(-100),
  };
}

/**
 * 교전 상태 변경
 */
export function changeEngagementState(
  state: SimulationState,
  droneId: string,
  newState: EngagementState
): SimulationState {
  const drone = state.drones.find(d => d.id === droneId);
  if (!drone) return state;
  
  const newLogs = [...state.logs, {
    time: state.currentTime,
    type: 'ENGAGEMENT' as const,
    message: `교전 상태 변경: ${drone.engagementState} → ${newState}`,
    droneId,
  }];
  
  return {
    ...state,
    drones: state.drones.map(d =>
      d.id === droneId ? { ...d, engagementState: newState } : d
    ),
    logs: newLogs.slice(-100),
  };
}

/**
 * 드론 식별 상태 변경
 */
export function changeDroneState(
  state: SimulationState,
  droneId: string,
  newState: DroneState
): SimulationState {
  const drone = state.drones.find(d => d.id === droneId);
  if (!drone) return state;
  
  const newLogs = [...state.logs, {
    time: state.currentTime,
    type: 'SYSTEM' as const,
    message: `식별 상태 변경: ${drone.droneState} → ${newState}`,
    droneId,
  }];
  
  // 아군으로 식별되면 위협 등급 낮춤
  let updatedDrone = { ...drone, droneState: newState };
  if (newState === 'FRIENDLY') {
    updatedDrone.threat = {
      ...drone.threat,
      level: 'INFO',
      totalScore: Math.min(20, drone.threat.totalScore),
    };
    updatedDrone.engagementState = 'IGNORE';
  }
  
  return {
    ...state,
    drones: state.drones.map(d => d.id === droneId ? updatedDrone : d),
    logs: newLogs.slice(-100),
  };
}
