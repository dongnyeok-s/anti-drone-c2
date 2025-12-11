#!/usr/bin/env python3
"""
Baseline vs Fusion 성능 비교 분석 스크립트

센서 융합(Radar + Audio + EO) 도입 전(Baseline)과 도입 후(Fusion)의 
성능 차이를 정량적으로 비교합니다.

사용법:
    python compare_fusion_vs_baseline.py --baseline_dir ../simulator/logs/baseline --fusion_dir ../simulator/logs/fusion
"""

import argparse
import json
import os
import glob
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
import numpy as np

# matplotlib 설정
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# 한글 폰트 설정
plt.rcParams['font.family'] = 'Apple SD Gothic Neo'
plt.rcParams['axes.unicode_minus'] = False

# ============================================
# 데이터 클래스 정의
# ============================================

@dataclass
class DroneMetrics:
    """개별 드론의 성능 지표"""
    drone_id: str
    t_spawn: float = 0.0
    is_hostile: bool = True
    drone_type: str = 'UNKNOWN'
    
    # 탐지 관련
    t_first_detect: Optional[float] = None
    first_detect_sensor: Optional[str] = None
    t_first_radar: Optional[float] = None
    t_first_audio: Optional[float] = None
    t_first_eo: Optional[float] = None
    
    # 융합 트랙 관련
    t_first_fused_track: Optional[float] = None
    t_exist_high: Optional[float] = None  # existence_prob >= 0.7 처음 도달 시각
    max_existence_prob: float = 0.0
    track_ids: List[str] = field(default_factory=list)  # 생성된 트랙 ID들
    
    # 위협 평가 관련
    t_threat_high: Optional[float] = None  # threat_score >= 70 처음 도달 시각
    max_threat_score: float = 0.0
    classification_result: Optional[str] = None
    
    # 교전 관련
    t_engage_cmd: Optional[float] = None
    intercept_method: Optional[str] = None
    intercept_result: Optional[str] = None  # 'success' / 'fail' / None
    
    @property
    def detection_latency(self) -> Optional[float]:
        """탐지 지연 시간"""
        if self.t_first_detect is not None:
            return self.t_first_detect - self.t_spawn
        return None
    
    @property
    def fused_track_latency(self) -> Optional[float]:
        """융합 트랙 생성 지연"""
        if self.t_first_fused_track is not None:
            return self.t_first_fused_track - self.t_spawn
        return None
    
    @property
    def exist_high_latency(self) -> Optional[float]:
        """존재 확률 0.7 도달 지연"""
        if self.t_exist_high is not None:
            return self.t_exist_high - self.t_spawn
        return None
    
    @property
    def threat_high_latency(self) -> Optional[float]:
        """위협 점수 70 도달 지연"""
        if self.t_threat_high is not None:
            return self.t_threat_high - self.t_spawn
        return None
    
    @property
    def detection_to_engage_delay(self) -> Optional[float]:
        """탐지 후 교전 명령까지 지연"""
        if self.t_engage_cmd is not None and self.t_first_detect is not None:
            return self.t_engage_cmd - self.t_first_detect
        return None
    
    @property
    def track_fragment_count(self) -> int:
        """트랙 파편화 수"""
        return len(set(self.track_ids)) if self.track_ids else 1


@dataclass 
class ExperimentMetrics:
    """단일 실험의 집계 지표"""
    experiment_id: str
    duration: float = 0.0
    drone_metrics: List[DroneMetrics] = field(default_factory=list)
    
    # 전체 통계
    total_drones: int = 0
    hostile_drones: int = 0
    
    # 탐지 통계
    total_detections: int = 0
    false_alarms: int = 0
    missed_drones: int = 0
    
    # 교전/요격 통계
    engage_commands: int = 0
    intercept_attempts: int = 0
    intercept_successes: int = 0


