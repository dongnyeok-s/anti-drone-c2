/**
 * 자동 시나리오 생성기 (확장판)
 * 
 * 다양한 랜덤 변수 기반의 드론/센서/확률/행동 패턴을 자동 생성하여
 * 대량의 실험 데이터를 생산 가능한 구조입니다.
 * 
 * v2: 드론 타입, 무장 여부, 권장 요격 방식, 음향 센서 설정 추가
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_RADAR_CONFIG, DEFAULT_HOSTILE_DRONE_CONFIG } from '../../../../shared/schemas';

// ============================================
// 시드 기반 난수 생성기 (재현성 확보)
// ============================================

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  choice<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

// ============================================
// 타입 정의
// ============================================

/** 드론 타입 */
export type DroneType = 
  | 'RECON_UAV'       // 정찰 드론
  | 'ATTACK_UAV'      // 공격 드론
  | 'LOITER_MUNITION' // 배회형 탄약
  | 'CARGO_UAV'       // 화물 드론
  | 'CIVILIAN'        // 민간 드론
  | 'UNKNOWN';

/** 드론 크기 */
export type DroneSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** 요격 방식 */
export type InterceptMethod = 'RAM' | 'GUN' | 'NET' | 'JAM';

/** 드론 행동 */
export type DroneBehavior = 'NORMAL' | 'RECON' | 'ATTACK_RUN' | 'EVADE';

// ============================================
// 시나리오 설정 타입
// ============================================

export interface GeneratedDrone {
  id: string;
  position: { x: number; y: number; altitude: number };
  velocity: { vx: number; vy: number; climbRate: number };
  behavior: DroneBehavior;
  is_hostile: boolean;
  
  // 확장 속성
  drone_type: DroneType;
  armed: boolean;
  size_class: DroneSize;
  recommended_method: InterceptMethod | null;
  
  config: {
    max_speed: number;
    cruise_speed: number;
    acceleration: number;
    turn_rate: number;
    climb_rate: number;
    evasion_trigger_distance: number;
    evasion_maneuver_strength: number;
  };
  target_position?: { x: number; y: number; altitude: number };
}

export interface GeneratedScenario {
  id: string;
  name: string;
  seed: number;
  created_at: string;
  
  // 드론 설정
  drones: GeneratedDrone[];
  interceptor_count: number;
  
  // 레이더 설정
  radar_config: {
    scan_rate: number;
    max_range: number;
    radial_noise_sigma: number;
    azimuth_noise_sigma: number;
    false_alarm_rate: number;
    miss_probability: number;
  };
  
  // 음향 센서 설정
  acoustic_config: {
    enabled: boolean;
    detection_range: number;
    takeoff_boost: number;
    approach_boost: number;
    false_alarm_rate: number;
    miss_probability: number;
  };
  
  // 행동 분포
  behavior_distribution: {
    direct_attack: number;
    recon_loiter: number;
    evasive: number;
    random_walk: number;
  };
  
  // 메타데이터
  metadata: {
    hostile_ratio: number;
    armed_ratio: number;
    avg_initial_distance: number;
    difficulty_estimate: number;
    drone_type_distribution: Record<DroneType, number>;
    size_distribution: Record<DroneSize, number>;
  };
}

export interface GeneratorConfig {
  minDrones: number;
  maxDrones: number;
  minInterceptors: number;
  maxInterceptors: number;
  mapRadius: number;
  minAltitude: number;
  maxAltitude: number;
  minSpeed: number;
  maxSpeed: number;
  hostileRatioMin: number;
  hostileRatioMax: number;
  armedRatioMin: number;
  armedRatioMax: number;
  acousticSensorProbability: number; // 음향 센서 활성화 확률
}

const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  minDrones: 1,
  maxDrones: 15,
  minInterceptors: 1,
  maxInterceptors: 5,
  mapRadius: 800,
  minAltitude: 30,
  maxAltitude: 200,
  minSpeed: 5,
  maxSpeed: 30,
  hostileRatioMin: 0.3,
  hostileRatioMax: 1.0,
  armedRatioMin: 0.2,
  armedRatioMax: 0.8,
  acousticSensorProbability: 0.5,
};

// ============================================
// 드론 타입별 특성
// ============================================

