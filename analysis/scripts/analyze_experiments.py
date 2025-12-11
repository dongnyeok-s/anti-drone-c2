"""
대드론 C2 시뮬레이션 실험 데이터 분석 스크립트

JSONL 로그 파일을 분석하여 연구 지표를 계산합니다.

사용법:
    python analyze_experiments.py                    # 모든 로그 분석
    python analyze_experiments.py --file <path>      # 특정 파일 분석
    python analyze_experiments.py --summary          # 요약만 출력
"""

import json
import os
import glob
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from collections import defaultdict
import argparse

# pandas/matplotlib은 선택적 (없어도 기본 분석 가능)
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

try:
    import matplotlib.pyplot as plt
    import matplotlib
    
    # macOS 한글 폰트 설정 (Apple SD Gothic Neo)
    plt.rcParams['font.family'] = 'Apple SD Gothic Neo'
    plt.rcParams['axes.unicode_minus'] = False
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False


# ============================================
# 데이터 클래스
# ============================================

@dataclass
class DroneStats:
    """드론별 통계"""
    drone_id: str
    spawn_time: float = 0
    first_radar_detection_time: Optional[float] = None
    first_audio_detection_time: Optional[float] = None
    radar_detection_count: int = 0
    was_engaged: bool = False
    was_neutralized: bool = False
    engagement_time: Optional[float] = None
    neutralization_time: Optional[float] = None
    behavior: str = "UNKNOWN"
    is_hostile: bool = True


@dataclass
class InterceptorStats:
    """요격기별 통계"""
    interceptor_id: str
    spawn_time: float = 0
    target_id: Optional[str] = None
    attempts: int = 0
    successes: int = 0
    failures: int = 0


@dataclass
class ExperimentAnalysis:
    """실험 분석 결과"""
    experiment_id: str
    scenario_id: str
    duration: float = 0
    
    # 드론 통계
    total_drones: int = 0
    hostile_drones: int = 0
    drones: Dict[str, DroneStats] = field(default_factory=dict)
    
    # 탐지 통계
    radar_detections: int = 0
    audio_detections: int = 0
    false_alarms: int = 0
    
    # 요격 통계
    total_interceptors: int = 0
    interceptors: Dict[str, InterceptorStats] = field(default_factory=dict)
    engage_commands: int = 0
    intercept_attempts: int = 0
    intercept_successes: int = 0
    intercept_failures: int = 0
    
    # 지연 시간 통계
    detection_delays: List[float] = field(default_factory=list)
    engagement_delays: List[float] = field(default_factory=list)


# ============================================
# JSONL 파서
# ============================================

def parse_jsonl_file(filepath: str) -> List[Dict[str, Any]]:
    """JSONL 파일을 파싱하여 이벤트 리스트 반환"""
    events = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                events.append(event)
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON 파싱 에러 (라인 {line_num}): {e}")
    return events


