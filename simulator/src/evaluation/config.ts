/**
 * 2차 성능 향상 평가용 실험 설정
 * 
 * 시나리오×모드 조합을 정의하고 자동으로 반복 실행할 수 있도록 구성
 */

export type EvaluationScenario = 'all_hostile' | 'mixed_civil' | 'civil_only';
export type EvaluationMode = 'BASELINE' | 'FUSION';
export type EvaluationProfile = 'fast' | 'full';

export interface ExperimentConfig {
  name: string;
  scenario: EvaluationScenario;
  mode: EvaluationMode;
  runs: number;  // 같은 조건으로 몇 번 반복할지
  duration: number;  // 시뮬레이션 실행 시간 (초)
  seed?: number;  // 시드 (없으면 자동 생성)
}

/**
 * 프로파일별 설정
 */
export interface ProfileConfig {
  scenarios: EvaluationScenario[];
  runsPerExperiment: number;
  duration: number;
  description: string;
}

/**
 * Fast 프로파일 설정
 * 목적: 빠른 튜닝 탐색용, 상대적인 좋/나쁨 판단
 */
export const FAST_PROFILE: ProfileConfig = {
  scenarios: ['all_hostile', 'mixed_civil'],
  runsPerExperiment: 3,  // 빠른 탐색을 위해 적은 runs
  duration: 120,
  description: '빠른 튜닝 탐색용 - 시나리오 일부 + 적은 runs',
};

/**
 * Full 프로파일 설정
 * 목적: 최종 보고서/논문용 정확한 성능 측정
 */
export const FULL_PROFILE: ProfileConfig = {
  scenarios: ['all_hostile', 'mixed_civil', 'civil_only'],
  runsPerExperiment: 20,  // 정확한 측정을 위한 충분한 runs
  duration: 120,
  description: '최종 평가용 - 모든 시나리오 + 충분한 runs',
};

/**
 * 프로파일별 실험 세트 생성
 */
export function getEvaluationExperiments(profile: EvaluationProfile = 'fast'): ExperimentConfig[] {
  const profileConfig = profile === 'fast' ? FAST_PROFILE : FULL_PROFILE;
  const experiments: ExperimentConfig[] = [];
  
  for (const scenario of profileConfig.scenarios) {
    // BASELINE 모드
    experiments.push({
      name: `${scenario}_baseline`,
      scenario: scenario,
      mode: 'BASELINE',
      runs: profileConfig.runsPerExperiment,
      duration: profileConfig.duration,
    });
    
    // FUSION 모드
    experiments.push({
      name: `${scenario}_fusion`,
      scenario: scenario,
      mode: 'FUSION',
      runs: profileConfig.runsPerExperiment,
      duration: profileConfig.duration,
    });
  }
  
  return experiments;
}

/**
 * 평가용 실험 세트 (기본값: fast 프로파일)
 * @deprecated getEvaluationExperiments()를 사용하세요
 */
export const EVALUATION_EXPERIMENTS: ExperimentConfig[] = getEvaluationExperiments('full');

/**
 * 시나리오별 true_label 분포 설정
 */
export function getScenarioLabelDistribution(
  scenario: EvaluationScenario
): { hostile_ratio: number; civil_ratio: number; unknown_ratio: number } {
  switch (scenario) {
    case 'all_hostile':
      return {
        hostile_ratio: 1.0,
        civil_ratio: 0.0,
        unknown_ratio: 0.0,
      };
    case 'mixed_civil':
      return {
        hostile_ratio: 0.5,
        civil_ratio: 0.5,
        unknown_ratio: 0.0,
      };
    case 'civil_only':
      return {
        hostile_ratio: 0.0,
        civil_ratio: 1.0,
        unknown_ratio: 0.0,
      };
    default:
      return {
        hostile_ratio: 0.7,
        civil_ratio: 0.2,
        unknown_ratio: 0.1,
      };
  }
}

/**
 * 모드별 센서 융합 설정
 */
export function getModeFusionEnabled(mode: EvaluationMode): boolean {
  return mode === 'FUSION';
}