const DRONE_TYPE_CHARACTERISTICS: Record<DroneType, {
  sizes: DroneSize[];
  armedProbability: number;
  hostileProbability: number;
  behaviors: DroneBehavior[];
  recommendedMethods: InterceptMethod[];
  speedRange: [number, number];
}> = {
  RECON_UAV: {
    sizes: ['SMALL', 'MEDIUM'],
    armedProbability: 0.1,
    hostileProbability: 0.6,
    behaviors: ['RECON', 'NORMAL'],
    recommendedMethods: ['JAM', 'NET'],
    speedRange: [8, 20],
  },
  ATTACK_UAV: {
    sizes: ['MEDIUM', 'LARGE'],
    armedProbability: 0.9,
    hostileProbability: 0.95,
    behaviors: ['ATTACK_RUN', 'NORMAL'],
    recommendedMethods: ['GUN', 'RAM'],
    speedRange: [15, 35],
  },
  LOITER_MUNITION: {
    sizes: ['SMALL', 'MEDIUM'],
    armedProbability: 1.0,
    hostileProbability: 1.0,
    behaviors: ['ATTACK_RUN', 'RECON', 'EVADE'],
    recommendedMethods: ['GUN', 'JAM'],
    speedRange: [10, 25],
  },
  CARGO_UAV: {
    sizes: ['MEDIUM', 'LARGE'],
    armedProbability: 0.0,
    hostileProbability: 0.1,
    behaviors: ['NORMAL'],
    recommendedMethods: ['NET', 'JAM'],
    speedRange: [5, 15],
  },
  CIVILIAN: {
    sizes: ['SMALL'],
    armedProbability: 0.0,
    hostileProbability: 0.05,
    behaviors: ['NORMAL', 'RECON'],
    recommendedMethods: ['JAM', 'NET'],
    speedRange: [5, 12],
  },
  UNKNOWN: {
    sizes: ['SMALL', 'MEDIUM', 'LARGE'],
    armedProbability: 0.3,
    hostileProbability: 0.5,
    behaviors: ['NORMAL', 'RECON', 'EVADE'],
    recommendedMethods: ['RAM', 'GUN', 'NET', 'JAM'],
    speedRange: [5, 25],
  },
};

// ============================================
// 시나리오 생성기
// ============================================

export class ScenarioGenerator {
  private config: GeneratorConfig;
  private outputDir: string;

