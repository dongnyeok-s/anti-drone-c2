/**
 * 컨트롤 패널
 * 
 * 시뮬레이션 속도 및 설정 제어
 */

import { motion } from 'framer-motion';
import { Gauge, Wifi, WifiOff, Settings, Crosshair, ArrowRight } from 'lucide-react';
import { GuidanceMode, GUIDANCE_MODE_INFO } from '../types';

interface ControlPanelProps {
  speedMultiplier: number;
  onSpeedChange: (speed: number) => void;
  isConnected: boolean;
  guidanceMode?: GuidanceMode;
  onGuidanceModeChange?: (mode: GuidanceMode) => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

export default function ControlPanel({ 
  speedMultiplier, 
  onSpeedChange, 
  isConnected,
  guidanceMode = 'PN',
  onGuidanceModeChange
}: ControlPanelProps) {
  return (
    <div className="p-4 space-y-4">
      {/* 속도 제어 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Gauge className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            시뮬레이션 속도
          </span>
        </div>
        <div className="flex gap-1.5">
          {SPEED_OPTIONS.map((speed) => (
            <motion.button
              key={speed}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onSpeedChange(speed)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-all
                         ${speedMultiplier === speed
                           ? 'bg-emerald-500/30 text-emerald-400 border border-emerald-500/50'
                           : 'bg-slate-700 text-slate-400 border border-slate-600 hover:bg-slate-600'
                         }`}
            >
              x{speed}
            </motion.button>
          ))}
        </div>
      </div>

      {/* 유도 모드 선택 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Crosshair className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            요격 유도 모드
          </span>
        </div>
        <div className="flex gap-1.5">
          {(['PN', 'PURE_PURSUIT'] as GuidanceMode[]).map((mode) => {
            const info = GUIDANCE_MODE_INFO[mode];
            const isActive = guidanceMode === mode;
            return (
              <motion.button
                key={mode}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onGuidanceModeChange?.(mode)}
                className={`flex-1 py-2 px-2 rounded text-xs font-medium transition-all flex flex-col items-center gap-1
                           ${isActive
                             ? mode === 'PN' 
                               ? 'bg-cyan-500/30 text-cyan-400 border border-cyan-500/50'
                               : 'bg-amber-500/30 text-amber-400 border border-amber-500/50'
                             : 'bg-slate-700 text-slate-400 border border-slate-600 hover:bg-slate-600'
                           }`}
                title={info.description}
              >
                <span className="text-base">{info.icon}</span>
                <span>{info.name}</span>
              </motion.button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-1.5">
          {GUIDANCE_MODE_INFO[guidanceMode].description}
        </p>
      </div>

      {/* 연결 상태 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-slate-500" />
          )}
          <span className={`text-xs ${isConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
            {isConnected ? '시뮬레이터 연결됨' : '로컬 모드'}
          </span>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="p-1.5 rounded bg-slate-700 text-slate-400 hover:bg-slate-600"
        >
          <Settings className="w-4 h-4" />
        </motion.button>
      </div>

      {/* 키보드 단축키 안내 */}
      <div className="pt-2 border-t border-slate-700">
        <p className="text-xs text-slate-500 mb-2">단축키</p>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">Space</kbd>
            <span>시작/정지</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">R</kbd>
            <span>리셋</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">1-5</kbd>
            <span>속도 변경</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-300">Esc</kbd>
            <span>선택 해제</span>
          </div>
        </div>
      </div>
    </div>
  );
}
