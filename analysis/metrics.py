"""
실험 지표 계산 모듈

탐지, 교전, 요격 등 각종 성능 지표를 계산합니다.
"""

import statistics
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
from loader import ExperimentData, filter_events


@dataclass
class DelayStats:
    """지연 시간 통계"""
    mean: float = 0
    median: float = 0
    std: float = 0
    min_val: float = 0
    max_val: float = 0
    count: int = 0
    values: List[float] = field(default_factory=list)
    
    @classmethod
    def from_values(cls, values: List[float]) -> 'DelayStats':
        if not values:
            return cls()
        return cls(
            mean=round(statistics.mean(values), 3),
            median=round(statistics.median(values), 3),
            std=round(statistics.stdev(values), 3) if len(values) > 1 else 0,
            min_val=round(min(values), 3),
            max_val=round(max(values), 3),
            count=len(values),
            values=values
        )


@dataclass
class FalseAlarmStats:
    """오탐 통계 (3종류 분류)"""
    total: int = 0
    no_object: int = 0           # 드론 없음 + 탐지 이벤트
    misclassification: int = 0   # 아군/중립 오분류
    tracking_error: int = 0      # 위치 오차 초과
    
    @property
    def breakdown(self) -> Dict[str, int]:
        return {
            'no_object': self.no_object,
            'misclassification': self.misclassification,
            'tracking_error': self.tracking_error,
        }


@dataclass  
class InterceptFailureStats:
    """요격 실패 원인 통계"""
    total_failures: int = 0
    evaded: int = 0
    distance_exceeded: int = 0
    timeout: int = 0
    low_speed: int = 0
    sensor_error: int = 0
    target_lost: int = 0
    jam_failed: int = 0
    gun_missed: int = 0
    net_missed: int = 0
    collision_avoided: int = 0
    other: int = 0
    
    @property
    def breakdown(self) -> Dict[str, int]:
        return {
            'evaded': self.evaded,
            'distance_exceeded': self.distance_exceeded,
            'timeout': self.timeout,
            'low_speed': self.low_speed,
            'sensor_error': self.sensor_error,
            'target_lost': self.target_lost,
            'jam_failed': self.jam_failed,
            'gun_missed': self.gun_missed,
            'net_missed': self.net_missed,
            'collision_avoided': self.collision_avoided,
            'other': self.other,
        }
    
    @property
    def top_reasons(self) -> List[Tuple[str, int]]:
        """상위 실패 원인 반환"""
        reasons = [(k, v) for k, v in self.breakdown.items() if v > 0]
        return sorted(reasons, key=lambda x: x[1], reverse=True)


@dataclass
class InterceptMethodStats:
    """요격 방식별 통계"""
    method: str
    attempts: int = 0
    successes: int = 0
    failures: int = 0
    
    @property
    def success_rate(self) -> float:
        total = self.successes + self.failures
        return self.successes / total * 100 if total > 0 else 0


@dataclass
class InterceptMethodBreakdown:
    """요격 방식별 상세 분류"""
    RAM: InterceptMethodStats = field(default_factory=lambda: InterceptMethodStats('RAM'))
    GUN: InterceptMethodStats = field(default_factory=lambda: InterceptMethodStats('GUN'))
    NET: InterceptMethodStats = field(default_factory=lambda: InterceptMethodStats('NET'))
    JAM: InterceptMethodStats = field(default_factory=lambda: InterceptMethodStats('JAM'))
    UNKNOWN: InterceptMethodStats = field(default_factory=lambda: InterceptMethodStats('UNKNOWN'))
    
    def get(self, method: str) -> InterceptMethodStats:
        return getattr(self, method.upper(), self.UNKNOWN)
    
    def add_attempt(self, method: str):
        stats = self.get(method)
        stats.attempts += 1
    
    def add_success(self, method: str):
        stats = self.get(method)
        stats.successes += 1
    
    def add_failure(self, method: str):
        stats = self.get(method)
        stats.failures += 1
    
    def to_dict(self) -> Dict[str, Dict[str, Any]]:
        return {
            'RAM': {'attempts': self.RAM.attempts, 'successes': self.RAM.successes, 'failures': self.RAM.failures, 'success_rate': self.RAM.success_rate},
            'GUN': {'attempts': self.GUN.attempts, 'successes': self.GUN.successes, 'failures': self.GUN.failures, 'success_rate': self.GUN.success_rate},
            'NET': {'attempts': self.NET.attempts, 'successes': self.NET.successes, 'failures': self.NET.failures, 'success_rate': self.NET.success_rate},
            'JAM': {'attempts': self.JAM.attempts, 'successes': self.JAM.successes, 'failures': self.JAM.failures, 'success_rate': self.JAM.success_rate},
        }