def analyze_experiment(events: List[Dict[str, Any]]) -> ExperimentAnalysis:
    """이벤트 리스트를 분석하여 ExperimentAnalysis 반환"""
    analysis = ExperimentAnalysis(
        experiment_id="unknown",
        scenario_id="unknown"
    )
    
    for event in events:
        event_type = event.get('event') or event.get('type', 'unknown')
        timestamp = event.get('timestamp', 0)
        
        # 시나리오 시작
        if event_type == 'scenario_start':
            analysis.experiment_id = str(event.get('scenario_id', 'unknown'))
            analysis.scenario_id = str(event.get('scenario_id', 'unknown'))
            config = event.get('config', {})
            analysis.total_drones = config.get('drone_count', 0)
            analysis.total_interceptors = config.get('interceptor_count', 0)
        
        # 시나리오 종료
        elif event_type == 'scenario_end':
            analysis.duration = event.get('duration', timestamp)
        
        # 드론 생성
        elif event_type == 'drone_spawned':
            drone_id = event.get('drone_id', '')
            analysis.drones[drone_id] = DroneStats(
                drone_id=drone_id,
                spawn_time=timestamp,
                behavior=event.get('behavior', 'UNKNOWN'),
                is_hostile=event.get('is_hostile', True)
            )
            if event.get('is_hostile', True):
                analysis.hostile_drones += 1
        
        # 레이더 탐지
        elif event_type == 'radar_detection':
            analysis.radar_detections += 1
            drone_id = event.get('drone_id', '')
            
            if event.get('is_false_alarm'):
                analysis.false_alarms += 1
            elif drone_id in analysis.drones:
                drone = analysis.drones[drone_id]
                drone.radar_detection_count += 1
                
                # 첫 탐지 시간 기록
                if drone.first_radar_detection_time is None:
                    drone.first_radar_detection_time = timestamp
                    delay = timestamp - drone.spawn_time
                    analysis.detection_delays.append(delay)
        
        # 음향 탐지
        elif event_type == 'audio_detection':
            analysis.audio_detections += 1
            drone_id = event.get('drone_id', '')
            
            if drone_id in analysis.drones:
                drone = analysis.drones[drone_id]
                if drone.first_audio_detection_time is None:
                    drone.first_audio_detection_time = timestamp
        
        # 교전 명령
        elif event_type == 'engage_command':
            analysis.engage_commands += 1
            drone_id = event.get('drone_id', '')
            
            if drone_id in analysis.drones:
                drone = analysis.drones[drone_id]
                if not drone.was_engaged:
                    drone.was_engaged = True
                    drone.engagement_time = timestamp
                    
                    # 탐지 → 교전 지연 시간
                    if drone.first_radar_detection_time:
                        delay = timestamp - drone.first_radar_detection_time
                        analysis.engagement_delays.append(delay)
        
        # 요격기 생성
        elif event_type == 'interceptor_spawned':
            int_id = event.get('interceptor_id', '')
            analysis.interceptors[int_id] = InterceptorStats(
                interceptor_id=int_id,
                spawn_time=timestamp,
                target_id=event.get('target_id')
            )
        
        # 요격 시도
        elif event_type == 'intercept_attempt':
            analysis.intercept_attempts += 1
            int_id = event.get('interceptor_id', '')
            if int_id in analysis.interceptors:
                analysis.interceptors[int_id].attempts += 1
        
        # 요격 결과
        elif event_type == 'intercept_result':
            result = event.get('result', '').lower()
            int_id = event.get('interceptor_id', '')
            drone_id = event.get('target_id', '')
            
            # 결과에 따라 카운트 안 된 경우 여기서 증가
            if result == 'success':
                analysis.intercept_successes += 1
                if int_id in analysis.interceptors:
                    analysis.interceptors[int_id].successes += 1
                if drone_id in analysis.drones:
                    analysis.drones[drone_id].was_neutralized = True
                    analysis.drones[drone_id].neutralization_time = timestamp
            else:
                analysis.intercept_failures += 1
                if int_id in analysis.interceptors:
                    analysis.interceptors[int_id].failures += 1
    
    return analysis


# ============================================
# 지표 계산
# ============================================

