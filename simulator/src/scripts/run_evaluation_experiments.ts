/**
 * 2차 성능 향상 평가 실험 배치 실행 스크립트
 * 
 * 여러 시나리오×모드 조합을 자동으로 반복 실행하고
 * 결과를 구조화된 디렉토리에 저장합니다.
 * 
 * 사용법:
 *   ts-node src/scripts/run_evaluation_experiments.ts
 *   또는
 *   npm run eval
 */

import * as fs from 'fs';
import * as path from 'path';
import { SimulationEngine } from '../simulation';
import { getGenerator, ScenarioGenerator } from '../core/scenario/generator';
import { resetLogger, getLogger } from '../core/logging/logger';
import { getEvaluationExperiments, getScenarioLabelDistribution, getModeFusionEnabled, ExperimentConfig, EvaluationProfile, EvaluationMode } from '../evaluation/config';

// ============================================
// 설정
// ============================================

const EVAL_LOGS_DIR = './logs/eval';
const TICK_INTERVAL_MS = 100;  // 0.1초

// ============================================
// 유틸리티 함수
// ============================================

/**
 * 디렉토리 생성 (재귀적)
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 대기 함수 (동기)
 */
function sleep(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // CPU 부하 방지를 위한 짧은 대기
  }
}

/**
 * 시뮬레이션 실행
 */
