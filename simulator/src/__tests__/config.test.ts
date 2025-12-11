/**
 * 설정 모듈 테스트
 */

import { loadConfig, getConfig } from '../config';

describe('Config Module', () => {
  beforeEach(() => {
    // 환경 변수 초기화
    delete process.env.SIMULATOR_PORT;
    delete process.env.SIMULATOR_WS_URL;
    delete process.env.LOGS_DIR;
    delete process.env.LOG_CONSOLE_OUTPUT;
    delete process.env.LOG_ENABLED;
    delete process.env.SCENARIOS_DIR;
    delete process.env.NODE_ENV;
  });

  describe('loadConfig', () => {
    it('환경 변수가 없을 때 기본값을 반환해야 함', () => {
      const config = loadConfig();
      
      expect(config.port).toBe(8080);
      expect(config.wsUrl).toBe('ws://localhost:8080');
      expect(config.logsDir).toBe('./logs');
      expect(config.logConsoleOutput).toBe(false);
      expect(config.logEnabled).toBe(true);
      expect(config.scenariosDir).toBe('./scenarios/generated');
      expect(config.nodeEnv).toBe('development');
    });

    it('환경 변수에서 설정을 로드해야 함', () => {
      process.env.SIMULATOR_PORT = '9000';
      process.env.SIMULATOR_WS_URL = 'ws://localhost:9000';
      process.env.LOGS_DIR = './custom-logs';
      process.env.LOG_CONSOLE_OUTPUT = 'true';
      process.env.LOG_ENABLED = 'false';
      process.env.SCENARIOS_DIR = './custom-scenarios';
      process.env.NODE_ENV = 'production';

      const config = loadConfig();
      
      expect(config.port).toBe(9000);
      expect(config.wsUrl).toBe('ws://localhost:9000');
      expect(config.logsDir).toBe('./custom-logs');
      expect(config.logConsoleOutput).toBe(true);
      expect(config.logEnabled).toBe(false);
      expect(config.scenariosDir).toBe('./custom-scenarios');
      expect(config.nodeEnv).toBe('production');
    });

    it('포트 번호를 올바르게 파싱해야 함', () => {
      process.env.SIMULATOR_PORT = '3000';
      const config = loadConfig();
      expect(config.port).toBe(3000);
      expect(typeof config.port).toBe('number');
    });
  });

  describe('getConfig', () => {
    it('싱글톤 인스턴스를 반환해야 함', () => {
      const config1 = getConfig();
      const config2 = getConfig();
      
      expect(config1).toBe(config2);
    });

    it('환경 변수 변경 후에도 같은 인스턴스를 반환해야 함', () => {
      const config1 = getConfig();
      process.env.SIMULATOR_PORT = '9999';
      const config2 = getConfig();
      
      // 싱글톤이므로 같은 인스턴스
      expect(config1).toBe(config2);
      // 하지만 값은 처음 로드된 값 유지
      expect(config1.port).toBe(config2.port);
    });
  });
});