@dataclass
class DroneStats:
    """드론별 통계"""
    drone_id: str
    spawn_time: float = 0
    first_radar_detection_time: Optional[float] = None
    first_audio_detection_time: Optional[float] = None
    radar_detection_count: int = 0
    audio_detection_count: int = 0
    was_engaged: bool = False
    was_neutralized: bool = False
    engagement_time: Optional[float] = None
    neutralization_time: Optional[float] = None
    behavior: str = "UNKNOWN"
    is_hostile: bool = True
    
    @property
    def detection_delay(self) -> Optional[float]:
        """탐지 지연 시간 (스폰 → 첫 탐지)"""
        if self.first_radar_detection_time is not None:
            return self.first_radar_detection_time - self.spawn_time
        return None
    
    @property
    def engagement_delay(self) -> Optional[float]:
        """교전 지연 시간 (첫 탐지 → 교전)"""
        if self.engagement_time and self.first_radar_detection_time:
            return self.engagement_time - self.first_radar_detection_time
        return None


@dataclass
class ExperimentMetrics:
    """실험별 지표"""
    experiment_id: str
    scenario_id: str
    duration: float = 0
    audio_model_enabled: bool = False
    
    # 드론 통계
    total_drones: int = 0
    hostile_drones: int = 0
    neutral_drones: int = 0
    drones: Dict[str, DroneStats] = field(default_factory=dict)
    
    # 이벤트 카운트
    event_counts: Dict[str, int] = field(default_factory=dict)
    
    # 탐지 통계
    radar_detections: int = 0
    audio_detections: int = 0
    false_alarm_stats: FalseAlarmStats = field(default_factory=FalseAlarmStats)
    
    # 탐지/교전 지연
    detection_delays: DelayStats = field(default_factory=DelayStats)
    engagement_delays: DelayStats = field(default_factory=DelayStats)
    
    # 요격 통계
    total_interceptors: int = 0
    engage_commands: int = 0
    intercept_attempts: int = 0
    intercept_successes: int = 0
    intercept_failures: int = 0
    intercept_failure_stats: InterceptFailureStats = field(default_factory=InterceptFailureStats)
    intercept_method_stats: InterceptMethodBreakdown = field(default_factory=InterceptMethodBreakdown)
    
    # EO 정찰 통계
    eo_confirmations: int = 0
    recon_commands: int = 0
    
    # 위협 평가 통계
    threat_score_updates: int = 0
    manual_actions: int = 0
    
    @property
    def detection_rate(self) -> float:
        """탐지율 (탐지된 드론 / 전체 드론)"""
        detected = sum(1 for d in self.drones.values() if d.first_radar_detection_time is not None)
        return detected / self.total_drones * 100 if self.total_drones > 0 else 0
    
    @property
    def intercept_success_rate(self) -> float:
        """요격 성공률"""
        total = self.intercept_successes + self.intercept_failures
        return self.intercept_successes / total * 100 if total > 0 else 0
    
    @property
    def neutralization_rate(self) -> float:
        """무력화율 (무력화 드론 / 적대적 드론)"""
        neutralized = sum(1 for d in self.drones.values() if d.was_neutralized)
        return neutralized / self.hostile_drones * 100 if self.hostile_drones > 0 else 0
    
    @property
    def false_alarm_rate(self) -> float:
        """오탐률"""
        total = self.radar_detections
        return self.false_alarm_stats.total / total * 100 if total > 0 else 0


