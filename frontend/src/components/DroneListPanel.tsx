/**
 * 드론 리스트 패널
 * 
 * 탐지된 드론 목록을 위협도 순으로 정렬 표시
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Target, Eye, Shield, Radio } from 'lucide-react';
import { DroneTrack, ThreatLevel, EngagementState } from '../types';

interface DroneListPanelProps {
  drones: DroneTrack[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// 위협 레벨별 스타일
const THREAT_STYLES: Record<ThreatLevel, { bg: string; border: string; text: string; icon: string }> = {
  CRITICAL: { bg: 'bg-red-500/10', border: 'border-red-500/50', text: 'text-red-400', icon: 'text-red-500' },
  DANGER: { bg: 'bg-orange-500/10', border: 'border-orange-500/50', text: 'text-orange-400', icon: 'text-orange-500' },
  CAUTION: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/50', text: 'text-yellow-400', icon: 'text-yellow-500' },
  INFO: { bg: 'bg-blue-500/10', border: 'border-blue-500/50', text: 'text-blue-400', icon: 'text-blue-500' },
};

// 교전 상태 아이콘
const ENGAGEMENT_ICONS: Record<EngagementState, React.ReactNode> = {
  IGNORE: <Shield className="w-3.5 h-3.5 text-slate-500" />,
  TRACK: <Eye className="w-3.5 h-3.5 text-yellow-400" />,
  ENGAGE_PREP: <Target className="w-3.5 h-3.5 text-orange-400" />,
  ENGAGE: <Radio className="w-3.5 h-3.5 text-red-400 animate-pulse" />,
};

export default function DroneListPanel({ drones, selectedId, onSelect }: DroneListPanelProps) {
  // 위협도 순 정렬
  const sortedDrones = useMemo(() => {
    const levelPriority: Record<ThreatLevel, number> = {
      CRITICAL: 4,
      DANGER: 3,
      CAUTION: 2,
      INFO: 1,
    };
    
    return [...drones].sort((a, b) => {
      const priorityDiff = levelPriority[b.threat.level] - levelPriority[a.threat.level];
      if (priorityDiff !== 0) return priorityDiff;
      return b.threat.totalScore - a.threat.totalScore;
    });
  }, [drones]);

  if (drones.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        탐지된 드론 없음
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <AnimatePresence>
        {sortedDrones.map((drone) => {
          const styles = THREAT_STYLES[drone.threat.level];
          const isSelected = drone.id === selectedId;
          const distance = Math.sqrt(
            drone.position.x ** 2 + drone.position.y ** 2
          ).toFixed(0);
          const bearing = ((Math.atan2(drone.position.x, drone.position.y) * 180) / Math.PI + 360) % 360;

          return (
            <motion.div
              key={drone.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              onClick={() => onSelect(drone.id)}
              className={`p-3 cursor-pointer border-b border-slate-700/50 transition-all
                         ${isSelected ? `${styles.bg} ${styles.border} border-l-2` : 'hover:bg-slate-800/50'}`}
            >
              <div className="flex items-start gap-3">
                {/* 위협 아이콘 */}
                <div className={`p-1.5 rounded ${styles.bg}`}>
                  <AlertTriangle className={`w-5 h-5 ${styles.icon}`} />
                </div>

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-slate-200">
                      {drone.id}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${styles.bg} ${styles.text}`}>
                      {drone.threat.level}
                    </span>
                    {ENGAGEMENT_ICONS[drone.engagementState]}
                  </div>

                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    <span>거리: {distance}m</span>
                    <span>방위: {bearing.toFixed(0)}°</span>
                    <span>고도: {drone.position.altitude.toFixed(0)}m</span>
                  </div>

                  {/* 위협 점수 바 */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-500">위협도</span>
                      <span className={styles.text}>{drone.threat.totalScore.toFixed(0)}/100</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${
                          drone.threat.level === 'CRITICAL' ? 'bg-red-500' :
                          drone.threat.level === 'DANGER' ? 'bg-orange-500' :
                          drone.threat.level === 'CAUTION' ? 'bg-yellow-500' :
                          'bg-blue-500'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${drone.threat.totalScore}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>

                  {/* 센서 소스 */}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      drone.sensorSource === 'RADAR' ? 'bg-emerald-500/20 text-emerald-400' :
                      drone.sensorSource === 'AUDIO' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-slate-600/50 text-slate-400'
                    }`}>
                      {drone.sensorSource}
                    </span>
                    <span className="text-xs text-slate-500">
                      신뢰도: {(drone.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
