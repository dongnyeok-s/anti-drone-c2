/**
 * 교전 의사결정 관리자
 * 
 * Threat 기반 교전 후보 선정/개시/중단 로직
 * 
 * 주요 기능:
 * 1. 교전 후보 평가 (evaluateEngagementCandidates)
 * 2. 교전 개시 결정 (decideEngagement)
 * 3. 교전 중단 확인 (checkAbortConditions)
 * 4. Baseline vs Fusion 모드 지원
 */

import {
  EngagementState,
  EngagementResult,
  AbortReason,
  TrackEngagementInfo,
  EngagementDecision,
  EngagementCandidate,
  EngageStartLogEvent,
  EngageEndLogEvent,
} from './types';
import {
  EngagementConfig,
  EngagementMode,
  getEngagementConfig,
  FUSION_ENGAGEMENT_CONFIG,
} from './config';
import { FusedTrack } from '../fusion/types';
import { determineBehavior } from '../fusion/threatScore';
import { loadRuntimeParams } from '../../config/runtimeParams';

// ============================================
// 교전 관리자 클래스
// ============================================

export class EngagementManager {
  private config: EngagementConfig;
  private engagementInfos: Map<string, TrackEngagementInfo> = new Map();
  private lastEvaluationTime: number = 0;
  private activeEngagements: number = 0;

  constructor(config?: Partial<EngagementConfig>) {
    this.config = {
      ...FUSION_ENGAGEMENT_CONFIG,
      ...config,
    };
    
    // 런타임 파라미터 적용
    this.applyRuntimeParams();
  }
  
  /**
   * 런타임 파라미터 적용
   */
  private applyRuntimeParams(): void {
    const params = loadRuntimeParams();
    if (!params) return;
    
    if (params.threat_engage_threshold !== undefined) {
      this.config.THREAT_ENGAGE_THRESHOLD = params.threat_engage_threshold;
    }
    if (params.threat_abort_threshold !== undefined) {
      this.config.THREAT_ABORT_THRESHOLD = params.threat_abort_threshold;
    }
    if (params.civil_conf_threshold !== undefined) {
      this.config.CIVIL_EXCLUDE_CONFIDENCE = params.civil_conf_threshold;
    }
  }

  /**
   * 모드 변경
   */
  setMode(mode: EngagementMode): void {
    const newConfig = getEngagementConfig(mode);
    this.config = { ...newConfig };
    console.log(`[EngagementManager] 모드 변경: ${mode}`);
  }