def calculate_experiment_metrics(exp: ExperimentData) -> ExperimentMetrics:
    """
    단일 실험의 지표 계산
    
    Args:
        exp: ExperimentData 객체
        
    Returns:
        ExperimentMetrics 객체
    """
    metrics = ExperimentMetrics(
        experiment_id=exp.experiment_id,
        scenario_id=exp.scenario_id,
        duration=exp.duration,
        audio_model_enabled=exp.audio_model_enabled,
        total_drones=exp.drone_count,
        total_interceptors=exp.interceptor_count,
    )
    
    # 이벤트 카운트
    for event in exp.events:
        event_type = event.get('event', 'unknown')
        metrics.event_counts[event_type] = metrics.event_counts.get(event_type, 0) + 1
    
    detection_delay_values = []
    engagement_delay_values = []
    
    for event in exp.events:
        event_type = event.get('event', '')
        timestamp = event.get('timestamp', 0)
        
        # 드론 생성
        if event_type == 'drone_spawned':
            drone_id = event.get('drone_id', '')
            is_hostile = event.get('is_hostile', True)
            metrics.drones[drone_id] = DroneStats(
                drone_id=drone_id,
                spawn_time=timestamp,
                behavior=event.get('behavior', 'UNKNOWN'),
                is_hostile=is_hostile
            )
            if is_hostile:
                metrics.hostile_drones += 1
            else:
                metrics.neutral_drones += 1
        
        # 레이더 탐지
        elif event_type == 'radar_detection':
            metrics.radar_detections += 1
            drone_id = event.get('drone_id', '')
            
            # 오탐 분류
            if event.get('is_false_alarm'):
                metrics.false_alarm_stats.total += 1
                fa_type = event.get('false_alarm_type', 'no_object')
                if fa_type == 'no_object':
                    metrics.false_alarm_stats.no_object += 1
                elif fa_type == 'misclassification':
                    metrics.false_alarm_stats.misclassification += 1
                elif fa_type == 'tracking_error':
                    metrics.false_alarm_stats.tracking_error += 1
            
            # 드론별 탐지 기록
            if drone_id in metrics.drones:
                drone = metrics.drones[drone_id]
                drone.radar_detection_count += 1
                if drone.first_radar_detection_time is None:
                    drone.first_radar_detection_time = timestamp
                    delay = timestamp - drone.spawn_time
                    detection_delay_values.append(delay)
        
        # 음향 탐지
        elif event_type == 'audio_detection':
            metrics.audio_detections += 1
            drone_id = event.get('drone_id', '')
            if drone_id in metrics.drones:
                drone = metrics.drones[drone_id]
                drone.audio_detection_count += 1
                if drone.first_audio_detection_time is None:
                    drone.first_audio_detection_time = timestamp
        
        # 교전 명령
        elif event_type == 'engage_command':
            metrics.engage_commands += 1
            drone_id = event.get('drone_id', '')
            if drone_id in metrics.drones:
                drone = metrics.drones[drone_id]
                if not drone.was_engaged:
                    drone.was_engaged = True
                    drone.engagement_time = timestamp
                    if drone.first_radar_detection_time:
                        delay = timestamp - drone.first_radar_detection_time
                        engagement_delay_values.append(delay)
        
        # 요격 시도
        elif event_type == 'intercept_attempt':
            metrics.intercept_attempts += 1
            method = event.get('method', 'UNKNOWN')
            metrics.intercept_method_stats.add_attempt(method)
        
        # 요격 결과
        elif event_type == 'intercept_result':
            result = event.get('result', '').lower()
            reason = event.get('reason', '')
            method = event.get('method', 'UNKNOWN')
            
            if result == 'success':
                metrics.intercept_successes += 1
                metrics.intercept_method_stats.add_success(method)
                target_id = event.get('target_id', '')
                if target_id in metrics.drones:
                    metrics.drones[target_id].was_neutralized = True
                    metrics.drones[target_id].neutralization_time = timestamp
            else:
                metrics.intercept_failures += 1
                metrics.intercept_failure_stats.total_failures += 1
                metrics.intercept_method_stats.add_failure(method)
                
                # 실패 원인 분류
                if reason == 'evaded':
                    metrics.intercept_failure_stats.evaded += 1
                elif reason == 'distance_exceeded':
                    metrics.intercept_failure_stats.distance_exceeded += 1
                elif reason == 'timeout':
                    metrics.intercept_failure_stats.timeout += 1
                elif reason == 'low_speed':
                    metrics.intercept_failure_stats.low_speed += 1
                elif reason == 'sensor_error':
                    metrics.intercept_failure_stats.sensor_error += 1
                elif reason == 'target_lost':
                    metrics.intercept_failure_stats.target_lost += 1
                elif reason == 'jam_failed':
                    metrics.intercept_failure_stats.jam_failed += 1
                elif reason == 'gun_missed':
                    metrics.intercept_failure_stats.gun_missed += 1
                elif reason == 'net_missed':
                    metrics.intercept_failure_stats.net_missed += 1
                elif reason == 'collision_avoided':
                    metrics.intercept_failure_stats.collision_avoided += 1
                else:
                    metrics.intercept_failure_stats.other += 1
        
        # EO 확인
        elif event_type == 'eo_confirmation':
            metrics.eo_confirmations += 1
        
        # 정찰 명령
        elif event_type == 'recon_command':
            metrics.recon_commands += 1
        
        # 위협 평가
        elif event_type == 'threat_score_update':
            metrics.threat_score_updates += 1
        
        # 수동 조작
        elif event_type == 'manual_action':
            metrics.manual_actions += 1
    
    # 지연 통계 계산
    metrics.detection_delays = DelayStats.from_values(detection_delay_values)
    metrics.engagement_delays = DelayStats.from_values(engagement_delay_values)
    
    return metrics