def calculate_metrics(analyses: List[ExperimentAnalysis]) -> Dict[str, Any]:
    """여러 실험 분석 결과에서 연구 지표 계산"""
    
    metrics = {
        'experiment_count': len(analyses),
        
        # 탐지 지표
        'detection': {
            'total_radar_detections': sum(a.radar_detections for a in analyses),
            'total_audio_detections': sum(a.audio_detections for a in analyses),
            'total_false_alarms': sum(a.false_alarms for a in analyses),
            'avg_detection_delay': 0,
            'min_detection_delay': 0,
            'max_detection_delay': 0,
            'false_alarm_rate': 0,
        },
        
        # 교전 지표
        'engagement': {
            'total_engage_commands': sum(a.engage_commands for a in analyses),
            'avg_engagement_delay': 0,
            'drones_engaged_ratio': 0,
        },
        
        # 요격 지표
        'interception': {
            'total_attempts': sum(a.intercept_attempts for a in analyses),
            'total_successes': sum(a.intercept_successes for a in analyses),
            'total_failures': sum(a.intercept_failures for a in analyses),
            'success_rate': 0,
            'neutralization_rate': 0,
        },
        
        # 드론별 통계
        'drones': {
            'total': sum(a.total_drones for a in analyses),
            'hostile': sum(a.hostile_drones for a in analyses),
            'detected': 0,
            'engaged': 0,
            'neutralized': 0,
        },
    }
    
    # 탐지 지연 시간 계산
    all_detection_delays = []
    all_engagement_delays = []
    detected_count = 0
    engaged_count = 0
    neutralized_count = 0
    
    for analysis in analyses:
        all_detection_delays.extend(analysis.detection_delays)
        all_engagement_delays.extend(analysis.engagement_delays)
        
        for drone in analysis.drones.values():
            if drone.first_radar_detection_time is not None:
                detected_count += 1
            if drone.was_engaged:
                engaged_count += 1
            if drone.was_neutralized:
                neutralized_count += 1
    
    if all_detection_delays:
        metrics['detection']['avg_detection_delay'] = round(sum(all_detection_delays) / len(all_detection_delays), 2)
        metrics['detection']['min_detection_delay'] = round(min(all_detection_delays), 2)
        metrics['detection']['max_detection_delay'] = round(max(all_detection_delays), 2)
    
    if all_engagement_delays:
        metrics['engagement']['avg_engagement_delay'] = round(sum(all_engagement_delays) / len(all_engagement_delays), 2)
    
    # 비율 계산
    total_detections = metrics['detection']['total_radar_detections']
    false_alarms = metrics['detection']['total_false_alarms']
    if total_detections > 0:
        metrics['detection']['false_alarm_rate'] = round(false_alarms / total_detections * 100, 2)
    
    total_attempts = metrics['interception']['total_attempts']
    total_successes = metrics['interception']['total_successes']
    if total_attempts > 0:
        metrics['interception']['success_rate'] = round(total_successes / total_attempts * 100, 2)
    
    total_hostile = metrics['drones']['hostile']
    if total_hostile > 0:
        metrics['interception']['neutralization_rate'] = round(neutralized_count / total_hostile * 100, 2)
        metrics['engagement']['drones_engaged_ratio'] = round(engaged_count / total_hostile * 100, 2)
    
    metrics['drones']['detected'] = detected_count
    metrics['drones']['engaged'] = engaged_count
    metrics['drones']['neutralized'] = neutralized_count
    
    return metrics


# ============================================
# 시각화 (matplotlib 필요)
# ============================================