  /**
   * 현재 모드 반환
   */
  getMode(): EngagementMode {
    return this.config.mode;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(overrides: Partial<EngagementConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  /**
   * 트랙의 교전 정보 가져오기 (없으면 생성)
   */
  getOrCreateEngagementInfo(trackId: string): TrackEngagementInfo {
    let info = this.engagementInfos.get(trackId);
    if (!info) {
      info = this.createInitialEngagementInfo(trackId);
      this.engagementInfos.set(trackId, info);
    }
    return info;
  }

  /**
   * 초기 교전 정보 생성
   */
  private createInitialEngagementInfo(trackId: string): TrackEngagementInfo {
    return {
      trackId,
      state: 'IDLE',
      lastDecisionTime: null,
      engageStartTime: null,
      assignedInterceptorId: null,
      engageReason: '',
      abortReason: null,
      result: 'PENDING',
      firstDetectTime: null,
      threatThresholdReachedTime: null,
      threatScoreAtEngage: 0,
      existenceProbAtEngage: 0,
      distanceAtEngage: 0,
    };
  }

  /**
   * 교전 후보 평가 (매 tick 호출)
   */
  evaluateEngagementCandidates(
    tracks: FusedTrack[],
    currentTime: number,
    basePosition: { x: number; y: number }
  ): EngagementDecision[] {
    // 평가 주기 확인
    if (currentTime - this.lastEvaluationTime < this.config.EVALUATION_INTERVAL) {
      return [];
    }
    this.lastEvaluationTime = currentTime;

    // 모드에 따른 평가
    if (this.config.mode === 'BASELINE') {
      return this.evaluateBaselineMode(tracks, currentTime, basePosition);
    } else {
      return this.evaluateFusionMode(tracks, currentTime, basePosition);
    }
  }

  /**
   * Baseline 모드 교전 평가 (거리 기반)
   */
  private evaluateBaselineMode(
    tracks: FusedTrack[],
    currentTime: number,
    basePosition: { x: number; y: number }
  ): EngagementDecision[] {
    const decisions: EngagementDecision[] = [];

    for (const track of tracks) {
      const info = this.getOrCreateEngagementInfo(track.id);
      const distance = this.calculateDistance(track, basePosition);

      // 이미 교전 중이거나 완료된 경우 스킵
      if (info.state === 'ENGAGING' || info.state === 'COMPLETED') {
        continue;
      }

      // 최소 결정 간격 확인
      if (info.lastDecisionTime !== null && 
          currentTime - info.lastDecisionTime < this.config.MIN_DECISION_INTERVAL) {
        continue;
      }

      // Baseline: 거리 기반 교전 결정
      if (distance <= this.config.BASELINE_ENGAGE_DISTANCE) {
        // 랜덤 확률 적용
        if (Math.random() < this.config.BASELINE_ENGAGE_PROBABILITY) {
          decisions.push({
            trackId: track.id,
            action: 'ENGAGE',
            reason: `거리 ${distance.toFixed(0)}m ≤ ${this.config.BASELINE_ENGAGE_DISTANCE}m (Baseline)`,
            priorityScore: 1000 - distance,
            threatScore: track.threatScore,
            existenceProb: track.existenceProb,
            distance,
            classification: track.classificationInfo.classification,
            classConfidence: track.classificationInfo.confidence,
            sensors: {
              radar: track.sensors.radarSeen,
              audio: track.sensors.audioHeard,
              eo: track.sensors.eoSeen,
            },
          });
        }
      }
    }

    // 우선순위 정렬 (거리 오름차순)
    decisions.sort((a, b) => a.distance - b.distance);

    // 동시 교전 수 제한
    return decisions.slice(0, Math.max(0, this.config.MAX_CONCURRENT_ENGAGEMENTS - this.activeEngagements));
  }

  /**
   * Fusion 모드 교전 평가 (Threat 기반)
   */
  private evaluateFusionMode(
    tracks: FusedTrack[],
    currentTime: number,
    basePosition: { x: number; y: number }
  ): EngagementDecision[] {
    const candidates: EngagementCandidate[] = [];

    for (const track of tracks) {
      const info = this.getOrCreateEngagementInfo(track.id);
      const distance = this.calculateDistance(track, basePosition);

      // 첫 탐지 시간 기록
      if (info.firstDetectTime === null) {
        info.firstDetectTime = currentTime;
      }

      // 위협도 임계값 도달 시간 기록
      if (info.threatThresholdReachedTime === null && 
          track.threatScore >= this.config.THREAT_ENGAGE_THRESHOLD) {
        info.threatThresholdReachedTime = currentTime;
      }

      // 이미 교전 중이거나 완료된 경우 스킵
      if (info.state === 'ENGAGING' || info.state === 'COMPLETED') {
        continue;
      }

      // 최소 결정 간격 확인
      if (info.lastDecisionTime !== null && 
          currentTime - info.lastDecisionTime < this.config.MIN_DECISION_INTERVAL) {
        continue;
      }

      // 교전 후보 필터링
      if (!this.isEligibleForEngagement(track, distance)) {
        continue;
      }

      // 후보 추가
      const behavior = determineBehavior(track, { 
        x: basePosition.x, 
        y: basePosition.y, 
        altitude: 50 
      });

      candidates.push({
        trackId: track.id,
        droneId: track.droneId,
        threatScore: track.threatScore,
        existenceProb: track.existenceProb,
        distance,
        classification: track.classificationInfo.classification,
        classConfidence: track.classificationInfo.confidence,
        isApproaching: behavior === 'APPROACHING',
        sensors: {
          radar: track.sensors.radarSeen,
          audio: track.sensors.audioHeard,
          eo: track.sensors.eoSeen,
        },
        currentState: info.state,
      });
    }

    // 우선순위 정렬
    candidates.sort((a, b) => {
      // 1. 위협 점수 내림차순
      if (b.threatScore !== a.threatScore) {
        return b.threatScore - a.threatScore;
      }
      // 2. 거리 오름차순
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      // 3. 접근 중인 목표 우선
      if (a.isApproaching !== b.isApproaching) {
        return a.isApproaching ? -1 : 1;
      }
      return 0;
    });

    // 교전 결정 생성
    const decisions: EngagementDecision[] = [];
    const availableSlots = Math.max(0, this.config.MAX_CONCURRENT_ENGAGEMENTS - this.activeEngagements);

    for (let i = 0; i < Math.min(candidates.length, availableSlots); i++) {
      const candidate = candidates[i];
      decisions.push({
        trackId: candidate.trackId,
        action: 'ENGAGE',
        reason: this.generateEngageReason(candidate),
        priorityScore: candidate.threatScore + (1000 - candidate.distance) / 10,
        threatScore: candidate.threatScore,
        existenceProb: candidate.existenceProb,
        distance: candidate.distance,
        classification: candidate.classification,
        classConfidence: candidate.classConfidence,
        sensors: candidate.sensors,
      });
    }

    return decisions;
  }

  /**
   * 교전 자격 확인
   */
  private isEligibleForEngagement(track: FusedTrack, distance: number): boolean {
    // 존재 확률 확인
    if (track.existenceProb < this.config.EXIST_PROB_THRESHOLD) {
      return false;
    }

    // 위협 점수 확인
    if (track.threatScore < this.config.THREAT_ENGAGE_THRESHOLD) {
      return false;
    }

    // 거리 확인
    if (distance > this.config.MAX_ENGAGE_RANGE) {
      return false;
    }

    // 민간 드론 제외
    if (track.classificationInfo.classification === 'CIVIL' &&
        track.classificationInfo.confidence >= this.config.CIVIL_EXCLUDE_CONFIDENCE) {
      return false;
    }

    // 아군 드론 제외
    if (track.classificationInfo.classification === 'FRIENDLY') {
      return false;
    }

    return true;
  }

  /**
   * 교전 사유 생성
   */
  private generateEngageReason(candidate: EngagementCandidate): string {
    const sensorList: string[] = [];
    if (candidate.sensors.radar) sensorList.push('RADAR');
    if (candidate.sensors.audio) sensorList.push('AUDIO');
    if (candidate.sensors.eo) sensorList.push('EO');

    return `threat=${candidate.threatScore}, dist=${candidate.distance.toFixed(0)}m, ` +
           `existProb=${candidate.existenceProb.toFixed(2)}, ` +
           `class=${candidate.classification}(${(candidate.classConfidence * 100).toFixed(0)}%), ` +
           `sensors=${sensorList.join('+')}`;
  }

  /**
   * 교전 개시 처리
   */
  startEngagement(
    trackId: string,
    interceptorId: string,
    decision: EngagementDecision,
    currentTime: number
  ): TrackEngagementInfo {
    const info = this.getOrCreateEngagementInfo(trackId);
    
    info.state = 'ENGAGING';
    info.lastDecisionTime = currentTime;
    info.engageStartTime = currentTime;
    info.assignedInterceptorId = interceptorId;
    info.engageReason = decision.reason;
    info.threatScoreAtEngage = decision.threatScore;
    info.existenceProbAtEngage = decision.existenceProb;
    info.distanceAtEngage = decision.distance;
    info.result = 'PENDING';

    this.activeEngagements++;
    this.engagementInfos.set(trackId, info);

    return info;
  }

  /**
   * 교전 중단 조건 확인
   */
  checkAbortConditions(
    trackId: string,
    track: FusedTrack | null,
    basePosition: { x: number; y: number }
  ): AbortReason | null {
    const info = this.engagementInfos.get(trackId);
    if (!info || info.state !== 'ENGAGING') {
      return null;
    }

    // Baseline 모드에서는 중단 조건 미적용
    if (this.config.mode === 'BASELINE') {
      return null;
    }

    // 표적 소실
    if (!track) {
      return 'TARGET_LOST';
    }

    // 존재 확률 저하
    if (track.existenceProb < this.config.EXIST_PROB_ABORT_THRESHOLD) {
      return 'LOW_EXISTENCE_PROB';
    }

    // 위협 점수 저하
    if (track.threatScore < this.config.THREAT_ABORT_THRESHOLD) {
      return 'LOW_THREAT_SCORE';
    }

    // 민간 드론으로 분류
    if (track.classificationInfo.classification === 'CIVIL' &&
        track.classificationInfo.confidence >= this.config.CIVIL_EXCLUDE_CONFIDENCE) {
      return 'CLASSIFIED_CIVIL';
    }

    // 범위 이탈
    const distance = this.calculateDistance(track, basePosition);
    if (distance > this.config.MAX_ENGAGE_RANGE * 1.5) {  // 150% 초과 시 중단
      return 'OUT_OF_RANGE';
    }

    return null;
  }

  /**
   * 교전 중단 처리
   */
  abortEngagement(trackId: string, reason: AbortReason, currentTime: number): TrackEngagementInfo | null {
    const info = this.engagementInfos.get(trackId);
    if (!info) return null;

    info.state = 'ABORTED';
    info.abortReason = reason;
    info.result = 'ABORTED';

    if (info.assignedInterceptorId) {
      this.activeEngagements = Math.max(0, this.activeEngagements - 1);
    }

    this.engagementInfos.set(trackId, info);
    return info;
  }

  /**
   * 교전 완료 처리
   */
  completeEngagement(
    trackId: string,
    success: boolean,
    currentTime: number
  ): TrackEngagementInfo | null {
    const info = this.engagementInfos.get(trackId);
    if (!info) return null;

    info.state = 'COMPLETED';
    info.result = success ? 'SUCCESS' : 'FAIL';

    this.activeEngagements = Math.max(0, this.activeEngagements - 1);
    this.engagementInfos.set(trackId, info);

    return info;
  }

  /**
   * 거리 계산
   */
  private calculateDistance(
    track: FusedTrack,
    basePosition: { x: number; y: number }
  ): number {
    const dx = track.position.x - basePosition.x;
    const dy = track.position.y - basePosition.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 교전 개시 로그 이벤트 생성
   */
  createEngageStartLog(
    info: TrackEngagementInfo,
    decision: EngagementDecision,
    droneId: string | null,
    currentTime: number
  ): EngageStartLogEvent {
    return {
      timestamp: currentTime,
      event: 'engage_start',
      track_id: info.trackId,
      drone_id: droneId,
      mode: this.config.mode,
      threat_score: decision.threatScore,
      existence_prob: decision.existenceProb,
      distance_to_base: decision.distance,
      classification: decision.classification,
      class_confidence: decision.classConfidence,
      engage_reason: decision.reason,
      sensors: decision.sensors,
      interceptor_id: info.assignedInterceptorId || '',
    };
  }

  /**
   * 교전 종료 로그 이벤트 생성
   */
  createEngageEndLog(
    info: TrackEngagementInfo,
    droneId: string | null,
    currentTime: number
  ): EngageEndLogEvent {
    const timeToEngage = info.engageStartTime !== null && info.firstDetectTime !== null
      ? info.engageStartTime - info.firstDetectTime
      : null;
    
    const timeFromThreat70 = info.engageStartTime !== null && info.threatThresholdReachedTime !== null
      ? info.engageStartTime - info.threatThresholdReachedTime
      : null;

    const engagementDuration = info.engageStartTime !== null
      ? currentTime - info.engageStartTime
      : null;

    return {
      timestamp: currentTime,
      event: 'engage_end',
      track_id: info.trackId,
      drone_id: droneId,
      mode: this.config.mode,
      result: info.result,
      abort_reason: info.abortReason,
      time_to_engage: timeToEngage,
      time_from_threat70: timeFromThreat70,
      engagement_duration: engagementDuration,
      interceptor_id: info.assignedInterceptorId,
    };
  }

  /**
   * 활성 교전 수 반환
   */
  getActiveEngagementCount(): number {
    return this.activeEngagements;
  }

  /**
   * 특정 트랙의 교전 정보 반환
   */
  getEngagementInfo(trackId: string): TrackEngagementInfo | undefined {
    return this.engagementInfos.get(trackId);
  }

  /**
   * 모든 교전 정보 반환
   */
  getAllEngagementInfos(): TrackEngagementInfo[] {
    return Array.from(this.engagementInfos.values());
  }

  /**
   * 리셋
   */
  reset(): void {
    this.engagementInfos.clear();
    this.lastEvaluationTime = 0;
    this.activeEngagements = 0;
  }

  /**
   * 설정 반환
   */
  getConfig(): EngagementConfig {
    return { ...this.config };
  }
}

// 싱글톤 인스턴스 (선택적)
let engagementManagerInstance: EngagementManager | null = null;

export function getEngagementManager(): EngagementManager {
  if (!engagementManagerInstance) {
    engagementManagerInstance = new EngagementManager();
  }
  return engagementManagerInstance;
}

export function resetEngagementManager(): void {
  if (engagementManagerInstance) {
    engagementManagerInstance.reset();
  }
  engagementManagerInstance = null;
}