def aggregate_metrics(metrics_list: List[ExperimentMetrics]) -> Dict[str, Any]:
    """
    여러 실험의 지표를 집계
    
    Args:
        metrics_list: ExperimentMetrics 리스트
        
    Returns:
        집계된 지표 딕셔너리
    """
    if not metrics_list:
        return {}
    
    # 기본 집계
    total_experiments = len(metrics_list)
    total_drones = sum(m.total_drones for m in metrics_list)
    total_hostile = sum(m.hostile_drones for m in metrics_list)
    total_neutral = sum(m.neutral_drones for m in metrics_list)
    
    # 탐지 집계
    total_radar_detections = sum(m.radar_detections for m in metrics_list)
    total_audio_detections = sum(m.audio_detections for m in metrics_list)
    
    # 오탐 집계
    false_alarm_total = sum(m.false_alarm_stats.total for m in metrics_list)
    false_alarm_no_object = sum(m.false_alarm_stats.no_object for m in metrics_list)
    false_alarm_misclass = sum(m.false_alarm_stats.misclassification for m in metrics_list)
    false_alarm_tracking = sum(m.false_alarm_stats.tracking_error for m in metrics_list)
    
    # 요격 집계
    total_engage_commands = sum(m.engage_commands for m in metrics_list)
    total_intercept_successes = sum(m.intercept_successes for m in metrics_list)
    total_intercept_failures = sum(m.intercept_failures for m in metrics_list)
    
    # 요격 실패 원인 집계
    failure_reasons = defaultdict(int)
    for m in metrics_list:
        for reason, count in m.intercept_failure_stats.breakdown.items():
            failure_reasons[reason] += count
    
    # 지연 시간 집계
    all_detection_delays = []
    all_engagement_delays = []
    for m in metrics_list:
        all_detection_delays.extend(m.detection_delays.values)
        all_engagement_delays.extend(m.engagement_delays.values)
    
    # 드론별 통계
    detected_count = 0
    engaged_count = 0
    neutralized_count = 0
    for m in metrics_list:
        for drone in m.drones.values():
            if drone.first_radar_detection_time is not None:
                detected_count += 1
            if drone.was_engaged:
                engaged_count += 1
            if drone.was_neutralized:
                neutralized_count += 1
    
    # 이벤트 총계
    event_totals = defaultdict(int)
    for m in metrics_list:
        for event_type, count in m.event_counts.items():
            event_totals[event_type] += count
    
    # 음향 모델 활성화 여부
    audio_enabled_experiments = sum(1 for m in metrics_list if m.audio_model_enabled)
    
    # 시나리오별 드론 수 분포
    drone_counts_per_experiment = [m.total_drones for m in metrics_list]
    
    return {
        'experiment_count': total_experiments,
        'audio_enabled_experiments': audio_enabled_experiments,
        
        'drones': {
            'total': total_drones,
            'hostile': total_hostile,
            'neutral': total_neutral,
            'detected': detected_count,
            'engaged': engaged_count,
            'neutralized': neutralized_count,
            'avg_per_experiment': round(total_drones / total_experiments, 1),
            'per_experiment_distribution': drone_counts_per_experiment,
        },
        
        'detection': {
            'total_radar': total_radar_detections,
            'total_audio': total_audio_detections,
            'audio_model_active': audio_enabled_experiments > 0,
            'false_alarm_total': false_alarm_total,
            'false_alarm_breakdown': {
                'no_object': false_alarm_no_object,
                'misclassification': false_alarm_misclass,
                'tracking_error': false_alarm_tracking,
            },
            'false_alarm_rate': round(false_alarm_total / total_radar_detections * 100, 2) if total_radar_detections > 0 else 0,
            'detection_delay': DelayStats.from_values(all_detection_delays).__dict__,
        },
        
        'engagement': {
            'total_commands': total_engage_commands,
            'engaged_ratio': round(engaged_count / total_hostile * 100, 2) if total_hostile > 0 else 0,
            'engagement_delay': DelayStats.from_values(all_engagement_delays).__dict__,
        },
        
        'interception': {
            'total_attempts': total_intercept_successes + total_intercept_failures,
            'successes': total_intercept_successes,
            'failures': total_intercept_failures,
            'success_rate': round(total_intercept_successes / (total_intercept_successes + total_intercept_failures) * 100, 2) if (total_intercept_successes + total_intercept_failures) > 0 else 0,
            'neutralization_rate': round(neutralized_count / total_hostile * 100, 2) if total_hostile > 0 else 0,
            'failure_reasons': dict(failure_reasons),
            'top_failure_reasons': sorted(failure_reasons.items(), key=lambda x: x[1], reverse=True)[:3],
        },
        
        'event_totals': dict(event_totals),
    }


def calculate_all_metrics(experiments: List[ExperimentData]) -> Tuple[List[ExperimentMetrics], Dict[str, Any]]:
    """
    모든 실험의 지표 계산 및 집계
    
    Args:
        experiments: ExperimentData 리스트
        
    Returns:
        (개별 지표 리스트, 집계 지표) 튜플
    """
    individual_metrics = [calculate_experiment_metrics(exp) for exp in experiments]
    aggregated = aggregate_metrics(individual_metrics)
    return individual_metrics, aggregated