async function runSimulation(
  scenarioId: string,
  scenarioName: string,
  fusionEnabled: boolean,
  duration: number,
  logDir: string,
  logFileName: string,
  seed?: number
): Promise<void> {
  // 로거 리셋 및 새 로그 파일 설정
  resetLogger();
  const logger = getLogger({
    logsDir: logDir,
    enabled: true,
    consoleOutput: false,
    // customFilename은 나중에 파일명 변경으로 처리
  });

  // 시뮬레이션 엔진 초기화
  const simulation = new SimulationEngine(() => {
    // 이벤트는 로거를 통해 자동으로 기록됨
  });

  // 센서 융합 설정
  simulation.setFusionEnabled(fusionEnabled);

  // 시나리오 로드 (이미 생성된 시나리오)
  simulation.loadScenario(scenarioId);

  // 고속 모드 설정 (10배 속도)
  simulation.setSpeedMultiplier(10);
  
  // 시뮬레이션 시작
  simulation.start();

  // 실제 대기 시간 (실험시간 / 배율)
  const realWaitTime = Math.ceil(duration / 10 * 1000); // 밀리초
  await new Promise(resolve => setTimeout(resolve, realWaitTime));

  // 시뮬레이션 종료
  simulation.pause();
  
  // 시나리오 종료 로깅
  const state = simulation.getState();
  const currentTime = state.time;
  logger.endScenario(currentTime);
  
  // 로그 파일 이름 변경
  const currentLogFile = (logger as any).currentFile;
  if (currentLogFile && logFileName) {
    const newPath = path.join(logDir, logFileName);
    if (fs.existsSync(currentLogFile) && currentLogFile !== newPath) {
      // 파일이 아직 열려있을 수 있으므로, 스트림을 닫고 이름 변경
      if ((logger as any).writeStream) {
        (logger as any).writeStream.end();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (fs.existsSync(currentLogFile)) {
        fs.renameSync(currentLogFile, newPath);
      }
    }
  }
}

/**
 * 단일 실험 실행
 */
async function runSingleExperiment(
  experiment: ExperimentConfig,
  runIndex: number,
  baseSeed: number
): Promise<void> {
  const experimentName = experiment.name;
  const mode = experiment.mode;
  const scenario = experiment.scenario;
  
  // 로그 디렉토리 경로
  const logDir = path.join(EVAL_LOGS_DIR, experimentName, mode);
  ensureDir(logDir);
  
  // 로그 파일명
  const logFileName = `run_${runIndex}.jsonl`;
  
  // 시나리오 생성
  const labelDist = getScenarioLabelDistribution(scenario);
  const generator = getGenerator({
    trueLabelDistribution: labelDist,
  });
  
  // 시드 계산 (baseSeed + runIndex)
  const seed = (experiment.seed || baseSeed) + runIndex;
  const generatedScenario = generator.generate(seed);
  
  // 시나리오 저장
  generator.save(generatedScenario);
  
  // 시나리오 메타데이터 저장 (선택사항)
  const scenarioPath = path.join(logDir, `scenario_${runIndex}.json`);
  fs.writeFileSync(scenarioPath, JSON.stringify({
    ...generatedScenario,
    experiment_name: experimentName,
    mode,
    run_index: runIndex,
    seed,
  }, null, 2));
  
  console.log(`  [${experimentName}] Run ${runIndex + 1}/${experiment.runs} (seed: ${seed})`);
  
  // 시뮬레이션 실행
  await runSimulation(
    generatedScenario.id,
    generatedScenario.name,
    getModeFusionEnabled(mode),
    experiment.duration,
    logDir,
    logFileName,
    seed
  );
  
  const logPath = path.join(logDir, logFileName);
  console.log(`    ✓ 완료: ${logPath}`);
}

/**
 * 모든 실험 실행
 */
async function runAllExperiments(profile: EvaluationProfile = 'fast', filterMode?: EvaluationMode): Promise<void> {
  console.log('='.repeat(60));
  console.log('  2차 성능 향상 평가 실험 배치 실행');
  console.log('='.repeat(60));
  console.log();
  
  let experiments = getEvaluationExperiments(profile);
  
  // 특정 모드만 필터링
  if (filterMode) {
    experiments = experiments.filter(exp => exp.mode === filterMode);
    console.log(`필터링: ${filterMode} 모드만 실행`);
  }
  
  const baseSeed = Date.now();
  let totalRuns = 0;
  
  // 전체 실험 수 계산
  for (const exp of experiments) {
    totalRuns += exp.runs;
  }
  
  console.log(`프로파일: ${profile.toUpperCase()}`);
  if (filterMode) {
    console.log(`필터 모드: ${filterMode}`);
  }
  console.log(`총 실험 수: ${experiments.length}개`);
  console.log(`총 실행 횟수: ${totalRuns}회`);
  console.log(`로그 저장 위치: ${EVAL_LOGS_DIR}`);
  console.log();
  
  let currentRun = 0;
  
  // 각 실험 실행
  for (const experiment of experiments) {
    console.log(`\n[실험] ${experiment.name}`);
    console.log(`  시나리오: ${experiment.scenario}`);
    console.log(`  모드: ${experiment.mode}`);
    console.log(`  반복 횟수: ${experiment.runs}회`);
    console.log(`  실행 시간: ${experiment.duration}초`);
    
    for (let runIndex = 0; runIndex < experiment.runs; runIndex++) {
      currentRun++;
      const progress = ((currentRun / totalRuns) * 100).toFixed(1);
      console.log(`\n[${progress}%] 진행 중...`);
      
      try {
        await runSingleExperiment(experiment, runIndex, baseSeed);
      } catch (error) {
        console.error(`  ✗ 오류 발생: ${error}`);
        console.error(error);
      }
    }
    
    console.log(`\n  ✓ ${experiment.name} 완료`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('  모든 실험 완료!');
  console.log('='.repeat(60));
  console.log(`\n결과 위치: ${EVAL_LOGS_DIR}`);
  console.log('\n다음 단계:');
  console.log('  python analysis/scripts/eval_classification_report.py');
  console.log('  또는');
  console.log('  npm run eval:analysis');
}

// ============================================
// 메인 실행
// ============================================

if (require.main === module) {
  // CLI 인자 파싱
  const args = process.argv.slice(2);
  let profile: EvaluationProfile = 'fast';  // 기본값: fast
  let filterMode: EvaluationMode | undefined = undefined;
  
  // --profile 옵션 확인
  const profileIndex = args.indexOf('--profile');
  if (profileIndex !== -1 && args[profileIndex + 1]) {
    const profileValue = args[profileIndex + 1].toLowerCase();
    if (profileValue === 'fast' || profileValue === 'full') {
      profile = profileValue as EvaluationProfile;
    } else {
      console.error(`Error: Invalid profile "${profileValue}". Use "fast" or "full".`);
      process.exit(1);
    }
  }
  
  // --mode 옵션 확인
  const modeIndex = args.indexOf('--mode');
  if (modeIndex !== -1 && args[modeIndex + 1]) {
    const modeValue = args[modeIndex + 1].toUpperCase();
    if (modeValue === 'BASELINE' || modeValue === 'FUSION') {
      filterMode = modeValue as EvaluationMode;
    } else {
      console.error(`Error: Invalid mode "${modeValue}". Use "BASELINE" or "FUSION".`);
      process.exit(1);
    }
  }
  
  runAllExperiments(profile, filterMode);
}

export { runAllExperiments, runSingleExperiment };

