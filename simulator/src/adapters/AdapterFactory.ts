/**
 * Adapter Factory
 *
 * 시뮬레이션 모드에 따라 적절한 구현체를 생성
 */

import { ISensorProvider, SensorConfig } from './ISensorProvider';
import { IDroneController } from './IDroneController';
import { InternalSensorProvider } from './InternalSensorProvider';
import { InternalDroneController } from './InternalDroneController';
import { AirSimSensorProvider } from './AirSimSensorProvider';
import { AirSimDroneController } from './AirSimDroneController';
import { Position3D, SimulationWorld } from '../types';

/**
 * 시뮬레이션 모드
 */
export type SimMode = 'INTERNAL' | 'EXTERNAL_AIRSIM';

/**
 * Adapter Factory 클래스
 */
export class AdapterFactory {
  /**
   * 센서 제공자 생성
   *
   * @param mode 시뮬레이션 모드
   * @param basePosition 기지 위치
   * @param config 센서 설정
   * @param bridgeUrl AirSim 브리지 URL (EXTERNAL_AIRSIM 모드에서 필요)
   * @returns ISensorProvider 구현체
   */
  static createSensorProvider(
    mode: SimMode,
    basePosition: Position3D,
    config: SensorConfig,
    bridgeUrl?: string
  ): ISensorProvider {
    switch (mode) {
      case 'INTERNAL':
        return new InternalSensorProvider(basePosition, config);

      case 'EXTERNAL_AIRSIM':
        if (!bridgeUrl) {
          throw new Error('EXTERNAL_AIRSIM mode requires bridgeUrl');
        }
        return new AirSimSensorProvider(bridgeUrl, basePosition, config);

      default:
        throw new Error(`Unknown simulation mode: ${mode}`);
    }
  }

  /**
   * 드론 제어자 생성
   *
   * @param mode 시뮬레이션 모드
   * @param world 시뮬레이션 월드 (INTERNAL 모드에서 필요)
   * @param bridgeUrl AirSim 브리지 URL (EXTERNAL_AIRSIM 모드에서 필요)
   * @returns IDroneController 구현체
   */
  static createDroneController(
    mode: SimMode,
    world?: SimulationWorld,
    bridgeUrl?: string
  ): IDroneController {
    switch (mode) {
      case 'INTERNAL':
        if (!world) {
          throw new Error('INTERNAL mode requires SimulationWorld');
        }
        return new InternalDroneController(world);

      case 'EXTERNAL_AIRSIM':
        if (!bridgeUrl) {
          throw new Error('EXTERNAL_AIRSIM mode requires bridgeUrl');
        }
        return new AirSimDroneController(bridgeUrl);

      default:
        throw new Error(`Unknown simulation mode: ${mode}`);
    }
  }
}
