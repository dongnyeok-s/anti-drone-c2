/**
 * 맵 뷰 컴포넌트
 * 
 * 드론 및 요격기 위치를 레이더 스타일로 표시
 * 레이더 스캔 라인은 지도 중심을 기준으로 회전
 */

import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DroneTrack, Interceptor, ThreatLevel } from '../types';

interface MapViewProps {
  drones: DroneTrack[];
  interceptors: Interceptor[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mapSize: number;
  scanRate?: number;  // 초당 회전수 (기본값: 1)
}

// 위협 레벨별 색상
const THREAT_COLORS: Record<ThreatLevel, { ring: string; fill: string; glow: string }> = {
  CRITICAL: { ring: '#ef4444', fill: '#dc2626', glow: 'rgba(239, 68, 68, 0.6)' },
  DANGER: { ring: '#f97316', fill: '#ea580c', glow: 'rgba(249, 115, 22, 0.5)' },
  CAUTION: { ring: '#eab308', fill: '#ca8a04', glow: 'rgba(234, 179, 8, 0.4)' },
  INFO: { ring: '#3b82f6', fill: '#2563eb', glow: 'rgba(59, 130, 246, 0.3)' },
};

// 드론 상태별 배지 색상
const STATE_BADGE_COLORS: Record<string, string> = {
  HOSTILE: '#ef4444',
  FRIENDLY: '#22c55e',
  UNKNOWN: '#6b7280',
  CIVILIAN: '#3b82f6',
};

/**
 * 레이더 스캔 라인 컴포넌트
 * 중심을 기준으로 정확하게 회전
 */
function RadarSweepLine({ 
  centerX, 
  centerY, 
  radius, 
  scanRate = 1 
}: { 
  centerX: number; 
  centerY: number; 
  radius: number; 
  scanRate: number;
}) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    let lastTime = performance.now();
    let animationId: number;

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000; // 초 단위
      lastTime = currentTime;

      // angle = (angle + 360 * deltaTime * scan_rate) % 360
      setAngle(prev => (prev + 360 * deltaTime * scanRate) % 360);
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [scanRate]);

  // 각도를 라디안으로 변환 (북쪽 = 0도, 시계방향)
  // SVG에서 Y축이 아래로 증가하므로 조정 필요
  const angleRad = (angle - 90) * (Math.PI / 180);
  
  // 끝점 계산: x2 = centerX + radius * cos(angleRad), y2 = centerY + radius * sin(angleRad)
  const x2 = centerX + radius * Math.cos(angleRad);
  const y2 = centerY + radius * Math.sin(angleRad);

  return (
    <g>
      {/* 스캔 라인 */}
      <line
        x1={centerX}
        y1={centerY}
        x2={x2}
        y2={y2}
        stroke="rgba(16, 185, 129, 0.6)"
        strokeWidth="2"
      />
      {/* 스캔 잔상 (페이드 효과) */}
      {[10, 20, 30].map((offset, i) => {
        const fadeAngleRad = ((angle - 90 - offset) * Math.PI) / 180;
        const fadeX2 = centerX + radius * Math.cos(fadeAngleRad);
        const fadeY2 = centerY + radius * Math.sin(fadeAngleRad);
        return (
          <line
            key={i}
            x1={centerX}
            y1={centerY}
            x2={fadeX2}
            y2={fadeY2}
            stroke={`rgba(16, 185, 129, ${0.3 - i * 0.08})`}
            strokeWidth="1"
          />
        );
      })}
    </g>
  );
}

