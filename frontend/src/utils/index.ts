/**
 * 유틸리티 함수
 */

import { ThreatLevel, DroneState, EngagementState, BehaviorPattern, PayloadType } from '../types';

// 위협 레벨 색상
export const THREAT_LEVEL_COLORS: Record<ThreatLevel, string> = {
  INFO: '#6b7280',      // 회색
  CAUTION: '#f59e0b',   // 주황
  DANGER: '#f97316',    // 진한 주황
  CRITICAL: '#ef4444',  // 빨강
};

// 드론 상태 색상
export const DRONE_STATE_COLORS: Record<DroneState, string> = {
  UNKNOWN: '#9ca3af',   // 회색
  FRIENDLY: '#22c55e',  // 녹색
  HOSTILE: '#ef4444',   // 빨강
  CIVILIAN: '#3b82f6',  // 파랑
};

// 위협 레벨 한글
export const THREAT_LEVEL_LABELS: Record<ThreatLevel, string> = {
  INFO: '정보',
  CAUTION: '주의',
  DANGER: '위험',
  CRITICAL: '긴급',
};

// 드론 상태 한글
export const DRONE_STATE_LABELS: Record<DroneState, string> = {
  UNKNOWN: '미상',
  FRIENDLY: '우군',
  HOSTILE: '적',
  CIVILIAN: '민간',
};

// 교전 상태 한글
export const ENGAGEMENT_STATE_LABELS: Record<EngagementState, string> = {
  IGNORE: '무시',
  TRACK: '추적',
  ENGAGE_PREP: '요격준비',
  ENGAGE: '요격',
};

// 행동 패턴 한글
export const BEHAVIOR_PATTERN_LABELS: Record<BehaviorPattern, string> = {
  LINEAR: '직선이동',
  CIRCLING: '선회',
  HOVERING: '정지비행',
  APPROACHING: '접근중',
  RETREATING: '이탈중',
  ERRATIC: '불규칙',
  NORMAL: '일반',
  RECON: '정찰',
  ATTACK_RUN: '공격',
  EVADE: '회피',
};

// 탑재체 유형 한글
export const PAYLOAD_TYPE_LABELS: Record<PayloadType, string> = {
  UNKNOWN: '불명',
  NONE: '없음',
  CAMERA: '카메라',
  BOMB: '폭발물',
  ROCKET: '로켓',
  CHEMICAL: '화학물질',
};

/**
 * 시간 포맷 (초 → MM:SS)
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 거리 포맷
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(2)}km`;
}

/**
 * 속도 포맷 (m/s)
 */
export function formatSpeed(mps: number): string {
  return `${mps.toFixed(1)}m/s`;
}

/**
 * ETA 포맷
 */
export function formatETA(seconds: number | null): string {
  if (seconds === null) return '-';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}분 ${secs}초`;
}

/**
 * 점수 포맷 (0~1 → 퍼센트)
 */
export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * 좌표를 SVG 좌표로 변환
 * 맵 중앙이 (0,0), y축이 위로 증가
 */
export function toSvgCoords(
  x: number,
  y: number,
  mapSize: number,
  svgSize: number
): { svgX: number; svgY: number } {
  const scale = svgSize / mapSize;
  return {
    svgX: svgSize / 2 + x * scale,
    svgY: svgSize / 2 - y * scale, // y축 반전
  };
}
