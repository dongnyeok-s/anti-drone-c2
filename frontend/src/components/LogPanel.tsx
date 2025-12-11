/**
 * 로그 패널
 * 
 * 시스템/탐지/교전 이벤트 실시간 로그 표시
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, AlertTriangle, Crosshair, Info, Volume2 } from 'lucide-react';
import { LogEntry } from '../types';
import { formatTime } from '../utils';

interface LogPanelProps {
  logs: LogEntry[];
}

// 로그 타입별 스타일
const LOG_STYLES: Record<LogEntry['type'], { icon: React.ReactNode; color: string; bg: string }> = {
  SYSTEM: { 
    icon: <Info className="w-3.5 h-3.5" />, 
    color: 'text-slate-400', 
    bg: 'bg-slate-500/10' 
  },
  DETECTION: { 
    icon: <Radio className="w-3.5 h-3.5" />, 
    color: 'text-emerald-400', 
    bg: 'bg-emerald-500/10' 
  },
  THREAT: { 
    icon: <AlertTriangle className="w-3.5 h-3.5" />, 
    color: 'text-amber-400', 
    bg: 'bg-amber-500/10' 
  },
  ENGAGEMENT: { 
    icon: <Crosshair className="w-3.5 h-3.5" />, 
    color: 'text-red-400', 
    bg: 'bg-red-500/10' 
  },
  AUDIO: { 
    icon: <Volume2 className="w-3.5 h-3.5" />, 
    color: 'text-purple-400', 
    bg: 'bg-purple-500/10' 
  },
};

export default function LogPanel({ logs }: LogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 자동 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="h-full flex flex-col bg-slate-900/50">
      {/* 헤더 */}
      <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700/50 flex items-center justify-between">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">이벤트 로그</h3>
        <span className="text-xs text-slate-500">{logs.length}건</span>
      </div>

      {/* 로그 목록 */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1"
      >
        <AnimatePresence initial={false}>
          {logs.map((log, index) => {
            const style = LOG_STYLES[log.type] || LOG_STYLES.SYSTEM;
            
            return (
              <motion.div
                key={`${log.time}-${index}`}
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="py-1"
              >
                <div className={`flex items-start gap-2 px-2 py-1.5 rounded ${style.bg}`}>
                  {/* 아이콘 */}
                  <span className={`mt-0.5 ${style.color}`}>
                    {style.icon}
                  </span>
                  
                  {/* 시간 */}
                  <span className="text-xs text-slate-500 font-mono min-w-[52px]">
                    {formatTime(log.time)}
                  </span>
                  
                  {/* 메시지 */}
                  <span className={`text-xs ${style.color} flex-1`}>
                    {log.message}
                  </span>
                  
                  {/* 드론 ID */}
                  {log.droneId && (
                    <span className="text-xs text-slate-500 font-mono">
                      [{log.droneId}]
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {logs.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs text-slate-500">
            이벤트 대기 중...
          </div>
        )}
      </div>
    </div>
  );
}
