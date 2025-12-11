/**
 * 위협 점수 계산 테스트
 */

import { computeThreatScore, DEFAULT_THREAT_SCORE_CONFIG } from '../core/fusion/threatScore';
import { FusedTrack, TrackPosition } from '../core/fusion/types';

describe('Threat Score Calculation', () => {
  const basePosition: TrackPosition = { x: 0, y: 0, altitude: 50 };
  const config = { ...DEFAULT_THREAT_SCORE_CONFIG, basePosition };

  // 공통 헬퍼 함수
  function createTestTrack(overrides: Partial<FusedTrack>): FusedTrack {
    return {
      id: 'TEST',
      droneId: null,
      position: { x: 0, y: 0, altitude: 50 },
      previousPosition: null,
      velocity: { vx: 0, vy: 0, climbRate: 0 },
      existenceProb: 0.5,
      lastUpdateTime: 0,
      createdTime: 0,
      sensors: {
        radarSeen: true,
        radarLastSeen: 0,
        audioHeard: false,
        audioLastSeen: 0,
        eoSeen: false,
        eoLastSeen: 0,
      },
      classificationInfo: {
        classification: 'UNKNOWN',
        confidence: 0.5,
        source: 'RADAR',
        armed: null,
        sizeClass: null,
        droneType: null,
      },
      threatScore: 0,
      threatLevel: 'INFO',
      positionHistory: [],
      quality: 0.5,
      missedUpdates: 0,
      isNeutralized: false,
      isEvading: false,
      ...overrides,
    };
  }

  it('기지 근처의 적대적 드론은 높은 위협 점수를 가져야 함', () => {
    const track = createTestTrack({
      position: { x: 50, y: 50, altitude: 50 },
      velocity: { vx: -10, vy: -10, climbRate: 0 },
      existenceProb: 0.9,
      classificationInfo: {
        classification: 'HOSTILE',
        confidence: 0.95,
        source: 'EO',
        armed: true,
        sizeClass: 'MEDIUM',
        droneType: null,
      },
      sensors: {
        radarSeen: true,
        radarLastSeen: 0,
        audioHeard: false,
        audioLastSeen: 0,
        eoSeen: true,
        eoLastSeen: 0,
      },
    });

    const score = computeThreatScore(track, config);
    
    expect(score).toBeGreaterThan(70);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('멀리 떨어진 드론은 낮은 위협 점수를 가져야 함', () => {
    const track = createTestTrack({
      position: { x: 800, y: 800, altitude: 100 },
      velocity: { vx: 0, vy: 0, climbRate: 0 },
      existenceProb: 0.5,
      classificationInfo: {
        classification: 'UNKNOWN',
        confidence: 0.3,
        source: 'RADAR',
        armed: null,
        sizeClass: null,
        droneType: null,
      },
    });

    const score = computeThreatScore(track, config);
    
    expect(score).toBeLessThan(50);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('빠르게 접근하는 드론은 높은 위협 점수를 가져야 함', () => {
    const track = createTestTrack({
      position: { x: 200, y: 200, altitude: 50 },
      velocity: { vx: -20, vy: -20, climbRate: 0 },
      existenceProb: 0.8,
      classificationInfo: {
        classification: 'HOSTILE',
        confidence: 0.8,
        source: 'FUSED',
        armed: null,
        sizeClass: 'SMALL',
        droneType: null,
      },
    });

    const score = computeThreatScore(track, config);
    
    expect(score).toBeGreaterThan(50);
  });

  it('회피 중인 드론은 위협 점수가 높아야 함', () => {
    const track = createTestTrack({
      position: { x: 150, y: 150, altitude: 60 },
      velocity: { vx: -15, vy: -15, climbRate: 5 },
      existenceProb: 0.85,
      classificationInfo: {
        classification: 'HOSTILE',
        confidence: 0.9,
        source: 'EO',
        armed: true,
        sizeClass: 'MEDIUM',
        droneType: null,
      },
      isEvading: true,
      sensors: {
        radarSeen: true,
        radarLastSeen: 0,
        audioHeard: false,
        audioLastSeen: 0,
        eoSeen: true,
        eoLastSeen: 0,
      },
    });

    const score = computeThreatScore(track, config);
    
    expect(score).toBeGreaterThan(60);
  });

  it('친화적 드론은 낮은 위협 점수를 가져야 함', () => {
    const track = createTestTrack({
      position: { x: 100, y: 100, altitude: 50 },
      velocity: { vx: 0, vy: 0, climbRate: 0 },
      existenceProb: 0.7,
      classificationInfo: {
        classification: 'FRIENDLY',
        confidence: 0.95,
        source: 'EO',
        armed: false,
        sizeClass: 'SMALL',
        droneType: null,
      },
      sensors: {
        radarSeen: true,
        radarLastSeen: 0,
        audioHeard: false,
        audioLastSeen: 0,
        eoSeen: true,
        eoLastSeen: 0,
      },
    });

    const score = computeThreatScore(track, config);
    
    expect(score).toBeLessThan(30);
  });

  it('위협 점수는 0~100 범위 내에 있어야 함', () => {
    const tracks = [
      createTestTrack({
        position: { x: 0, y: 0, altitude: 50 },
        velocity: { vx: 0, vy: 0, climbRate: 0 },
        existenceProb: 0.1,
        classificationInfo: {
          classification: 'UNKNOWN',
          confidence: 0.1,
          source: 'RADAR',
          armed: null,
          sizeClass: null,
          droneType: null,
        },
      }),
      createTestTrack({
        position: { x: 10, y: 10, altitude: 50 },
        velocity: { vx: -30, vy: -30, climbRate: 0 },
        existenceProb: 1.0,
        classificationInfo: {
          classification: 'HOSTILE',
          confidence: 1.0,
          source: 'EO',
          armed: true,
          sizeClass: 'LARGE',
          droneType: null,
        },
        isEvading: true,
        sensors: {
          radarSeen: true,
          radarLastSeen: 0,
          audioHeard: false,
          audioLastSeen: 0,
          eoSeen: true,
          eoLastSeen: 0,
        },
      }),
    ];

    tracks.forEach(track => {
      const score = computeThreatScore(track, config);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });
});