@dataclass
class AggregatedMetrics:
    """여러 실험의 집계 지표"""
    mode: str  # 'baseline' or 'fusion'
    experiments: List[ExperimentMetrics] = field(default_factory=list)
    
    # 탐지 지연
    detection_latencies: List[float] = field(default_factory=list)
    fused_track_latencies: List[float] = field(default_factory=list)
    exist_high_latencies: List[float] = field(default_factory=list)
    threat_high_latencies: List[float] = field(default_factory=list)
    detection_to_engage_delays: List[float] = field(default_factory=list)
    
    # 센서별 첫 탐지 분포
    first_detect_sensor_counts: Dict[str, int] = field(default_factory=dict)
    
    # 트랙 파편화
    fragment_counts: List[int] = field(default_factory=list)
    
    # 위협 점수 분포
    hostile_threat_scores: List[float] = field(default_factory=list)
    non_hostile_threat_scores: List[float] = field(default_factory=list)
    
    # 분류 결과
    classification_results: Dict[str, Dict[str, int]] = field(default_factory=dict)
    
    # 종합 통계
    total_drones: int = 0
    hostile_drones: int = 0
    total_detections: int = 0
    false_alarms: int = 0
    missed_drones: int = 0
    engage_commands: int = 0
    intercept_attempts: int = 0
    intercept_successes: int = 0


# ============================================
# 로그 파싱 함수
# ============================================

def parse_jsonl_file(filepath: str) -> List[Dict[str, Any]]:
    """JSONL 파일 파싱"""
    events = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def process_experiment(filepath: str) -> Optional[ExperimentMetrics]:
    """단일 실험 파일 처리"""
    events = parse_jsonl_file(filepath)
    if not events:
        return None
    
    exp_id = Path(filepath).stem
    
    # 드론별 메트릭스 수집
    drone_data: Dict[str, DroneMetrics] = {}
    
    # 통계 변수
    duration = 0.0
    total_detections = 0
    false_alarms = 0
    engage_commands = 0
    intercept_attempts = 0
    intercept_successes = 0
    
    for event in events:
        event_type = event.get('event', '')
        timestamp = event.get('timestamp', 0)
        drone_id = event.get('drone_id')
        
        # 시나리오 종료
        if event_type == 'scenario_end':
            duration = event.get('duration', timestamp)
            summary = event.get('summary', {})
            intercept_attempts = summary.get('intercept_attempts', 0)
            intercept_successes = summary.get('intercept_successes', 0)
            false_alarms = summary.get('false_alarms', 0)
        
        # 드론 생성
        elif event_type == 'drone_spawned' and drone_id:
            drone_data[drone_id] = DroneMetrics(
                drone_id=drone_id,
                t_spawn=timestamp,
                is_hostile=event.get('is_hostile', True),
                drone_type=event.get('drone_type', 'UNKNOWN'),
            )
        
        # 레이더 탐지
        elif event_type == 'radar_detection' and drone_id:
            total_detections += 1
            is_false_alarm = event.get('is_false_alarm', False)
            
            if is_false_alarm:
                false_alarms += 1
            elif drone_id in drone_data:
                dm = drone_data[drone_id]
                if dm.t_first_radar is None:
                    dm.t_first_radar = timestamp
                if dm.t_first_detect is None:
                    dm.t_first_detect = timestamp
                    dm.first_detect_sensor = 'RADAR'
        
        # 음향 탐지
        elif event_type == 'audio_detection':
            total_detections += 1
            is_false_alarm = event.get('is_false_alarm', False)
            
            if is_false_alarm or not drone_id:
                false_alarms += 1
            elif drone_id in drone_data:
                dm = drone_data[drone_id]
                if dm.t_first_audio is None:
                    dm.t_first_audio = timestamp
                if dm.t_first_detect is None:
                    dm.t_first_detect = timestamp
                    dm.first_detect_sensor = 'AUDIO'
        
        # EO 정찰 확인
        elif event_type == 'eo_confirmation' and drone_id:
            if drone_id in drone_data:
                dm = drone_data[drone_id]
                if dm.t_first_eo is None:
                    dm.t_first_eo = timestamp
                if dm.t_first_detect is None:
                    dm.t_first_detect = timestamp
                    dm.first_detect_sensor = 'EO'
                dm.classification_result = event.get('classification', 'UNKNOWN')
        
        # 융합 트랙 업데이트
        elif event_type == 'fused_track_update' and drone_id:
            if drone_id in drone_data:
                dm = drone_data[drone_id]
                track_id = event.get('track_id', '')
                existence_prob = event.get('existence_prob', 0)
                # threat_score 또는 fused_threat_score 필드 확인
                threat_score = event.get('threat_score', event.get('fused_threat_score', 0))
                
                if track_id and track_id not in dm.track_ids:
                    dm.track_ids.append(track_id)
                
                if dm.t_first_fused_track is None:
                    dm.t_first_fused_track = timestamp
                
                if existence_prob >= 0.7 and dm.t_exist_high is None:
                    dm.t_exist_high = timestamp
                
                dm.max_existence_prob = max(dm.max_existence_prob, existence_prob)
                dm.max_threat_score = max(dm.max_threat_score, threat_score)
                
                if threat_score >= 70 and dm.t_threat_high is None:
                    dm.t_threat_high = timestamp
        
        # 트랙 생성
        elif event_type == 'track_created':
            track_drone_id = event.get('drone_id')
            track_id = event.get('track_id', '')
            if track_drone_id and track_drone_id in drone_data:
                dm = drone_data[track_drone_id]
                if dm.t_first_fused_track is None:
                    dm.t_first_fused_track = timestamp
                if track_id and track_id not in dm.track_ids:
                    dm.track_ids.append(track_id)
        
        # 위협 점수 업데이트
        elif event_type == 'threat_score_update' and drone_id:
            if drone_id in drone_data:
                dm = drone_data[drone_id]
                threat_score = event.get('total_score', 0)
                dm.max_threat_score = max(dm.max_threat_score, threat_score)
                if threat_score >= 70 and dm.t_threat_high is None:
                    dm.t_threat_high = timestamp
        
        # 교전 명령
        elif event_type == 'engage_command' and drone_id:
            engage_commands += 1
            if drone_id in drone_data:
                dm = drone_data[drone_id]
                if dm.t_engage_cmd is None:
                    dm.t_engage_cmd = timestamp
                    dm.intercept_method = event.get('method', 'UNKNOWN')
        
        # 요격 결과
        elif event_type == 'intercept_result':
            target_id = event.get('target_id') or event.get('drone_id')
            if target_id and target_id in drone_data:
                dm = drone_data[target_id]
                result = event.get('result', '').lower()
                if result == 'success':
                    dm.intercept_result = 'success'
                else:
                    dm.intercept_result = 'fail'
    
    # 미탐 드론 수 계산
    missed_drones = sum(1 for dm in drone_data.values() if dm.t_first_detect is None)
    
    return ExperimentMetrics(
        experiment_id=exp_id,
        duration=duration,
        drone_metrics=list(drone_data.values()),
        total_drones=len(drone_data),
        hostile_drones=sum(1 for dm in drone_data.values() if dm.is_hostile),
        total_detections=total_detections,
        false_alarms=false_alarms,
        missed_drones=missed_drones,
        engage_commands=engage_commands,
        intercept_attempts=intercept_attempts,
        intercept_successes=intercept_successes,
    )