  constructor(config: Partial<GeneratorConfig> = {}, outputDir: string = './scenarios/generated') {
    this.config = { ...DEFAULT_GENERATOR_CONFIG, ...config };
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 시나리오 생성
   */
  generate(seed?: number): GeneratedScenario {
    const actualSeed = seed ?? Date.now();
    const rng = new SeededRandom(actualSeed);
    
    const id = `gen_${actualSeed}`;
    const droneCount = rng.nextInt(this.config.minDrones, this.config.maxDrones);
    const interceptorCount = rng.nextInt(this.config.minInterceptors, this.config.maxInterceptors);

    // 행동 분포 생성
    const behaviorDistribution = this.generateBehaviorDistribution(rng);
    
    // 레이더 설정 생성
    const radarConfig = this.generateRadarConfig(rng);
    
    // 음향 센서 설정 생성
    const acousticConfig = this.generateAcousticConfig(rng);
    
    // 드론 생성
    const drones = this.generateDrones(rng, droneCount, behaviorDistribution);
    
    // 메타데이터 계산
    const metadata = this.calculateMetadata(drones, radarConfig);

    const scenario: GeneratedScenario = {
      id,
      name: `자동생성 시나리오 (${droneCount}기)`,
      seed: actualSeed,
      created_at: new Date().toISOString(),
      drones,
      interceptor_count: interceptorCount,
      radar_config: radarConfig,
      acoustic_config: acousticConfig,
      behavior_distribution: behaviorDistribution,
      metadata,
    };

    return scenario;
  }

  /**
   * 행동 분포 생성
   */
  private generateBehaviorDistribution(rng: SeededRandom): GeneratedScenario['behavior_distribution'] {
    const weights = {
      direct_attack: rng.nextFloat(0.1, 0.5),
      recon_loiter: rng.nextFloat(0.1, 0.3),
      evasive: rng.nextFloat(0.1, 0.3),
      random_walk: rng.nextFloat(0.05, 0.2),
    };

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    return {
      direct_attack: weights.direct_attack / total,
      recon_loiter: weights.recon_loiter / total,
      evasive: weights.evasive / total,
      random_walk: weights.random_walk / total,
    };
  }

  /**
   * 레이더 설정 생성
   */
  private generateRadarConfig(rng: SeededRandom): GeneratedScenario['radar_config'] {
    return {
      scan_rate: rng.nextFloat(0.5, 2),
      max_range: rng.nextInt(800, 1200),
      radial_noise_sigma: rng.nextFloat(5, 20),
      azimuth_noise_sigma: rng.nextFloat(1, 5),
      false_alarm_rate: rng.nextFloat(0.005, 0.03),
      miss_probability: rng.nextFloat(0.03, 0.15),
    };
  }

  /**
   * 음향 센서 설정 생성
   */
  private generateAcousticConfig(rng: SeededRandom): GeneratedScenario['acoustic_config'] {
    const enabled = rng.chance(this.config.acousticSensorProbability);
    
    return {
      enabled,
      detection_range: rng.nextInt(600, 1200),
      takeoff_boost: rng.nextFloat(0.2, 0.4),
      approach_boost: rng.nextFloat(0.1, 0.3),
      false_alarm_rate: rng.nextFloat(0.005, 0.02),
      miss_probability: rng.nextFloat(0.1, 0.3),
    };
  }

  /**
   * 드론 배열 생성
   */
  private generateDrones(
    rng: SeededRandom,
    count: number,
    behaviorDist: GeneratedScenario['behavior_distribution']
  ): GeneratedDrone[] {
    const drones: GeneratedDrone[] = [];
    const droneTypes: DroneType[] = ['RECON_UAV', 'ATTACK_UAV', 'LOITER_MUNITION', 'CARGO_UAV', 'CIVILIAN', 'UNKNOWN'];
    
    for (let i = 0; i < count; i++) {
      // 드론 타입 선택
      const droneType = this.selectDroneType(rng, behaviorDist);
      const characteristics = DRONE_TYPE_CHARACTERISTICS[droneType];
      
      // 특성 기반 속성 결정
      const isHostile = rng.chance(characteristics.hostileProbability);
      const armed = rng.chance(characteristics.armedProbability);
      const sizeClass = rng.choice(characteristics.sizes);
      const behavior = this.selectBehaviorForType(rng, droneType, isHostile);
      const recommendedMethod = rng.choice(characteristics.recommendedMethods);
      
      // 위치 생성
      const angle = rng.nextFloat(0, Math.PI * 2);
      const distance = rng.nextFloat(300, this.config.mapRadius);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const altitude = rng.nextFloat(this.config.minAltitude, this.config.maxAltitude);

      // 속도 생성
      const [minSpeed, maxSpeed] = characteristics.speedRange;
      const speed = rng.nextFloat(minSpeed, maxSpeed);
      let vx: number, vy: number;
      
      if (behavior === 'NORMAL' || behavior === 'ATTACK_RUN') {
        const toBaseX = -x / distance;
        const toBaseY = -y / distance;
        vx = toBaseX * speed;
        vy = toBaseY * speed;
      } else if (behavior === 'RECON') {
        vx = -y / distance * speed * 0.5;
        vy = x / distance * speed * 0.5;
      } else {
        const velAngle = rng.nextFloat(0, Math.PI * 2);
        vx = Math.cos(velAngle) * speed;
        vy = Math.sin(velAngle) * speed;
      }

      const drone: GeneratedDrone = {
        id: `DRONE-${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`,
        position: { x, y, altitude },
        velocity: { vx, vy, climbRate: rng.nextFloat(-2, 2) },
        behavior,
        is_hostile: isHostile,
        drone_type: droneType,
        armed,
        size_class: sizeClass,
        recommended_method: isHostile ? recommendedMethod : null,
        config: {
          max_speed: rng.nextFloat(maxSpeed, maxSpeed * 1.2),
          cruise_speed: speed,
          acceleration: rng.nextFloat(3, 10),
          turn_rate: rng.nextFloat(45, 120),
          climb_rate: rng.nextFloat(3, 8),
          evasion_trigger_distance: rng.nextFloat(80, 150),
          evasion_maneuver_strength: rng.nextFloat(0.5, 1.0),
        },
      };

      if (behavior === 'RECON') {
        drone.target_position = {
          x: rng.nextFloat(-200, 200),
          y: rng.nextFloat(-200, 200),
          altitude: rng.nextFloat(100, 180),
        };
      }

      drones.push(drone);
    }

    return drones;
  }

  /**
   * 드론 타입 선택
   */
  private selectDroneType(
    rng: SeededRandom,
    behaviorDist: GeneratedScenario['behavior_distribution']
  ): DroneType {
    const r = rng.next();
    
    // 행동 분포에 따른 타입 선택
    if (r < behaviorDist.direct_attack * 0.6) {
      return rng.choice(['ATTACK_UAV', 'LOITER_MUNITION']);
    } else if (r < behaviorDist.direct_attack + behaviorDist.recon_loiter * 0.8) {
      return 'RECON_UAV';
    } else if (r < 0.9) {
      return rng.choice(['CARGO_UAV', 'CIVILIAN', 'UNKNOWN']);
    }
    
    return 'UNKNOWN';
  }

  /**
   * 드론 타입에 맞는 행동 선택
   */
  private selectBehaviorForType(
    rng: SeededRandom,
    droneType: DroneType,
    isHostile: boolean
  ): DroneBehavior {
    const characteristics = DRONE_TYPE_CHARACTERISTICS[droneType];
    
    if (!isHostile) {
      return rng.choice(['NORMAL', 'RECON']);
    }
    
    return rng.choice(characteristics.behaviors);
  }

  /**
   * 메타데이터 계산
   */
  private calculateMetadata(
    drones: GeneratedDrone[],
    radarConfig: GeneratedScenario['radar_config']
  ): GeneratedScenario['metadata'] {
    const hostileCount = drones.filter(d => d.is_hostile).length;
    const armedCount = drones.filter(d => d.armed).length;
    
    // 평균 초기 거리
    const avgDistance = drones.reduce((sum, d) => 
      sum + Math.sqrt(d.position.x ** 2 + d.position.y ** 2), 0
    ) / drones.length;

    // 드론 타입 분포
    const typeDistribution: Record<DroneType, number> = {
      RECON_UAV: 0, ATTACK_UAV: 0, LOITER_MUNITION: 0,
      CARGO_UAV: 0, CIVILIAN: 0, UNKNOWN: 0,
    };
    drones.forEach(d => typeDistribution[d.drone_type]++);

    // 크기 분포
    const sizeDistribution: Record<DroneSize, number> = {
      SMALL: 0, MEDIUM: 0, LARGE: 0,
    };
    drones.forEach(d => sizeDistribution[d.size_class]++);

    // 난이도 추정
    const difficulty = this.estimateDifficulty(drones, radarConfig);

    return {
      hostile_ratio: hostileCount / drones.length,
      armed_ratio: armedCount / drones.length,
      avg_initial_distance: Math.round(avgDistance),
      difficulty_estimate: difficulty,
      drone_type_distribution: typeDistribution,
      size_distribution: sizeDistribution,
    };
  }

  /**
   * 난이도 추정 (1-10)
   */
  private estimateDifficulty(
    drones: GeneratedDrone[],
    radarConfig: GeneratedScenario['radar_config']
  ): number {
    let score = 0;
    
    score += Math.min(3, drones.length / 5);
    
    const hostileRatio = drones.filter(d => d.is_hostile).length / drones.length;
    score += hostileRatio * 2;
    
    const armedRatio = drones.filter(d => d.armed).length / drones.length;
    score += armedRatio * 1.5;
    
    const attackRatio = drones.filter(d => 
      d.behavior === 'ATTACK_RUN' || d.drone_type === 'LOITER_MUNITION'
    ).length / drones.length;
    score += attackRatio * 2;
    
    score += (radarConfig.radial_noise_sigma / 20);
    score += radarConfig.miss_probability * 10;
    score += radarConfig.false_alarm_rate * 30;

    return Math.round(Math.min(10, Math.max(1, score)));
  }

  /**
   * 시나리오를 파일로 저장
   */
  save(scenario: GeneratedScenario): string {
    const filename = `${scenario.id}.json`;
    const filepath = path.join(this.outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(scenario, null, 2));
    console.log(`[ScenarioGenerator] 시나리오 저장: ${filepath}`);
    return filepath;
  }

  /**
   * 여러 시나리오 일괄 생성
   */
  generateBatch(count: number, baseSeed?: number): GeneratedScenario[] {
    const scenarios: GeneratedScenario[] = [];
    const seed = baseSeed ?? Date.now();
    
    for (let i = 0; i < count; i++) {
      const scenario = this.generate(seed + i);
      scenarios.push(scenario);
      this.save(scenario);
    }
    
    console.log(`[ScenarioGenerator] ${count}개 시나리오 생성 완료`);
    return scenarios;
  }

  /**
   * 저장된 시나리오 목록 반환
   */
  listSavedScenarios(): GeneratedScenario[] {
    if (!fs.existsSync(this.outputDir)) {
      return [];
    }

    const files = fs.readdirSync(this.outputDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a));

    return files.map(f => {
      const content = fs.readFileSync(path.join(this.outputDir, f), 'utf-8');
      return JSON.parse(content) as GeneratedScenario;
    });
  }

  /**
   * 특정 시나리오 로드
   */
  loadScenario(id: string): GeneratedScenario | null {
    const filepath = path.join(this.outputDir, `${id}.json`);
    if (!fs.existsSync(filepath)) {
      return null;
    }
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  }
}

// 싱글톤 인스턴스
let generatorInstance: ScenarioGenerator | null = null;

export function getGenerator(config?: Partial<GeneratorConfig>, outputDir?: string): ScenarioGenerator {
  if (!generatorInstance) {
    generatorInstance = new ScenarioGenerator(config, outputDir);
  }
  return generatorInstance;
}