def plot_metrics(metrics: Dict[str, Any], output_dir: str = '.'):
    """지표 시각화"""
    if not HAS_MATPLOTLIB:
        print("⚠️ matplotlib가 설치되지 않아 그래프를 생성할 수 없습니다.")
        print("   pip install matplotlib 로 설치해주세요.")
        return
    
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    fig.suptitle('대드론 C2 시뮬레이션 실험 분석', fontsize=14, fontweight='bold')
    
    # 1. 탐지 통계
    ax1 = axes[0, 0]
    detection_data = [
        metrics['detection']['total_radar_detections'],
        metrics['detection']['total_audio_detections'],
        metrics['detection']['total_false_alarms'],
    ]
    bars = ax1.bar(['레이더 탐지', '음향 탐지', '오탐'], detection_data, 
                   color=['#3498db', '#2ecc71', '#e74c3c'])
    ax1.set_title('탐지 통계')
    ax1.set_ylabel('횟수')
    for bar, val in zip(bars, detection_data):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5, 
                str(val), ha='center', va='bottom')
    
    # 2. 요격 결과
    ax2 = axes[0, 1]
    intercept_data = [
        metrics['interception']['total_successes'],
        metrics['interception']['total_failures'],
    ]
    colors = ['#27ae60', '#c0392b']
    wedges, texts, autotexts = ax2.pie(
        intercept_data if sum(intercept_data) > 0 else [1],
        labels=['성공', '실패'] if sum(intercept_data) > 0 else ['데이터 없음'],
        colors=colors if sum(intercept_data) > 0 else ['#95a5a6'],
        autopct='%1.1f%%' if sum(intercept_data) > 0 else '',
        startangle=90
    )
    ax2.set_title(f'요격 성공률: {metrics["interception"]["success_rate"]}%')
    
    # 3. 드론 상태
    ax3 = axes[1, 0]
    drone_data = [
        metrics['drones']['detected'],
        metrics['drones']['engaged'],
        metrics['drones']['neutralized'],
    ]
    x_pos = range(len(drone_data))
    bars = ax3.bar(x_pos, drone_data, color=['#3498db', '#f39c12', '#27ae60'])
    ax3.set_xticks(x_pos)
    ax3.set_xticklabels(['탐지됨', '교전됨', '무력화'])
    ax3.set_title(f'드론 상태 (총 {metrics["drones"]["hostile"]}기)')
    ax3.set_ylabel('드론 수')
    for bar, val in zip(bars, drone_data):
        ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, 
                str(val), ha='center', va='bottom')
    
    # 4. 주요 지표 텍스트
    ax4 = axes[1, 1]
    ax4.axis('off')
    summary_text = f"""
    📊 주요 연구 지표
    
    ▶ 탐지 성능
      - 평균 탐지 지연: {metrics['detection']['avg_detection_delay']}초
      - 최소/최대: {metrics['detection']['min_detection_delay']}초 / {metrics['detection']['max_detection_delay']}초
      - 오탐률: {metrics['detection']['false_alarm_rate']}%
    
    ▶ 교전 효율
      - 평균 교전 지연: {metrics['engagement']['avg_engagement_delay']}초
      - 교전 비율: {metrics['engagement']['drones_engaged_ratio']}%
    
    ▶ 요격 성능
      - 요격 성공률: {metrics['interception']['success_rate']}%
      - 무력화율: {metrics['interception']['neutralization_rate']}%
    
    ▶ 실험 정보
      - 총 실험 횟수: {metrics['experiment_count']}회
      - 총 드론 수: {metrics['drones']['total']}기
    """
    ax4.text(0.1, 0.9, summary_text, transform=ax4.transAxes, 
             fontsize=10, verticalalignment='top',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    
    plt.tight_layout()
    
    output_path = os.path.join(output_dir, 'experiment_analysis.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"\n📈 그래프 저장: {output_path}")
    plt.show()


def create_dataframe(analyses: List[ExperimentAnalysis]) -> 'pd.DataFrame':
    """분석 결과를 pandas DataFrame으로 변환"""
    if not HAS_PANDAS:
        print("⚠️ pandas가 설치되지 않아 DataFrame을 생성할 수 없습니다.")
        return None
    
    data = []
    for a in analyses:
        avg_detection_delay = sum(a.detection_delays) / len(a.detection_delays) if a.detection_delays else 0
        avg_engagement_delay = sum(a.engagement_delays) / len(a.engagement_delays) if a.engagement_delays else 0
        
        data.append({
            'experiment_id': a.experiment_id,
            'scenario_id': a.scenario_id,
            'duration': a.duration,
            'total_drones': a.total_drones,
            'hostile_drones': a.hostile_drones,
            'radar_detections': a.radar_detections,
            'audio_detections': a.audio_detections,
            'false_alarms': a.false_alarms,
            'engage_commands': a.engage_commands,
            'intercept_attempts': a.intercept_attempts,
            'intercept_successes': a.intercept_successes,
            'intercept_failures': a.intercept_failures,
            'success_rate': a.intercept_successes / a.intercept_attempts * 100 if a.intercept_attempts > 0 else 0,
            'avg_detection_delay': avg_detection_delay,
            'avg_engagement_delay': avg_engagement_delay,
        })
    
    return pd.DataFrame(data)


# ============================================
# 메인
# ============================================

def main():
    parser = argparse.ArgumentParser(description='대드론 C2 시뮬레이션 실험 데이터 분석')
    parser.add_argument('--file', '-f', type=str, help='분석할 특정 JSONL 파일')
    parser.add_argument('--dir', '-d', type=str, default='../simulator/logs', help='로그 디렉토리')
    parser.add_argument('--summary', '-s', action='store_true', help='요약만 출력')
    parser.add_argument('--no-plot', action='store_true', help='그래프 생성 안 함')
    parser.add_argument('--csv', type=str, help='결과를 CSV로 저장')
    args = parser.parse_args()
    
    print("\n🔬 대드론 C2 시뮬레이션 실험 데이터 분석기\n")
    print("=" * 60)
    
    # 파일 찾기
    if args.file:
        files = [args.file]
    else:
        log_dir = args.dir
        pattern = os.path.join(log_dir, '*.jsonl')
        files = glob.glob(pattern)
        
        if not files:
            print(f"⚠️ 로그 파일을 찾을 수 없습니다: {pattern}")
            print("   --dir 옵션으로 로그 디렉토리를 지정하세요.")
            return
    
    print(f"📂 분석할 파일: {len(files)}개\n")
    
    # 분석 실행
    analyses = []
    for filepath in sorted(files):
        filename = os.path.basename(filepath)
        print(f"  분석 중: {filename}")
        
        events = parse_jsonl_file(filepath)
        if events:
            analysis = analyze_experiment(events)
            analyses.append(analysis)
            print(f"    → {len(events)}개 이벤트, {analysis.radar_detections}회 탐지, {analysis.intercept_successes}/{analysis.intercept_attempts} 요격")
    
    if not analyses:
        print("\n⚠️ 분석할 데이터가 없습니다.")
        return
    
    # 지표 계산
    metrics = calculate_metrics(analyses)
    
    # 결과 출력
    print("\n" + "=" * 60)
    print("📊 분석 결과")
    print("=" * 60)
    
    print(f"""
🎯 탐지 성능
   - 총 레이더 탐지: {metrics['detection']['total_radar_detections']}회
   - 총 음향 탐지: {metrics['detection']['total_audio_detections']}회
   - 오탐: {metrics['detection']['total_false_alarms']}회 ({metrics['detection']['false_alarm_rate']}%)
   - 평균 탐지 지연: {metrics['detection']['avg_detection_delay']}초

⚔️ 교전 효율
   - 총 교전 명령: {metrics['engagement']['total_engage_commands']}회
   - 교전 비율: {metrics['engagement']['drones_engaged_ratio']}%
   - 평균 교전 지연: {metrics['engagement']['avg_engagement_delay']}초

🚀 요격 성능
   - 요격 시도: {metrics['interception']['total_attempts']}회
   - 요격 성공: {metrics['interception']['total_successes']}회
   - 요격 실패: {metrics['interception']['total_failures']}회
   - 성공률: {metrics['interception']['success_rate']}%
   - 무력화율: {metrics['interception']['neutralization_rate']}%

🛸 드론 통계
   - 총 드론: {metrics['drones']['total']}기 (적대적: {metrics['drones']['hostile']}기)
   - 탐지됨: {metrics['drones']['detected']}기
   - 교전됨: {metrics['drones']['engaged']}기
   - 무력화: {metrics['drones']['neutralized']}기
""")
    
    # CSV 저장
    if args.csv and HAS_PANDAS:
        df = create_dataframe(analyses)
        if df is not None:
            df.to_csv(args.csv, index=False, encoding='utf-8-sig')
            print(f"\n💾 CSV 저장: {args.csv}")
    
    # 그래프 생성
    if not args.no_plot and not args.summary:
        output_dir = os.path.dirname(os.path.abspath(__file__))
        plot_metrics(metrics, output_dir)
    
    # JSON으로 지표 저장
    metrics_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'metrics.json')
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print(f"💾 지표 저장: {metrics_path}")


if __name__ == '__main__':
    main()