def load_experiments(log_dir: str) -> List[ExperimentMetrics]:
    """디렉토리의 모든 실험 로드"""
    pattern = os.path.join(log_dir, '*.jsonl')
    files = sorted(glob.glob(pattern))
    
    experiments = []
    for filepath in files:
        exp = process_experiment(filepath)
        if exp and exp.total_drones > 0:
            experiments.append(exp)
    
    return experiments


def aggregate_metrics(experiments: List[ExperimentMetrics], mode: str) -> AggregatedMetrics:
    """여러 실험의 지표 집계"""
    agg = AggregatedMetrics(mode=mode, experiments=experiments)
    
    for exp in experiments:
        agg.total_drones += exp.total_drones
        agg.hostile_drones += exp.hostile_drones
        agg.total_detections += exp.total_detections
        agg.false_alarms += exp.false_alarms
        agg.missed_drones += exp.missed_drones
        agg.engage_commands += exp.engage_commands
        agg.intercept_attempts += exp.intercept_attempts
        agg.intercept_successes += exp.intercept_successes
        
        for dm in exp.drone_metrics:
            # 탐지 지연
            if dm.detection_latency is not None:
                agg.detection_latencies.append(dm.detection_latency)
            
            # 융합 트랙 지연
            if dm.fused_track_latency is not None:
                agg.fused_track_latencies.append(dm.fused_track_latency)
            
            # 존재 확률 0.7 도달 지연
            if dm.exist_high_latency is not None:
                agg.exist_high_latencies.append(dm.exist_high_latency)
            
            # 위협 점수 70 도달 지연
            if dm.threat_high_latency is not None:
                agg.threat_high_latencies.append(dm.threat_high_latency)
            
            # 탐지-교전 지연
            if dm.detection_to_engage_delay is not None:
                agg.detection_to_engage_delays.append(dm.detection_to_engage_delay)
            
            # 첫 탐지 센서 분포
            if dm.first_detect_sensor:
                sensor = dm.first_detect_sensor
                agg.first_detect_sensor_counts[sensor] = agg.first_detect_sensor_counts.get(sensor, 0) + 1
            
            # 트랙 파편화
            agg.fragment_counts.append(dm.track_fragment_count)
            
            # 위협 점수 분포
            if dm.is_hostile:
                agg.hostile_threat_scores.append(dm.max_threat_score)
            else:
                agg.non_hostile_threat_scores.append(dm.max_threat_score)
            
            # 분류 결과
            true_label = 'HOSTILE' if dm.is_hostile else 'NON_HOSTILE'
            pred_label = dm.classification_result or 'UNKNOWN'
            if true_label not in agg.classification_results:
                agg.classification_results[true_label] = {}
            agg.classification_results[true_label][pred_label] = \
                agg.classification_results[true_label].get(pred_label, 0) + 1
    
    return agg


