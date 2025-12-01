/**
 * 드론 상세 정보 패널 (확장판)
 * 
 * 선택된 드론의 상세 정보 및 교전 옵션 표시
 * - EO 정찰 결과 섹션 추가
 * - 요격 방식 선택 UI 추가
 * - 음향 탐지 정보 추가
 */

import { motion } from 'framer-motion';
import { 
  Shield, Target, Eye, Crosshair, 
  MapPin, Compass, Mountain, Gauge,
  AlertTriangle, Radio, Camera, Volume2,
  Zap, Wifi, Bomb, Plane, Search
} from 'lucide-react';
import { 
  DroneTrack, EngagementState, DroneState, ThreatLevel, 
  InterceptMethod, INTERCEPT_METHOD_INFO, DroneType 
} from '../types';

interface DroneDetailPanelProps {
  drone: DroneTrack | null;
  onEngagementChange: (droneId: string, state: EngagementState, method?: InterceptMethod) => void;
  onStateChange: (droneId: string, state: DroneState) => void;
  onReconRequest?: (droneId: string) => void;
}

// 교전 버튼 설정
const ENGAGEMENT_BUTTONS: Array<{
  state: EngagementState;
  label: string;
  icon: React.ReactNode;
  color: string;
}> = [
  { state: 'IGNORE', label: '무시', icon: <Shield className="w-4 h-4" />, color: 'slate' },
  { state: 'TRACK', label: '추적', icon: <Eye className="w-4 h-4" />, color: 'yellow' },
  { state: 'ENGAGE_PREP', label: '교전준비', icon: <Target className="w-4 h-4" />, color: 'orange' },
  { state: 'ENGAGE', label: '교전', icon: <Crosshair className="w-4 h-4" />, color: 'red' },
];

// 식별 상태 버튼
const STATE_BUTTONS: Array<{
  state: DroneState;
  label: string;
  color: string;
}> = [
  { state: 'UNKNOWN', label: '미상', color: 'slate' },
  { state: 'HOSTILE', label: '적', color: 'red' },
  { state: 'FRIENDLY', label: '아군', color: 'green' },
  { state: 'CIVILIAN', label: '민간', color: 'blue' },
];

// 위협 요소 설명
const THREAT_FACTOR_LABELS: Record<string, string> = {
  distanceScore: '거리',
  velocityScore: '속도',
  behaviorScore: '행동',
  payloadScore: '탑재체',
  sizeScore: '크기',
};

// 위협 레벨 색상
const THREAT_LEVEL_COLORS: Record<ThreatLevel, string> = {
  CRITICAL: 'text-red-400 bg-red-500/20',
  DANGER: 'text-orange-400 bg-orange-500/20',
  CAUTION: 'text-yellow-400 bg-yellow-500/20',
  INFO: 'text-blue-400 bg-blue-500/20',
};

// 드론 타입 아이콘
const DRONE_TYPE_INFO: Record<DroneType, { label: string; icon: React.ReactNode; color: string }> = {
  RECON_UAV: { label: '정찰 드론', icon: <Search className="w-4 h-4" />, color: 'blue' },
  ATTACK_UAV: { label: '공격 드론', icon: <Crosshair className="w-4 h-4" />, color: 'red' },
  LOITER_MUNITION: { label: '배회형 탄약', icon: <Bomb className="w-4 h-4" />, color: 'orange' },
  CARGO_UAV: { label: '화물 드론', icon: <Plane className="w-4 h-4" />, color: 'green' },
  CIVILIAN: { label: '민간 드론', icon: <Wifi className="w-4 h-4" />, color: 'slate' },
  UNKNOWN: { label: '미상', icon: <AlertTriangle className="w-4 h-4" />, color: 'slate' },
};

