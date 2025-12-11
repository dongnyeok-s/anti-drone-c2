/**
 * JSONL 로거 시스템
 * 
 * 모든 실험 이벤트를 JSONL 형식으로 파일에 저장합니다.
 * 파일명: /logs/{scenario_id}_{timestamp}.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import { LogEvent, ScenarioStartEvent, ScenarioEndEvent } from './eventSchemas';

export interface LoggerConfig {
  logsDir: string;
  enabled: boolean;
  consoleOutput: boolean;  // 콘솔에도 출력할지 여부
  customFilename?: string;  // 커스텀 파일명 (선택사항)
}

const DEFAULT_CONFIG: LoggerConfig = {
  logsDir: './logs',
  enabled: true,
  consoleOutput: false,
  customFilename: undefined,
};

export class ExperimentLogger {
  private config: LoggerConfig;
  private currentFile: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private scenarioId: string | number | null = null;
  private sessionStartTime: number = 0;
  private eventCount: number = 0;
  
  // 통계 추적
  private stats = {
    total_drones: 0,
    drones_neutralized: 0,
    drones_escaped: 0,
    intercept_attempts: 0,
    intercept_successes: 0,
    intercept_failures: 0,
    false_alarms: 0,
  };

  // 첫 탐지 추적
  private firstDetections: Map<string, { audio: boolean; radar: boolean }> = new Map();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureLogsDir();
  }

  /**
   * 로그 디렉토리 확인/생성
   */
  private ensureLogsDir(): void {
    if (!fs.existsSync(this.config.logsDir)) {
      fs.mkdirSync(this.config.logsDir, { recursive: true });
    }
  }

  /**
   * 새 시나리오 시작
   */
  startScenario(scenarioId: string | number, scenarioName: string, config: ScenarioStartEvent['config'], seed?: number): void {
    // 이전 세션 종료
    if (this.writeStream) {
      this.endScenario();
    }

    this.scenarioId = scenarioId;
    this.sessionStartTime = Date.now();
    this.eventCount = 0;
    this.stats = {
      total_drones: config.drone_count,
      drones_neutralized: 0,
      drones_escaped: 0,
      intercept_attempts: 0,
      intercept_successes: 0,
      intercept_failures: 0,
      false_alarms: 0,
    };
    this.firstDetections.clear();

    // 파일 생성
    let filename: string;
    if (this.config.customFilename) {
      filename = this.config.customFilename;
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `${scenarioId}_${timestamp}.jsonl`;
    }
    this.currentFile = path.join(this.config.logsDir, filename);

    if (this.config.enabled) {
      this.writeStream = fs.createWriteStream(this.currentFile, { flags: 'a' });
      console.log(`[Logger] 로그 파일 생성: ${this.currentFile}`);
    }

    // 시나리오 시작 이벤트 기록
    this.log({
      timestamp: 0,
      event: 'scenario_start',
      scenario_id: scenarioId,
      scenario_name: scenarioName,
      seed,
      config,
    });
  }

  /**
   * 시나리오 종료
   */
  endScenario(simTime: number = 0): void {
    if (!this.scenarioId) return;

    // 시나리오 종료 이벤트 기록
    this.log({
      timestamp: simTime,
      event: 'scenario_end',
      scenario_id: this.scenarioId,
      duration: simTime,
      summary: this.stats,
    });

    // 스트림 닫기
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
      console.log(`[Logger] 로그 저장 완료: ${this.eventCount}개 이벤트, ${this.currentFile}`);
    }

    this.scenarioId = null;
    this.currentFile = null;
  }

  /**
   * 이벤트 로깅
   */
  log(event: LogEvent): void {
    if (!this.config.enabled) return;

    // 통계 업데이트
    this.updateStats(event);

    // 첫 탐지 여부 체크 및 업데이트
    if (event.event === 'audio_detection' || event.event === 'radar_detection') {
      this.updateFirstDetection(event as any);
    }

    // JSONL 형식으로 기록
    const line = JSON.stringify(event) + '\n';
    
    if (this.writeStream) {
      this.writeStream.write(line);
      this.eventCount++;
    }

    if (this.config.consoleOutput) {
      console.log(`[Log] ${event.event}:`, JSON.stringify(event).substring(0, 100));
    }
  }

  /**
   * 첫 탐지 여부 업데이트
   */
  private updateFirstDetection(event: { event: string; drone_id: string }): void {
    const droneId = event.drone_id;
    if (!this.firstDetections.has(droneId)) {
      this.firstDetections.set(droneId, { audio: false, radar: false });
    }

    const detection = this.firstDetections.get(droneId)!;
    
    if (event.event === 'audio_detection' && !detection.audio) {
      detection.audio = true;
      (event as any).is_first_detection = true;
    } else if (event.event === 'radar_detection' && !detection.radar) {
      detection.radar = true;
      (event as any).is_first_detection = true;
    } else {
      (event as any).is_first_detection = false;
    }
  }

  /**
   * 통계 업데이트
   */
  private updateStats(event: LogEvent): void {
    switch (event.event) {
      case 'drone_spawned':
        // 이미 config에서 설정됨
        break;
      case 'intercept_attempt':
        this.stats.intercept_attempts++;
        break;
      case 'intercept_result':
        if ((event as any).result === 'success') {
          this.stats.intercept_successes++;
          this.stats.drones_neutralized++;
        } else {
          this.stats.intercept_failures++;
        }
        break;
      case 'radar_detection':
        if ((event as any).is_false_alarm) {
          this.stats.false_alarms++;
        }
        break;
    }
  }

  /**
   * 현재 통계 반환
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * 로거 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 현재 로그 파일 경로 반환
   */
  getCurrentLogFile(): string | null {
    return this.currentFile;
  }
}

// 싱글톤 인스턴스
let loggerInstance: ExperimentLogger | null = null;

export function getLogger(config?: Partial<LoggerConfig>): ExperimentLogger {
  if (!loggerInstance) {
    loggerInstance = new ExperimentLogger(config);
  }
  return loggerInstance;
}

export function resetLogger(): void {
  if (loggerInstance) {
    loggerInstance.endScenario();
  }
  loggerInstance = null;
}