# ============================================
# 통계 계산 함수
# ============================================

def calc_stats(values: List[float]) -> Dict[str, float]:
    """기본 통계 계산"""
    if not values:
        return {'mean': 0, 'median': 0, 'std': 0, 'min': 0, 'max': 0, 'count': 0}
    arr = np.array(values)
    return {
        'mean': float(np.mean(arr)),
        'median': float(np.median(arr)),
        'std': float(np.std(arr)),
        'min': float(np.min(arr)),
        'max': float(np.max(arr)),
        'count': len(arr),
    }


def format_stats(stats: Dict[str, float]) -> str:
    """통계를 문자열로 포맷"""
    return f"{stats['mean']:.2f} ± {stats['std']:.2f} (n={stats['count']:.0f})"


# ============================================
# 비교 분석 함수
# ============================================

def compare_metrics(baseline: AggregatedMetrics, fusion: AggregatedMetrics) -> Dict[str, Any]:
    """두 모드의 지표 비교"""
    comparison = {}
    
    # 1. 탐지 지연
    comparison['detection_latency'] = {
        'baseline': calc_stats(baseline.detection_latencies),
        'fusion': calc_stats(fusion.detection_latencies),
    }
    
    # 2. 미탐률
    baseline_miss_rate = baseline.missed_drones / baseline.total_drones if baseline.total_drones > 0 else 0
    fusion_miss_rate = fusion.missed_drones / fusion.total_drones if fusion.total_drones > 0 else 0
    comparison['miss_rate'] = {
        'baseline': baseline_miss_rate,
        'fusion': fusion_miss_rate,
        'improvement': baseline_miss_rate - fusion_miss_rate,
    }
    
    # 3. 오탐률
    baseline_fa_rate = baseline.false_alarms / baseline.total_detections if baseline.total_detections > 0 else 0
    fusion_fa_rate = fusion.false_alarms / fusion.total_detections if fusion.total_detections > 0 else 0
    comparison['false_alarm_rate'] = {
        'baseline': baseline_fa_rate,
        'fusion': fusion_fa_rate,
        'improvement': baseline_fa_rate - fusion_fa_rate,
    }
    
    # 4. 첫 탐지 센서 분포
    comparison['first_detect_sensor'] = {
        'baseline': baseline.first_detect_sensor_counts,
        'fusion': fusion.first_detect_sensor_counts,
    }
    
    # 5. 트랙 파편화
    comparison['track_fragmentation'] = {
        'baseline': calc_stats(baseline.fragment_counts),
        'fusion': calc_stats(fusion.fragment_counts),
    }
    
    # 6. 존재 확률 수렴 속도
    comparison['exist_high_latency'] = {
        'baseline': calc_stats(baseline.exist_high_latencies),
        'fusion': calc_stats(fusion.exist_high_latencies),
    }
    
    # 7. 위협 점수 도달 시간
    comparison['threat_high_latency'] = {
        'baseline': calc_stats(baseline.threat_high_latencies),
        'fusion': calc_stats(fusion.threat_high_latencies),
    }
    
    # 8. 위협 점수 분포
    comparison['threat_score_hostile'] = {
        'baseline': calc_stats(baseline.hostile_threat_scores),
        'fusion': calc_stats(fusion.hostile_threat_scores),
    }
    comparison['threat_score_non_hostile'] = {
        'baseline': calc_stats(baseline.non_hostile_threat_scores),
        'fusion': calc_stats(fusion.non_hostile_threat_scores),
    }
    
    # 9. 탐지-교전 지연
    comparison['detection_to_engage'] = {
        'baseline': calc_stats(baseline.detection_to_engage_delays),
        'fusion': calc_stats(fusion.detection_to_engage_delays),
    }
    
    # 10. 요격 성공률
    baseline_success_rate = baseline.intercept_successes / baseline.intercept_attempts if baseline.intercept_attempts > 0 else 0
    fusion_success_rate = fusion.intercept_successes / fusion.intercept_attempts if fusion.intercept_attempts > 0 else 0
    comparison['intercept_success_rate'] = {
        'baseline': baseline_success_rate,
        'fusion': fusion_success_rate,
        'improvement': fusion_success_rate - baseline_success_rate,
        'baseline_attempts': baseline.intercept_attempts,
        'fusion_attempts': fusion.intercept_attempts,
    }
    
    return comparison