export default function DroneDetailPanel({ 
  drone, 
  onEngagementChange, 
  onStateChange,
  onReconRequest 
}: DroneDetailPanelProps) {
  if (!drone) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-4">
        드론을 선택하면 상세 정보가 표시됩니다
      </div>
    );
  }

  const distance = Math.sqrt(drone.position.x ** 2 + drone.position.y ** 2);
  const bearing = ((Math.atan2(drone.position.x, drone.position.y) * 180) / Math.PI + 360) % 360;
  const speed = Math.sqrt(drone.velocity.vx ** 2 + drone.velocity.vy ** 2);

  const handleEngageWithMethod = (method: InterceptMethod) => {
    onEngagementChange(drone.id, 'ENGAGE', method);
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-4 space-y-4"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-lg font-semibold text-slate-100">{drone.id}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded ${THREAT_LEVEL_COLORS[drone.threat.level]}`}>
                {drone.threat.level}
              </span>
              <span className="text-xs text-slate-400">
                위협도 {drone.threat.totalScore.toFixed(0)}/100
              </span>
              {drone.audioDetected && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 flex items-center gap-1">
                  <Volume2 className="w-3 h-3" /> 음향
                </span>
              )}
              {drone.isEvading && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                  회피중
                </span>
              )}
            </div>
          </div>
          <div className={`p-2 rounded-lg ${THREAT_LEVEL_COLORS[drone.threat.level]}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        {/* EO 정찰 결과 */}
        {drone.eoConfirmation?.confirmed && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3"
          >
            <div className="flex items-center gap-2 text-cyan-400 text-sm font-medium mb-2">
              <Camera className="w-4 h-4" />
              EO 정찰 결과
              <span className="text-xs text-cyan-500/70 ml-auto">
                신뢰도 {((drone.eoConfirmation.confidence || 0) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">식별: </span>
                <span className={`font-medium ${
                  drone.eoConfirmation.classification === 'HOSTILE' ? 'text-red-400' :
                  drone.eoConfirmation.classification === 'FRIENDLY' ? 'text-green-400' :
                  'text-slate-300'
                }`}>
                  {drone.eoConfirmation.classification === 'HOSTILE' ? '적' :
                   drone.eoConfirmation.classification === 'FRIENDLY' ? '아군' :
                   drone.eoConfirmation.classification === 'NEUTRAL' ? '중립' : '미상'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">무장: </span>
                <span className={`font-medium ${
                  drone.eoConfirmation.armed ? 'text-red-400' : 'text-green-400'
                }`}>
                  {drone.eoConfirmation.armed ? '유' : '무'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">크기: </span>
                <span className="text-slate-300">
                  {drone.eoConfirmation.sizeClass === 'SMALL' ? '소형' :
                   drone.eoConfirmation.sizeClass === 'MEDIUM' ? '중형' : '대형'}
                </span>
              </div>
              {drone.eoConfirmation.droneType && (
                <div>
                  <span className="text-slate-500">타입: </span>
                  <span className="text-slate-300">
                    {DRONE_TYPE_INFO[drone.eoConfirmation.droneType]?.label || '미상'}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* 정찰 요청 버튼 */}
        {!drone.eoConfirmation?.confirmed && onReconRequest && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onReconRequest(drone.id)}
            className="w-full py-2 px-4 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30
                       hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-2 text-sm"
          >
            <Camera className="w-4 h-4" />
            EO 정찰 요청
          </motion.button>
        )}

        {/* 드론 타입 & 속성 */}
        {drone.droneType && (
          <div className="bg-slate-800/50 rounded-lg p-3">
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">드론 정보</h4>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {DRONE_TYPE_INFO[drone.droneType]?.icon}
                <span className="text-sm text-slate-300">
                  {DRONE_TYPE_INFO[drone.droneType]?.label}
                </span>
              </div>
              {drone.armed !== undefined && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  drone.armed ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                }`}>
                  {drone.armed ? '무장' : '비무장'}
                </span>
              )}
              {drone.sizeClass && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  {drone.sizeClass === 'SMALL' ? '소형' :
                   drone.sizeClass === 'MEDIUM' ? '중형' : '대형'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 위치 정보 */}
        <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">위치 정보</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-xs text-slate-500">거리</p>
                <p className="text-sm font-medium text-slate-200">{distance.toFixed(0)}m</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-blue-400" />
              <div>
                <p className="text-xs text-slate-500">방위</p>
                <p className="text-sm font-medium text-slate-200">{bearing.toFixed(0)}°</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Mountain className="w-4 h-4 text-amber-400" />
              <div>
                <p className="text-xs text-slate-500">고도</p>
                <p className="text-sm font-medium text-slate-200">{drone.position.altitude.toFixed(0)}m</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-purple-400" />
              <div>
                <p className="text-xs text-slate-500">속도</p>
                <p className="text-sm font-medium text-slate-200">{speed.toFixed(1)}m/s</p>
              </div>
            </div>
          </div>
        </div>

        {/* 위협 요소 분석 */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">위협 요소</h4>
          <div className="space-y-2">
            {Object.entries(THREAT_FACTOR_LABELS).map(([key, label]) => {
              const score = (drone.threat as any)[key] as number;
              if (score === undefined) return null;
              
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-300">{(score * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${
                        score > 0.7 ? 'bg-red-500' :
                        score > 0.4 ? 'bg-yellow-500' :
                        'bg-emerald-500'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${score * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 센서 정보 */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">센서 정보</h4>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-slate-300">{drone.sensorSource}</span>
            </div>
            <div>
              <span className="text-xs text-slate-500">신뢰도: </span>
              <span className="text-sm text-slate-300">{(drone.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
          {drone.behaviorPattern && (
            <div className="mt-2">
              <span className="text-xs text-slate-500">행동 패턴: </span>
              <span className={`text-sm ${
                drone.behaviorPattern === 'EVADE' ? 'text-amber-400' :
                drone.behaviorPattern === 'ATTACK_RUN' ? 'text-red-400' :
                'text-slate-300'
              }`}>
                {drone.behaviorPattern}
              </span>
            </div>
          )}
          {drone.audioDetected && drone.audioState && (
            <div className="mt-2 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-slate-500">음향 상태: </span>
              <span className={`text-sm ${
                drone.audioState === 'TAKEOFF' ? 'text-orange-400' :
                drone.audioState === 'APPROACH' ? 'text-red-400' :
                'text-slate-300'
              }`}>
                {drone.audioState}
              </span>
            </div>
          )}
        </div>

        {/* 식별 상태 */}
        <div>
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">식별 상태</h4>
          <div className="flex gap-2">
            {STATE_BUTTONS.map(({ state, label, color }) => (
              <motion.button
                key={state}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onStateChange(drone.id, state)}
                className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-all
                           ${drone.droneState === state 
                             ? `bg-${color}-500/30 text-${color}-400 border border-${color}-500/50`
                             : 'bg-slate-700 text-slate-400 border border-slate-600 hover:bg-slate-600'
                           }`}
                style={drone.droneState === state ? {
                  backgroundColor: color === 'red' ? 'rgba(239, 68, 68, 0.3)' :
                                  color === 'green' ? 'rgba(34, 197, 94, 0.3)' :
                                  color === 'blue' ? 'rgba(59, 130, 246, 0.3)' :
                                  'rgba(100, 116, 139, 0.3)',
                  color: color === 'red' ? '#f87171' :
                        color === 'green' ? '#4ade80' :
                        color === 'blue' ? '#60a5fa' :
                        '#94a3b8',
                } : {}}
              >
                {label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* 교전 옵션 */}
        <div>
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">교전 옵션</h4>
          <div className="grid grid-cols-2 gap-2">
            {ENGAGEMENT_BUTTONS.map(({ state, label, icon, color }) => (
              <motion.button
                key={state}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onEngagementChange(drone.id, state)}
                disabled={drone.droneState === 'FRIENDLY' && state !== 'IGNORE'}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded text-sm font-medium transition-all
                           ${drone.engagementState === state 
                             ? `bg-${color}-500/30 text-${color}-400 border border-${color}-500/50`
                             : 'bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600'
                           }
                           disabled:opacity-40 disabled:cursor-not-allowed`}
                style={drone.engagementState === state ? {
                  backgroundColor: color === 'red' ? 'rgba(239, 68, 68, 0.3)' :
                                  color === 'orange' ? 'rgba(249, 115, 22, 0.3)' :
                                  color === 'yellow' ? 'rgba(234, 179, 8, 0.3)' :
                                  'rgba(100, 116, 139, 0.3)',
                  color: color === 'red' ? '#f87171' :
                        color === 'orange' ? '#fb923c' :
                        color === 'yellow' ? '#facc15' :
                        '#94a3b8',
                } : {}}
              >
                {icon}
                {label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* 요격 방식 선택 (교전 상태일 때만) */}
        {(drone.engagementState === 'ENGAGE' || drone.engagementState === 'ENGAGE_PREP') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">요격 방식 선택</h4>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(INTERCEPT_METHOD_INFO) as InterceptMethod[]).map((method) => {
                const info = INTERCEPT_METHOD_INFO[method];
                const isRecommended = drone.recommendedMethod === method;
                
                return (
                  <motion.button
                    key={method}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleEngageWithMethod(method)}
                    className={`flex flex-col items-center justify-center gap-1 py-3 px-3 rounded-lg text-sm font-medium 
                               transition-all border ${
                      isRecommended 
                        ? 'bg-emerald-500/20 border-emerald-500/50'
                        : 'bg-slate-700/50 border-slate-600 hover:bg-slate-700'
                    }`}
                    style={{ borderColor: isRecommended ? undefined : info.color + '40' }}
                  >
                    <span className="text-xl">{info.icon}</span>
                    <span className="text-slate-200">{info.name}</span>
                    {isRecommended && (
                      <span className="text-xs text-emerald-400">권장</span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* 권고 사항 */}
        {drone.threat.level === 'CRITICAL' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/30 rounded-lg p-3"
          >
            <div className="flex items-center gap-2 text-red-400 text-sm font-medium mb-1">
              <AlertTriangle className="w-4 h-4" />
              긴급 대응 권고
            </div>
            <p className="text-xs text-red-300/80">
              고위험 표적입니다. 즉각적인 교전 조치를 권고합니다.
              {drone.recommendedMethod && (
                <span className="block mt-1">
                  권장 방식: <strong>{INTERCEPT_METHOD_INFO[drone.recommendedMethod].name}</strong>
                </span>
              )}
            </p>
          </motion.div>
        )}

        {/* 무장 드론 경고 */}
        {drone.armed && drone.droneState !== 'FRIENDLY' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3"
          >
            <div className="flex items-center gap-2 text-orange-400 text-sm font-medium mb-1">
              <Bomb className="w-4 h-4" />
              무장 드론 확인
            </div>
            <p className="text-xs text-orange-300/80">
              무장 드론으로 식별되었습니다. 주의가 필요합니다.
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
