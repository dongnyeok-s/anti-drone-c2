/**
 * 소부대 대드론 C2 시뮬레이터
 * 메인 애플리케이션 컴포넌트
 * 
 * WebSocket으로 시뮬레이터 서버와 양방향 통신
 * 모든 사용자 조작을 manual_action으로 로깅
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, RotateCcw, Wifi, WifiOff, Radio, Plus } from 'lucide-react';

import MapView from './components/MapView';
import DroneListPanel from './components/DroneListPanel';
import DroneDetailPanel from './components/DroneDetailPanel';
import LogPanel from './components/LogPanel';
import ControlPanel from './components/ControlPanel';

import { 
  SimulationState, 
  EngagementState, 
  DroneState, 
  DEFAULT_SIMULATION_CONFIG,
  LogEntry,
  DroneTrack,
  SimulatorEvent,
  Interceptor,
  InterceptorState,
  GuidanceMode,
} from './types';
import {
  createInitialState,
  simulationTick,
  changeEngagementState,
  changeDroneState,
  SCENARIOS,
  createDroneTrack,
} from './logic/simulator';
import { formatTime } from './utils';
import { useWebSocket, ConnectionStatus } from './hooks/useWebSocket';

const WS_URL = 'ws://localhost:8080';

// 시나리오 타입
interface ScenarioInfo {
  id: number | string;
  name: string;
  type: 'builtin' | 'generated';
}

function App() {
  // 시뮬레이션 상태
  const [state, setState] = useState<SimulationState>(() => createInitialState(1));
  const [config] = useState(DEFAULT_SIMULATION_CONFIG);
  
  // 요격기 상태
  const [interceptors, setInterceptors] = useState<Map<string, Interceptor>>(new Map());
  
  // 시뮬레이터 연결 모드
  const [useSimulator, setUseSimulator] = useState(false);
  
  // 시나리오 목록 (서버에서 수신)
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>(
    SCENARIOS.map(s => ({ id: s.id, name: s.name, type: 'builtin' as const }))
  );
  
  // 레이더 설정 (서버에서 수신)
  const [scanRate, setScanRate] = useState(1);
  
  // 유도 모드 (PN vs PURE_PURSUIT)
  const [guidanceMode, setGuidanceMode] = useState<GuidanceMode>('PN');

  // WebSocket 연결
  const { status: wsStatus, send, connect, disconnect } = useWebSocket({
    url: WS_URL,
    onMessage: (data) => handleSimulatorEvent(data as SimulatorEvent),
    onConnect: () => {
      addLog('SYSTEM', '시뮬레이터 서버 연결됨');
      // 서버에 시나리오 목록 요청
      send({ type: 'get_scenarios' });
    },
    onDisconnect: () => {
      addLog('SYSTEM', '시뮬레이터 서버 연결 해제');
    },
  });

  // manual_action 전송 헬퍼
  const sendManualAction = useCallback((action: string, targetId?: string, details?: Record<string, unknown>) => {
    if (wsStatus === 'connected') {
      send({
        type: 'manual_action',
        action,
        target_id: targetId,
        details,
      });
    }
  }, [wsStatus, send]);

  // 로그 추가 헬퍼
  function addLog(type: LogEntry['type'], message: string, droneId?: string) {
    const newLog: LogEntry = {
      time: state.currentTime,
      type,
      message,
      droneId,
    };
    setState(prev => ({
      ...prev,
      logs: [...prev.logs.slice(-100), newLog],
    }));
  }

  // 시뮬레이터 이벤트 핸들러
  function handleSimulatorEvent(event: SimulatorEvent) {
    switch (event.type) {
      case 'radar_detection':
        handleRadarDetection(event);
        break;
      case 'audio_detection':
        handleAudioDetection(event);
        break;
      case 'drone_state_update':
        handleDroneStateUpdate(event);
        break;
      case 'interceptor_update':
        handleInterceptorUpdate(event);
        break;
      case 'intercept_result':
        handleInterceptResult(event);
        break;
      case 'simulation_status':
        if ('sim_time' in event) {
          setState(prev => ({ ...prev, currentTime: event.sim_time as number }));
        }
        break;
      case 'initial_state':
        addLog('SYSTEM', '시뮬레이터 초기 상태 수신');
        // 시나리오 목록 업데이트
        if ('scenarios' in event && Array.isArray((event as any).scenarios)) {
          setScenarios((event as any).scenarios);
        }
        // 레이더 설정 업데이트
        if ('radarConfig' in event && (event as any).radarConfig) {
          setScanRate((event as any).radarConfig.scan_rate || 1);
        }
        break;
      case 'fused_track_update':
        handleFusedTrackUpdate(event as any);
        break;
      case 'track_created':
        handleTrackCreated(event as any);
        break;
      case 'track_dropped':
        handleTrackDropped(event as any);
        break;
      default:
        // scenario_list, scenarios_generated 등 처리
        if ((event as any).type === 'scenario_list' && (event as any).scenarios) {
          setScenarios((event as any).scenarios);
        }
        break;
    }
  }

  // 융합 트랙 업데이트 처리
  function handleFusedTrackUpdate(event: {
    track_id: string;
    drone_id: string | null;
    existence_prob: number;
    position: { x: number; y: number; altitude: number };
    velocity: { vx: number; vy: number; climbRate: number };
    classification: string;
    class_info: {
      classification: string;
      confidence: number;
      armed: boolean | null;
      sizeClass: string | null;
      droneType: string | null;
    };
    threat_score: number;
    threat_level: string;
    sensors: { radar: boolean; audio: boolean; eo: boolean };
    quality: number;
    is_evading: boolean;
    is_neutralized: boolean;
  }) {
    if (!event.drone_id) return;

    setState(prev => {
      const existingDrone = prev.drones.find(d => d.id === event.drone_id);
      
      if (existingDrone) {
        // 기존 드론 업데이트 (융합 정보 추가)
        return {
          ...prev,
          drones: prev.drones.map(d => 
            d.id === event.drone_id
              ? {
                  ...d,
                  position: event.position,
                  velocity: event.velocity,
                  confidence: event.class_info.confidence,
                  threat: {
                    ...d.threat,
                    totalScore: event.threat_score,
                    level: event.threat_level as any,
                  },
                  lastUpdatedAt: prev.currentTime,
                  isEvading: event.is_evading,
                  // 융합 정보
                  fusedTrackId: event.track_id,
                  existenceProb: event.existence_prob,
                  sensorStatus: event.sensors,
                  trackQuality: event.quality,
                  fusedClassification: event.classification as any,
                  // 분류 정보
                  armed: event.class_info.armed ?? undefined,
                  sizeClass: (event.class_info.sizeClass as any) ?? undefined,
                  droneType: (event.class_info.droneType as any) ?? undefined,
                }
              : d
          ),
        };
      }
      
      return prev;
    });
  }

  // 트랙 생성 처리
  function handleTrackCreated(event: {
    track_id: string;
    initial_sensor: string;
    position: { x: number; y: number; altitude: number };
    confidence: number;
  }) {
    addLog('DETECTION', 
      `새 트랙 생성: ${event.track_id} (${event.initial_sensor})`,
      event.track_id
    );
  }

  // 트랙 소멸 처리
  function handleTrackDropped(event: {
    track_id: string;
    reason: string;
    lifetime: number;
  }) {
    const reasonLabels: Record<string, string> = {
      timeout: '시간 초과',
      neutralized: '무력화',
      low_existence: '낮은 존재 확률',
    };
    addLog('SYSTEM', 
      `트랙 소멸: ${event.track_id} (${reasonLabels[event.reason] || event.reason}, ${event.lifetime.toFixed(1)}초)`,
      event.track_id
    );
  }

  // 레이더 탐지 이벤트 처리
  function handleRadarDetection(event: SimulatorEvent & { type: 'radar_detection' }) {
    const { drone_id, range, bearing, altitude, confidence, is_false_alarm } = event as any;
    
    if (is_false_alarm) {
      addLog('DETECTION', `레이더 오탐 (거리: ${range.toFixed(0)}m, 방위: ${bearing.toFixed(0)}°)`);
      return;
    }

    const bearingRad = (bearing * Math.PI) / 180;
    const x = range * Math.sin(bearingRad);
    const y = range * Math.cos(bearingRad);

    setState(prev => {
      const existingDrone = prev.drones.find(d => d.id === drone_id);
      
      if (existingDrone) {
        return {
          ...prev,
          drones: prev.drones.map(d => 
            d.id === drone_id
              ? {
                  ...d,
                  position: { x, y, altitude },
                  confidence,
                  lastUpdatedAt: prev.currentTime,
                  history: [...d.history.slice(-49), { x, y, altitude }],
                }
              : d
          ),
        };
      } else {
        const newDrone = createDroneTrack({
          position: { x, y, altitude },
          velocity: { vx: 0, vy: 0, climbRate: 0 },
          sensorSource: 'RADAR',
          confidence,
          currentTime: prev.currentTime,
        });
        newDrone.id = drone_id;
        
        addLog('DETECTION', `레이더 탐지: ${drone_id} (거리: ${range.toFixed(0)}m)`, drone_id);
        
        return {
          ...prev,
          drones: [...prev.drones, newDrone],
        };
      }
    });
  }

  // 음향 탐지 이벤트 처리
  function handleAudioDetection(event: SimulatorEvent & { type: 'audio_detection' }) {
    const { drone_id, state: activityState, confidence, estimated_distance, estimated_bearing } = event as any;
    
    const stateLabels: Record<string, string> = {
      TAKEOFF: '이륙',
      APPROACH: '접근',
      HOVER: '호버링',
      DEPART: '이탈',
      IDLE: '대기',
      NOISE: '소음',
    };
    
    addLog('AUDIO', 
      `음향 탐지: ${drone_id} - ${stateLabels[activityState] || activityState} (신뢰도: ${(confidence * 100).toFixed(0)}%)`,
      drone_id
    );

    if (activityState === 'TAKEOFF' || activityState === 'APPROACH') {
      setState(prev => {
        const existingDrone = prev.drones.find(d => d.id === drone_id);
        
        if (existingDrone) {
          const newThreat = { ...existingDrone.threat };
          if (activityState === 'TAKEOFF') {
            newThreat.behaviorScore = Math.min(1, newThreat.behaviorScore + 0.2);
          } else if (activityState === 'APPROACH') {
            newThreat.velocityScore = Math.min(1, newThreat.velocityScore + 0.3);
          }
          newThreat.totalScore = Math.min(100, newThreat.totalScore + 10);
          
          return {
            ...prev,
            drones: prev.drones.map(d => 
              d.id === drone_id ? { ...d, threat: newThreat } : d
            ),
          };
        } else if (estimated_distance && estimated_bearing) {
          const bearingRad = (estimated_bearing * Math.PI) / 180;
          const x = estimated_distance * Math.sin(bearingRad);
          const y = estimated_distance * Math.cos(bearingRad);
          
          const newDrone = createDroneTrack({
            position: { x, y, altitude: 80 },
            velocity: { vx: 0, vy: 0, climbRate: 0 },
            sensorSource: 'AUDIO',
            confidence: confidence * 0.8,
            currentTime: prev.currentTime,
          });
          newDrone.id = drone_id;
          
          return {
            ...prev,
            drones: [...prev.drones, newDrone],
          };
        }
        
        return prev;
      });
    }
  }

  // 드론 상태 업데이트 처리
  function handleDroneStateUpdate(event: SimulatorEvent & { type: 'drone_state_update' }) {
    const { drone_id, position, velocity, behavior, is_evading } = event as any;
    
    setState(prev => ({
      ...prev,
      drones: prev.drones.map(d => 
        d.id === drone_id
          ? {
              ...d,
              position,
              velocity,
              behaviorPattern: behavior,
              lastUpdatedAt: prev.currentTime,
              engagementState: is_evading ? 'TRACK' : d.engagementState,
            }
          : d
      ),
    }));
  }

  // 요격기 업데이트 처리
  function handleInterceptorUpdate(event: SimulatorEvent & { type: 'interceptor_update' }) {
    const { interceptor_id, target_id, state: intState, position, distance_to_target } = event as any;
    
    setInterceptors(prev => {
      const newMap = new Map(prev);
      newMap.set(interceptor_id, {
        id: interceptor_id,
        position,
        state: intState as InterceptorState,
        targetId: target_id,
        distanceToTarget: distance_to_target,
      });
      return newMap;
    });
  }

  // 요격 결과 처리
  function handleInterceptResult(event: SimulatorEvent & { type: 'intercept_result' }) {
    const { interceptor_id, target_id, result, details } = event as any;
    
    const resultLabels: Record<string, string> = {
      SUCCESS: '요격 성공',
      MISS: '요격 실패',
      EVADED: '타겟 회피',
      ABORTED: '요격 중단',
    };
    
    addLog('ENGAGEMENT', `${resultLabels[result]}: ${interceptor_id} → ${target_id}`, target_id);
    
    if (result === 'SUCCESS') {
      setState(prev => ({
        ...prev,
        drones: prev.drones.map(d => 
          d.id === target_id
            ? { ...d, engagementState: 'ENGAGE' as EngagementState }
            : d
        ),
      }));
    }
  }

  // 로컬 시뮬레이션 실행 (시뮬레이터 미연결 시)
  useEffect(() => {
    if (useSimulator || !state.isRunning) return;

    const interval = setInterval(() => {
      setState((prev) => simulationTick(prev, config));
    }, (state.tickInterval * 1000) / state.speedMultiplier);

    return () => clearInterval(interval);
  }, [useSimulator, state.isRunning, state.tickInterval, state.speedMultiplier, config]);

  // 시뮬레이션 시작/정지 (로깅 포함)
  const toggleSimulation = useCallback(() => {
    const newRunning = !state.isRunning;
    
    // manual_action 로깅
    sendManualAction(newRunning ? 'simulation_start' : 'simulation_pause');
    
    if (useSimulator) {
      send({ 
        type: 'simulation_control', 
        action: newRunning ? 'start' : 'pause' 
      });
    }
    setState((prev) => ({ ...prev, isRunning: newRunning }));
  }, [useSimulator, state.isRunning, send, sendManualAction]);

  // 시뮬레이션 리셋 (로깅 포함)
  const resetSimulation = useCallback((scenarioId: number | string = 1) => {
    // manual_action 로깅
    sendManualAction('simulation_reset', undefined, { scenario_id: scenarioId });
    
    if (useSimulator) {
      send({ 
        type: 'simulation_control', 
        action: 'reset',
        scenario_id: scenarioId,
      });
    }
    setState(createInitialState(typeof scenarioId === 'number' ? scenarioId : 1));
    setInterceptors(new Map());
  }, [useSimulator, send, sendManualAction]);

  // 드론 선택 (로깅 포함)
  const selectDrone = useCallback((droneId: string | null) => {
    // manual_action 로깅
    sendManualAction('selected_drone', droneId || undefined, { 
      previous_id: state.selectedDroneId 
    });
    
    setState((prev) => ({ ...prev, selectedDroneId: droneId }));
  }, [sendManualAction, state.selectedDroneId]);

  // 교전 상태 변경 (로깅 포함)
  const handleEngagementChange = useCallback((droneId: string, newState: EngagementState) => {
    // manual_action 로깅
    if (newState === 'ENGAGE') {
      sendManualAction('clicked_engage', droneId, { engagement_state: newState });
    } else if (newState === 'IGNORE') {
      sendManualAction('clicked_ignore', droneId);
    } else {
      sendManualAction('engagement_state_change', droneId, { new_state: newState });
    }
    
    if (useSimulator) {
      if (newState === 'ENGAGE') {
        send({ type: 'engage_command', drone_id: droneId, method: 'interceptor_drone' });
      } else {
        send({ type: 'engagement_state_command', drone_id: droneId, state: newState });
      }
    }
    setState((prev) => changeEngagementState(prev, droneId, newState));
  }, [useSimulator, send, sendManualAction]);

  // 드론 식별 상태 변경 (로깅 포함)
  const handleStateChange = useCallback((droneId: string, newState: DroneState) => {
    // manual_action 로깅
    sendManualAction('drone_state_change', droneId, { new_state: newState });
    
    setState((prev) => changeDroneState(prev, droneId, newState));
  }, [sendManualAction]);

  // 속도 변경 (로깅 포함)
  const handleSpeedChange = useCallback((multiplier: number) => {
    // manual_action 로깅
    sendManualAction('speed_change', undefined, { 
      old_speed: state.speedMultiplier, 
      new_speed: multiplier 
    });
    
    if (useSimulator) {
      send({ type: 'simulation_control', action: 'set_speed', speed_multiplier: multiplier });
    }
    setState((prev) => ({ ...prev, speedMultiplier: multiplier }));
  }, [useSimulator, send, sendManualAction, state.speedMultiplier]);

  // 유도 모드 변경 (로깅 포함)
  const handleGuidanceModeChange = useCallback((mode: GuidanceMode) => {
    // manual_action 로깅
    sendManualAction('guidance_mode_change', undefined, { 
      old_mode: guidanceMode, 
      new_mode: mode 
    });
    
    if (useSimulator) {
      send({ type: 'set_guidance_mode', guidance_mode: mode });
    }
    setGuidanceMode(mode);
    addLog('SYSTEM', `유도 모드 변경: ${mode === 'PN' ? '비례 항법 (PN)' : '직선 추격'}`);
  }, [useSimulator, send, sendManualAction, guidanceMode]);

  // 시뮬레이터 연결 토글 (로깅 포함)
  const toggleSimulatorConnection = useCallback(() => {
    if (wsStatus === 'connected') {
      sendManualAction('simulator_disconnect');
      disconnect();
      setUseSimulator(false);
    } else {
      connect();
      setUseSimulator(true);
      // 연결 성공 시 로깅은 onConnect에서 처리
    }
  }, [wsStatus, connect, disconnect, sendManualAction]);

  // 시나리오 생성 요청
  const generateScenario = useCallback(() => {
    if (wsStatus === 'connected') {
      send({ type: 'generate_scenario', seed: Date.now() });
      sendManualAction('generate_scenario');
    }
  }, [wsStatus, send, sendManualAction]);

  // 선택된 드론 정보
  const selectedDrone = state.drones.find((d) => d.id === state.selectedDroneId) || null;

  // 위협 통계
  const threatStats = useMemo(() => ({
    total: state.drones.length,
    critical: state.drones.filter((d) => d.threat.level === 'CRITICAL').length,
    danger: state.drones.filter((d) => d.threat.level === 'DANGER').length,
    caution: state.drones.filter((d) => d.threat.level === 'CAUTION').length,
    info: state.drones.filter((d) => d.threat.level === 'INFO').length,
  }), [state.drones]);

  // 연결 상태 색상
  const getConnectionColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'connected': return 'text-emerald-400';
      case 'connecting': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 flex flex-col">
      {/* 헤더 */}
      <header className="h-14 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">C2</span>
          </div>
          <div>
            <h1 className="font-semibold text-sm">소부대 대드론 C2</h1>
            <p className="text-xs text-slate-400">시뮬레이터 v2.0</p>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-700" />

        {/* 시뮬레이터 연결 */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={toggleSimulatorConnection}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                     border ${wsStatus === 'connected' 
                       ? 'bg-emerald-500/20 border-emerald-500/50' 
                       : 'bg-slate-700 border-slate-600'}`}
        >
          {wsStatus === 'connected' ? (
            <Wifi className={`w-4 h-4 ${getConnectionColor(wsStatus)}`} />
          ) : (
            <WifiOff className={`w-4 h-4 ${getConnectionColor(wsStatus)}`} />
          )}
          <span className={getConnectionColor(wsStatus)}>
            {wsStatus === 'connected' ? '연결됨' : 
             wsStatus === 'connecting' ? '연결중...' : '연결 안됨'}
          </span>
        </motion.button>

        <div className="h-6 w-px bg-slate-700" />

        {/* 시뮬레이션 컨트롤 */}
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleSimulation}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium ${
              state.isRunning
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
            }`}
          >
            {state.isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {state.isRunning ? '일시정지' : '시작'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => resetSimulation(1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium
                       bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600"
          >
            <RotateCcw className="w-4 h-4" />
            리셋
          </motion.button>
        </div>

        {/* 시간 표시 */}
        <div className="flex items-center gap-4 ml-4">
          <div className="text-center">
            <p className="text-xs text-slate-400">경과시간</p>
            <p className="font-mono text-lg text-emerald-400">{formatTime(state.currentTime)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-400">속도</p>
            <p className="font-mono text-lg text-slate-300">x{state.speedMultiplier}</p>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-700" />

        {/* 위협 현황 */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">위협:</span>
          {threatStats.critical > 0 && (
            <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-medium animate-pulse">
              긴급 {threatStats.critical}
            </span>
          )}
          {threatStats.danger > 0 && (
            <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 text-xs font-medium">
              위험 {threatStats.danger}
            </span>
          )}
          {threatStats.caution > 0 && (
            <span className="px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 text-xs font-medium">
              주의 {threatStats.caution}
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-400 text-xs">
            전체 {threatStats.total}
          </span>
        </div>

        {/* 요격기 현황 */}
        {interceptors.size > 0 && (
          <>
            <div className="h-6 w-px bg-slate-700" />
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-purple-400">
                요격기 {interceptors.size}대
              </span>
            </div>
          </>
        )}

        {/* 시나리오 선택 */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400">시나리오:</span>
          <select
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-300"
            onChange={(e) => {
              const val = e.target.value;
              resetSimulation(val.startsWith('gen_') ? val : Number(val));
            }}
            defaultValue={1}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {typeof s.id === 'number' ? `${s.id}. ` : ''}{s.name}
                {s.type === 'generated' && ' (생성)'}
              </option>
            ))}
          </select>
          
          {/* 시나리오 생성 버튼 */}
          {wsStatus === 'connected' && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={generateScenario}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                         bg-purple-500/20 text-purple-400 border border-purple-500/50"
              title="새 시나리오 생성"
            >
              <Plus className="w-3.5 h-3.5" />
              생성
            </motion.button>
          )}
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측: 드론 리스트 */}
        <div className="w-80 border-r border-slate-700 flex flex-col">
          <div className="px-3 py-2 bg-slate-800 border-b border-slate-700">
            <h2 className="text-sm font-medium text-slate-300">탐지 목록</h2>
          </div>
          <DroneListPanel
            drones={state.drones}
            selectedId={state.selectedDroneId}
            onSelect={selectDrone}
          />
        </div>

        {/* 중앙: 맵 뷰 */}
        <div className="flex-1 flex flex-col">
          <MapView
            drones={state.drones}
            interceptors={Array.from(interceptors.values())}
            selectedId={state.selectedDroneId}
            onSelect={selectDrone}
            mapSize={config.mapSize}
            scanRate={scanRate}
          />

          {/* 하단: 로그 패널 */}
          <div className="h-44 border-t border-slate-700">
            <LogPanel logs={state.logs} />
          </div>
        </div>

        {/* 우측: 상세 정보 */}
        <div className="w-96 border-l border-slate-700 flex flex-col">
          <div className="px-3 py-2 bg-slate-800 border-b border-slate-700">
            <h2 className="text-sm font-medium text-slate-300">상세 정보</h2>
          </div>
          <DroneDetailPanel
            drone={selectedDrone}
            onEngagementChange={handleEngagementChange}
            onStateChange={handleStateChange}
          />

          {/* 컨트롤 패널 */}
          <div className="border-t border-slate-700">
            <ControlPanel
              speedMultiplier={state.speedMultiplier}
              onSpeedChange={handleSpeedChange}
              isConnected={wsStatus === 'connected'}
              guidanceMode={guidanceMode}
              onGuidanceModeChange={handleGuidanceModeChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