# ============================================
# 시각화 함수
# ============================================

def create_plots(baseline: AggregatedMetrics, fusion: AggregatedMetrics, 
                 comparison: Dict[str, Any], output_dir: str):
    """비교 그래프 생성"""
    os.makedirs(output_dir, exist_ok=True)
    
    fig = plt.figure(figsize=(16, 12))
    fig.suptitle('Baseline vs Fusion 센서 융합 성능 비교', fontsize=16, fontweight='bold')
    
    # 1. 탐지 지연 박스플롯
    ax1 = fig.add_subplot(2, 3, 1)
    data_latency = [
        baseline.detection_latencies if baseline.detection_latencies else [0],
        fusion.detection_latencies if fusion.detection_latencies else [0]
    ]
    bp = ax1.boxplot(data_latency, tick_labels=['Baseline', 'Fusion'], patch_artist=True)
    bp['boxes'][0].set_facecolor('#ff6b6b')
    bp['boxes'][1].set_facecolor('#4ecdc4')
    ax1.set_ylabel('시간 (초)')
    ax1.set_title('① 탐지 지연 (Detection Latency)')
    
    # 2. 첫 탐지 센서 분포
    ax2 = fig.add_subplot(2, 3, 2)
    sensors = ['RADAR', 'AUDIO', 'EO']
    baseline_counts = [baseline.first_detect_sensor_counts.get(s, 0) for s in sensors]
    fusion_counts = [fusion.first_detect_sensor_counts.get(s, 0) for s in sensors]
    x = np.arange(len(sensors))
    width = 0.35
    ax2.bar(x - width/2, baseline_counts, width, label='Baseline', color='#ff6b6b')
    ax2.bar(x + width/2, fusion_counts, width, label='Fusion', color='#4ecdc4')
    ax2.set_xticks(x)
    ax2.set_xticklabels(sensors)
    ax2.set_ylabel('드론 수')
    ax2.set_title('② 첫 탐지 센서 분포')
    ax2.legend()
    
    # 3. 오탐률 / 미탐률 비교
    ax3 = fig.add_subplot(2, 3, 3)
    metrics = ['미탐률', '오탐률']
    baseline_rates = [
        comparison['miss_rate']['baseline'] * 100,
        comparison['false_alarm_rate']['baseline'] * 100
    ]
    fusion_rates = [
        comparison['miss_rate']['fusion'] * 100,
        comparison['false_alarm_rate']['fusion'] * 100
    ]
    x = np.arange(len(metrics))
    ax3.bar(x - width/2, baseline_rates, width, label='Baseline', color='#ff6b6b')
    ax3.bar(x + width/2, fusion_rates, width, label='Fusion', color='#4ecdc4')
    ax3.set_xticks(x)
    ax3.set_xticklabels(metrics)
    ax3.set_ylabel('비율 (%)')
    ax3.set_title('③ 미탐률 / 오탐률 비교')
    ax3.legend()
    
    # 4. 위협 점수 분포 비교
    ax4 = fig.add_subplot(2, 3, 4)
    if baseline.hostile_threat_scores and fusion.hostile_threat_scores:
        ax4.hist(baseline.hostile_threat_scores, bins=20, alpha=0.5, 
                 label='Baseline (적대적)', color='#ff6b6b')
        ax4.hist(fusion.hostile_threat_scores, bins=20, alpha=0.5, 
                 label='Fusion (적대적)', color='#4ecdc4')
    ax4.set_xlabel('위협 점수')
    ax4.set_ylabel('빈도')
    ax4.set_title('④ 적대적 드론 위협 점수 분포')
    ax4.legend()
    
    # 5. 탐지-교전 지연
    ax5 = fig.add_subplot(2, 3, 5)
    data_engage = [
        baseline.detection_to_engage_delays if baseline.detection_to_engage_delays else [0],
        fusion.detection_to_engage_delays if fusion.detection_to_engage_delays else [0]
    ]
    bp2 = ax5.boxplot(data_engage, tick_labels=['Baseline', 'Fusion'], patch_artist=True)
    bp2['boxes'][0].set_facecolor('#ff6b6b')
    bp2['boxes'][1].set_facecolor('#4ecdc4')
    ax5.set_ylabel('시간 (초)')
    ax5.set_title('⑤ 탐지-교전 지연')
    
    # 6. 요격 성공률
    ax6 = fig.add_subplot(2, 3, 6)
    success_rates = [
        comparison['intercept_success_rate']['baseline'] * 100,
        comparison['intercept_success_rate']['fusion'] * 100
    ]
    bars = ax6.bar(['Baseline', 'Fusion'], success_rates, color=['#ff6b6b', '#4ecdc4'])
    ax6.set_ylabel('성공률 (%)')
    ax6.set_title('⑥ 요격 성공률')
    for bar, rate in zip(bars, success_rates):
        ax6.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1,
                f'{rate:.1f}%', ha='center', fontweight='bold')
    
    plt.tight_layout(rect=[0, 0, 1, 0.95])
    plt.savefig(os.path.join(output_dir, 'fusion_vs_baseline_comparison.png'), 
                dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    
    print(f"📊 그래프 저장: {output_dir}/fusion_vs_baseline_comparison.png")


# ============================================
# 리포트 생성 함수
# ============================================

def generate_report(baseline: AggregatedMetrics, fusion: AggregatedMetrics,
                   comparison: Dict[str, Any], output_path: str):
    """마크다운 리포트 생성"""
    
    report = []
    report.append("# Baseline vs Fusion 센서 융합 성능 비교 리포트\n")
    report.append(f"생성 시각: {Path(__file__).stat().st_mtime}\n")
    
    # 실험 개요
    report.append("\n## 1. 실험 개요\n")
    report.append("| 항목 | Baseline | Fusion |")
    report.append("|------|----------|--------|")
    report.append(f"| 실험 횟수 | {len(baseline.experiments)} | {len(fusion.experiments)} |")
    report.append(f"| 총 드론 수 | {baseline.total_drones} | {fusion.total_drones} |")
    report.append(f"| 적대적 드론 | {baseline.hostile_drones} | {fusion.hostile_drones} |")
    report.append(f"| 총 탐지 이벤트 | {baseline.total_detections} | {fusion.total_detections} |")
    
    # 탐지 성능
    report.append("\n## 2. 탐지 성능\n")
    report.append("### 2.1 탐지 지연 (Detection Latency)\n")
    report.append("| 지표 | Baseline | Fusion | 개선 |")
    report.append("|------|----------|--------|------|")
    bl = comparison['detection_latency']['baseline']
    fu = comparison['detection_latency']['fusion']
    improvement = bl['mean'] - fu['mean'] if bl['count'] > 0 and fu['count'] > 0 else 0
    report.append(f"| 평균 | {bl['mean']:.2f}초 | {fu['mean']:.2f}초 | {improvement:+.2f}초 |")
    report.append(f"| 중앙값 | {bl['median']:.2f}초 | {fu['median']:.2f}초 | - |")
    report.append(f"| 표준편차 | {bl['std']:.2f} | {fu['std']:.2f} | - |")
    
    report.append("\n### 2.2 미탐률 / 오탐률\n")
    report.append("| 지표 | Baseline | Fusion | 개선 |")
    report.append("|------|----------|--------|------|")
    report.append(f"| 미탐률 | {comparison['miss_rate']['baseline']*100:.2f}% | {comparison['miss_rate']['fusion']*100:.2f}% | {comparison['miss_rate']['improvement']*100:+.2f}%p |")
    report.append(f"| 오탐률 | {comparison['false_alarm_rate']['baseline']*100:.2f}% | {comparison['false_alarm_rate']['fusion']*100:.2f}% | {comparison['false_alarm_rate']['improvement']*100:+.2f}%p |")
    
    report.append("\n### 2.3 첫 탐지 센서 분포\n")
    report.append("| 센서 | Baseline | Fusion |")
    report.append("|------|----------|--------|")
    for sensor in ['RADAR', 'AUDIO', 'EO']:
        bl_cnt = baseline.first_detect_sensor_counts.get(sensor, 0)
        fu_cnt = fusion.first_detect_sensor_counts.get(sensor, 0)
        report.append(f"| {sensor} | {bl_cnt} | {fu_cnt} |")
    
    # 트래킹 성능
    report.append("\n## 3. 트래킹 성능\n")
    report.append("### 3.1 트랙 파편화\n")
    tf_bl = comparison['track_fragmentation']['baseline']
    tf_fu = comparison['track_fragmentation']['fusion']
    report.append(f"- Baseline: 평균 {tf_bl['mean']:.2f}개 트랙/드론")
    report.append(f"- Fusion: 평균 {tf_fu['mean']:.2f}개 트랙/드론")
    
    if fusion.exist_high_latencies:
        report.append("\n### 3.2 존재 확률 수렴 속도 (P≥0.7 도달 시간)\n")
        eh_bl = comparison['exist_high_latency']['baseline']
        eh_fu = comparison['exist_high_latency']['fusion']
        report.append(f"- Baseline: {eh_bl['mean']:.2f}초 (n={eh_bl['count']:.0f})")
        report.append(f"- Fusion: {eh_fu['mean']:.2f}초 (n={eh_fu['count']:.0f})")
    
    # 위협 평가
    report.append("\n## 4. 위협 평가 성능\n")
    report.append("### 4.1 적대적 드론 위협 점수\n")
    ts_bl = comparison['threat_score_hostile']['baseline']
    ts_fu = comparison['threat_score_hostile']['fusion']
    report.append(f"- Baseline: 평균 {ts_bl['mean']:.1f} (n={ts_bl['count']:.0f})")
    report.append(f"- Fusion: 평균 {ts_fu['mean']:.1f} (n={ts_fu['count']:.0f})")
    
    if comparison['threat_high_latency']['fusion']['count'] > 0:
        report.append("\n### 4.2 위협 점수 70 도달 시간\n")
        th_bl = comparison['threat_high_latency']['baseline']
        th_fu = comparison['threat_high_latency']['fusion']
        report.append(f"- Baseline: {th_bl['mean']:.2f}초")
        report.append(f"- Fusion: {th_fu['mean']:.2f}초")
    
    # 교전/요격
    report.append("\n## 5. 교전 및 요격 성능\n")
    report.append("### 5.1 탐지-교전 지연\n")
    de_bl = comparison['detection_to_engage']['baseline']
    de_fu = comparison['detection_to_engage']['fusion']
    report.append(f"- Baseline: 평균 {de_bl['mean']:.2f}초")
    report.append(f"- Fusion: 평균 {de_fu['mean']:.2f}초")
    
    report.append("\n### 5.2 요격 성공률\n")
    isr = comparison['intercept_success_rate']
    report.append(f"- Baseline: {isr['baseline']*100:.1f}% ({baseline.intercept_successes}/{isr['baseline_attempts']})")
    report.append(f"- Fusion: {isr['fusion']*100:.1f}% ({fusion.intercept_successes}/{isr['fusion_attempts']})")
    report.append(f"- 개선: {isr['improvement']*100:+.1f}%p")
    
    # 결론
    report.append("\n## 6. 결론\n")
    improvements = []
    if comparison['detection_latency']['baseline']['mean'] > comparison['detection_latency']['fusion']['mean']:
        improvements.append("탐지 지연 감소")
    if comparison['miss_rate']['improvement'] > 0:
        improvements.append("미탐률 개선")
    if comparison['false_alarm_rate']['improvement'] > 0:
        improvements.append("오탐률 감소")
    if isr['improvement'] > 0:
        improvements.append("요격 성공률 향상")
    
    if improvements:
        report.append("### 센서 융합 도입 효과:")
        for imp in improvements:
            report.append(f"- ✅ {imp}")
    else:
        report.append("### 센서 융합 효과:")
        report.append("- ⚠️ 유의미한 개선이 확인되지 않음 (추가 실험 필요)")
    
    # 파일 저장
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(report))
    
    print(f"📝 리포트 저장: {output_path}")