export default function MapView({ 
  drones, 
  interceptors, 
  selectedId, 
  onSelect, 
  mapSize,
  scanRate = 1,
}: MapViewProps) {
  const viewSize = 700;
  const center = viewSize / 2;
  const scale = viewSize / mapSize;
  const radarRadius = center - 20;

  // 동심원 (거리 링)
  const distanceRings = useMemo(() => {
    const rings = [100, 200, 300, 400, 500];
    return rings.map((r) => ({
      radius: r * scale,
      label: `${r}m`,
    }));
  }, [scale]);

  // 좌표 변환
  const toScreen = (x: number, y: number) => ({
    sx: center + x * scale,
    sy: center - y * scale, // Y축 반전
  });

  return (
    <div className="flex-1 bg-slate-950 relative overflow-hidden">
      <svg width="100%" height="100%" viewBox={`0 0 ${viewSize} ${viewSize}`} className="absolute inset-0">
        {/* 배경 그라데이션 */}
        <defs>
          <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(16, 185, 129, 0.08)" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
          </radialGradient>
          
          {/* 드론 마커 그라데이션 */}
          {Object.entries(THREAT_COLORS).map(([level, colors]) => (
            <radialGradient key={level} id={`glow-${level}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={colors.fill} />
              <stop offset="100%" stopColor={colors.glow} />
            </radialGradient>
          ))}
        </defs>

        {/* 레이더 배경 */}
        <circle cx={center} cy={center} r={radarRadius} fill="url(#radarGradient)" />

        {/* 레이더 외곽 원 */}
        <circle
          cx={center}
          cy={center}
          r={radarRadius}
          fill="none"
          stroke="rgba(16, 185, 129, 0.3)"
          strokeWidth="2"
        />

        {/* 그리드 라인 */}
        <g stroke="rgba(148, 163, 184, 0.1)" strokeWidth="1">
          {/* 수직선 */}
          {[-2, -1, 0, 1, 2].map((i) => (
            <line
              key={`v${i}`}
              x1={center + i * 100 * scale}
              y1={20}
              x2={center + i * 100 * scale}
              y2={viewSize - 20}
            />
          ))}
          {/* 수평선 */}
          {[-2, -1, 0, 1, 2].map((i) => (
            <line
              key={`h${i}`}
              x1={20}
              y1={center + i * 100 * scale}
              x2={viewSize - 20}
              y2={center + i * 100 * scale}
            />
          ))}
        </g>

        {/* 방위선 (십자) */}
        <g stroke="rgba(16, 185, 129, 0.15)" strokeWidth="1">
          <line x1={center} y1={20} x2={center} y2={viewSize - 20} />
          <line x1={20} y1={center} x2={viewSize - 20} y2={center} />
        </g>

        {/* 거리 링 */}
        {distanceRings.map(({ radius, label }) => (
          <g key={label}>
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="rgba(16, 185, 129, 0.2)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text
              x={center + radius + 5}
              y={center - 5}
              fill="rgba(16, 185, 129, 0.5)"
              fontSize="10"
            >
              {label}
            </text>
          </g>
        ))}

        {/* 방위 표시 */}
        <text x={center} y={15} textAnchor="middle" fill="rgba(148, 163, 184, 0.7)" fontSize="12" fontWeight="bold">N</text>
        <text x={viewSize - 15} y={center + 4} textAnchor="middle" fill="rgba(148, 163, 184, 0.5)" fontSize="11">E</text>
        <text x={center} y={viewSize - 8} textAnchor="middle" fill="rgba(148, 163, 184, 0.5)" fontSize="11">S</text>
        <text x={15} y={center + 4} textAnchor="middle" fill="rgba(148, 163, 184, 0.5)" fontSize="11">W</text>

        {/* 기지 위치 (중앙) */}
        <g transform={`translate(${center}, ${center})`}>
          <circle r="12" fill="rgba(16, 185, 129, 0.3)" />
          <circle r="6" fill="#10b981" />
          <text y="25" textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="bold">
            기지
          </text>
        </g>

        {/* 요격기 */}
        <AnimatePresence>
          {interceptors.map((int) => {
            const { sx, sy } = toScreen(int.position.x, int.position.y);
            const isActive = int.state === 'PURSUING' || int.state === 'ENGAGING';
            
            return (
              <motion.g
                key={int.id}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
              >
                <g transform={`translate(${sx}, ${sy})`}>
                  {/* 요격기 마커 (삼각형) */}
                  <polygon
                    points="0,-8 7,6 -7,6"
                    fill={isActive ? '#a855f7' : '#6b7280'}
                    stroke={isActive ? '#c084fc' : '#9ca3af'}
                    strokeWidth="2"
                  />
                  
                  {/* 상태 표시 */}
                  {isActive && (
                    <circle
                      r="15"
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                      className="animate-spin"
                      style={{ animationDuration: '2s' }}
                    />
                  )}
                  
                  {/* ID 레이블 */}
                  <text y="20" textAnchor="middle" fill="#c084fc" fontSize="9">
                    {int.id}
                  </text>
                </g>
                
                {/* 타겟 연결선 */}
                {int.targetId && isActive && (() => {
                  const target = drones.find(d => d.id === int.targetId);
                  if (!target) return null;
                  const { sx: tx, sy: ty } = toScreen(target.position.x, target.position.y);
                  return (
                    <line
                      x1={sx} y1={sy}
                      x2={tx} y2={ty}
                      stroke="#a855f7"
                      strokeWidth="1"
                      strokeDasharray="5 3"
                      opacity="0.6"
                    />
                  );
                })()}
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* 드론 트랙 */}
        <AnimatePresence>
          {drones.map((drone) => {
            const { sx, sy } = toScreen(drone.position.x, drone.position.y);
            const colors = THREAT_COLORS[drone.threat.level];
            const isSelected = drone.id === selectedId;
            const isEvading = drone.behaviorPattern === 'EVADE';

            return (
              <motion.g
                key={drone.id}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(drone.id)}
              >
                {/* 궤적 */}
                {drone.history.length > 1 && (
                  <path
                    d={drone.history
                      .map((p, i) => {
                        const { sx: px, sy: py } = toScreen(p.x, p.y);
                        return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
                      })
                      .join(' ')}
                    fill="none"
                    stroke={colors.ring}
                    strokeWidth="1.5"
                    strokeOpacity="0.4"
                    strokeDasharray="3 2"
                  />
                )}

                {/* 드론 마커 */}
                <g transform={`translate(${sx}, ${sy})`}>
                  {/* 선택 표시 */}
                  {isSelected && (
                    <motion.circle
                      r="25"
                      fill="none"
                      stroke={colors.ring}
                      strokeWidth="2"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}

                  {/* 위협 글로우 */}
                  <circle
                    r="18"
                    fill={`url(#glow-${drone.threat.level})`}
                    opacity="0.5"
                  />

                  {/* 드론 아이콘 */}
                  <circle
                    r="8"
                    fill={colors.fill}
                    stroke={colors.ring}
                    strokeWidth="2"
                  />

                  {/* 상태 배지 */}
                  <circle
                    cx="10" cy="-10"
                    r="5"
                    fill={STATE_BADGE_COLORS[drone.droneState] || '#6b7280'}
                    stroke="#1e293b"
                    strokeWidth="1"
                  />

                  {/* 회피 표시 */}
                  {isEvading && (
                    <motion.text
                      x="0" y="-20"
                      textAnchor="middle"
                      fill="#f59e0b"
                      fontSize="9"
                      fontWeight="bold"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      EVADE
                    </motion.text>
                  )}

                  {/* 교전 표시 */}
                  {drone.engagementState === 'ENGAGE' && !isEvading && (
                    <motion.text
                      x="0" y="-20"
                      textAnchor="middle"
                      fill="#ef4444"
                      fontSize="9"
                      fontWeight="bold"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      ENGAGE
                    </motion.text>
                  )}

                  {/* 드론 ID */}
                  <text
                    y="22"
                    textAnchor="middle"
                    fill={colors.ring}
                    fontSize="9"
                    fontWeight="bold"
                  >
                    {drone.id.split('-')[1] || drone.id}
                  </text>

                  {/* 신뢰도 바 */}
                  <rect x="-12" y="26" width="24" height="3" fill="rgba(255,255,255,0.1)" rx="1" />
                  <rect
                    x="-12" y="26"
                    width={24 * drone.confidence}
                    height="3"
                    fill={colors.ring}
                    opacity="0.8"
                    rx="1"
                  />
                </g>
              </motion.g>
            );
          })}
        </AnimatePresence>

        {/* 레이더 스캔 라인 - 정확한 중심 회전 */}
        <RadarSweepLine
          centerX={center}
          centerY={center}
          radius={radarRadius}
          scanRate={scanRate}
        />
      </svg>

      {/* 범례 */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm rounded-lg p-3 border border-slate-700">
        <p className="text-xs text-slate-400 mb-2">위협 등급</p>
        <div className="flex flex-col gap-1.5">
          {Object.entries(THREAT_COLORS).map(([level, colors]) => (
            <div key={level} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: colors.fill }}
              />
              <span className="text-xs text-slate-300">{level}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 스캔 정보 */}
      <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700">
        <p className="text-xs text-emerald-400">
          스캔 속도: {scanRate.toFixed(1)} Hz
        </p>
      </div>
    </div>
  );
}
