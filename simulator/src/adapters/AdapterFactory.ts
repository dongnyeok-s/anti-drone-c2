/**
 * Adapter Factory
 *
 * 2D 시뮬레이션(INTERNAL 모드)용 구현체 생성
 */

import { ISensorProvider, SensorConfig } from './ISensorProvider';
import { IDroneController } from './IDroneController';
import { InternalSensorProvider } from './InternalSensorProvider';
import { InternalDroneController } from './InternalDroneController';
import { Position3D, SimulationWorld } from '../types';

/**
 * 시뮬레이션 모드 (2D-only 버전은 INTERNAL만 지원)
 */
export type SimMode = 'INTERNAL';

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
   * @returns ISensorProvider 구현체
   */
  static createSensorProvider(
    mode: SimMode,
    basePosition: Position3D,
    config: SensorConfig
  ): ISensorProvider {
    if (mode !== 'INTERNAL') {
      throw new Error(`Unsupported simulation mode: ${mode}. This version only supports INTERNAL mode.`);
    }
    return new InternalSensorProvider(basePosition, config);
  }

  /**
   * 드론 제어자 생성
   *
   * @param mode 시뮬레이션 모드
   * @param world 시뮬레이션 월드
   * @returns IDroneController 구현체
   */
  static createDroneController(
    mode: SimMode,
    world: SimulationWorld
  ): IDroneController {
    if (mode !== 'INTERNAL') {
      throw new Error(`Unsupported simulation mode: ${mode}. This version only supports INTERNAL mode.`);
    }
    if (!world) {
      throw new Error('INTERNAL mode requires SimulationWorld');
    }
    return new InternalDroneController(world);
  }
}