def print_summary(comparison: Dict[str, Any]):
    """터미널에 요약 출력"""
    print("\n" + "="*60)
    print("📊 Baseline vs Fusion 성능 비교 요약")
    print("="*60)
    
    print("\n[탐지 성능]")
    print(f"  탐지 지연:")
    print(f"    - Baseline: {format_stats(comparison['detection_latency']['baseline'])}")
    print(f"    - Fusion:   {format_stats(comparison['detection_latency']['fusion'])}")
    
    print(f"\n  미탐률: {comparison['miss_rate']['baseline']*100:.2f}% → {comparison['miss_rate']['fusion']*100:.2f}%")
    print(f"  오탐률: {comparison['false_alarm_rate']['baseline']*100:.2f}% → {comparison['false_alarm_rate']['fusion']*100:.2f}%")
    
    print("\n[트래킹 성능]")
    print(f"  트랙 파편화:")
    print(f"    - Baseline: {format_stats(comparison['track_fragmentation']['baseline'])}")
    print(f"    - Fusion:   {format_stats(comparison['track_fragmentation']['fusion'])}")
    
    print("\n[위협 평가]")
    print(f"  적대적 드론 위협 점수:")
    print(f"    - Baseline: {format_stats(comparison['threat_score_hostile']['baseline'])}")
    print(f"    - Fusion:   {format_stats(comparison['threat_score_hostile']['fusion'])}")
    
    print("\n[교전/요격]")
    print(f"  탐지-교전 지연:")
    print(f"    - Baseline: {format_stats(comparison['detection_to_engage']['baseline'])}")
    print(f"    - Fusion:   {format_stats(comparison['detection_to_engage']['fusion'])}")
    
    isr = comparison['intercept_success_rate']
    print(f"\n  요격 성공률: {isr['baseline']*100:.1f}% → {isr['fusion']*100:.1f}% ({isr['improvement']*100:+.1f}%p)")
    
    print("\n" + "="*60)


# ============================================
# 메인 함수
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description='Baseline vs Fusion 센서 융합 성능 비교 분석'
    )
    parser.add_argument(
        '--baseline_dir', 
        type=str, 
        default='../simulator/logs/baseline',
        help='Baseline 실험 로그 디렉토리'
    )
    parser.add_argument(
        '--fusion_dir', 
        type=str, 
        default='../simulator/logs/fusion',
        help='Fusion 실험 로그 디렉토리'
    )
    parser.add_argument(
        '--output_dir',
        type=str,
        default='reports/fusion_comparison',
        help='그래프 출력 디렉토리'
    )
    parser.add_argument(
        '--report',
        type=str,
        default='reports/fusion_vs_baseline.md',
        help='리포트 파일 경로'
    )
    
    args = parser.parse_args()
    
    # 디렉토리 확인
    if not os.path.exists(args.baseline_dir):
        print(f"⚠️ Baseline 디렉토리가 존재하지 않습니다: {args.baseline_dir}")
        print("   먼저 Baseline 실험을 실행하세요:")
        print("   cd ../simulator && npm run batch -- 30 60 12345")
        return
    
    if not os.path.exists(args.fusion_dir):
        print(f"⚠️ Fusion 디렉토리가 존재하지 않습니다: {args.fusion_dir}")
        print("   먼저 Fusion 실험을 실행하세요 (센서 융합 활성화 후):")
        print("   cd ../simulator && npm run batch -- 30 60 12345")
        return
    
    # 실험 로드
    print(f"\n📂 Baseline 로그 로드 중: {args.baseline_dir}")
    baseline_experiments = load_experiments(args.baseline_dir)
    print(f"   {len(baseline_experiments)}개 실험 로드")
    
    print(f"\n📂 Fusion 로그 로드 중: {args.fusion_dir}")
    fusion_experiments = load_experiments(args.fusion_dir)
    print(f"   {len(fusion_experiments)}개 실험 로드")
    
    if not baseline_experiments or not fusion_experiments:
        print("\n⚠️ 실험 데이터가 부족합니다.")
        return
    
    # 집계
    baseline_agg = aggregate_metrics(baseline_experiments, 'baseline')
    fusion_agg = aggregate_metrics(fusion_experiments, 'fusion')
    
    # 비교
    comparison = compare_metrics(baseline_agg, fusion_agg)
    
    # 결과 출력
    print_summary(comparison)
    
    # 그래프 생성
    create_plots(baseline_agg, fusion_agg, comparison, args.output_dir)
    
    # 리포트 생성
    generate_report(baseline_agg, fusion_agg, comparison, args.report)
    
    print("\n✅ 분석 완료!")


if __name__ == '__main__':
    main()

