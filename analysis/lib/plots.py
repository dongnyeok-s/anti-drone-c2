"""
실험 결과 시각화 모듈

다양한 그래프와 차트를 생성합니다.
"""

import os
from typing import List, Dict, Any, Optional, Tuple

try:
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.gridspec import GridSpec
    
    # macOS 한글 폰트 설정
    plt.rcParams['font.family'] = 'Apple SD Gothic Neo'
    plt.rcParams['axes.unicode_minus'] = False
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    print("⚠️ matplotlib가 설치되지 않았습니다. pip install matplotlib")

# 색상 팔레트
COLORS = {
    'primary': '#3498db',
    'success': '#27ae60',
    'danger': '#e74c3c',
    'warning': '#f39c12',
    'info': '#17a2b8',
    'secondary': '#95a5a6',
    'purple': '#9b59b6',
    'dark': '#2c3e50',
    
    # 탐지 유형
    'radar': '#3498db',
    'audio': '#2ecc71',
    'false_alarm': '#e74c3c',
    
    # 오탐 유형
    'no_object': '#e74c3c',
    'misclassification': '#f39c12',
    'tracking_error': '#9b59b6',
    
    # 드론 상태
    'detected': '#3498db',
    'engaged': '#f39c12',
    'neutralized': '#27ae60',
    
    # 요격 결과
    'intercept_success': '#27ae60',
    'intercept_fail': '#e74c3c',
}


def create_figure_header(fig, metrics: Dict[str, Any], title: str = "대드론 C2 시뮬레이션 분석"):
    """그래프 상단 헤더 생성"""
    header_text = (
        f"{title}  |  "
        f"실험 {metrics['experiment_count']}회  |  "
        f"드론 {metrics['drones']['total']}기  |  "
        f"레이더 탐지 {metrics['detection']['total_radar']}회"
    )
    fig.suptitle(header_text, fontsize=12, fontweight='bold', y=0.98)


def plot_detection_stats(ax, metrics: Dict[str, Any]):
    """탐지 통계 바 차트"""
    radar = metrics['detection']['total_radar']
    audio = metrics['detection']['total_audio']
    false_alarm = metrics['detection']['false_alarm_total']
    
    # 음향 탐지 라벨 처리
    if not metrics['detection']['audio_model_active']:
        audio_label = '음향 탐지\n(비활성화)'
    elif audio == 0:
        audio_label = '음향 탐지\n(0회/활성)'
    else:
        audio_label = '음향 탐지'
    
    labels = ['레이더 탐지', audio_label, '오탐']
    values = [radar, audio, false_alarm]
    colors = [COLORS['radar'], COLORS['audio'], COLORS['false_alarm']]
    
    # 음향 비활성화 시 회색 처리
    if not metrics['detection']['audio_model_active']:
        colors[1] = COLORS['secondary']
    
    bars = ax.bar(labels, values, color=colors, edgecolor='white', linewidth=1.5)
    ax.set_title('탐지 통계', fontsize=11, fontweight='bold')
    ax.set_ylabel('횟수')
    
    for bar, val in zip(bars, values):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(values)*0.02, 
                   str(val), ha='center', va='bottom', fontsize=10, fontweight='bold')
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)


def plot_false_alarm_breakdown(ax, metrics: Dict[str, Any]):
    """오탐 유형 분류 파이차트"""
    breakdown = metrics['detection']['false_alarm_breakdown']
    
    values = [breakdown['no_object'], breakdown['misclassification'], breakdown['tracking_error']]
    labels = ['객체 없음', '오분류', '추적 오류']
    colors = [COLORS['no_object'], COLORS['misclassification'], COLORS['tracking_error']]
    
    total = sum(values)
    if total == 0:
        ax.text(0.5, 0.5, '오탐 없음', ha='center', va='center', fontsize=12,
               transform=ax.transAxes)
        ax.axis('off')
        return
    
    # 0인 값 제거
    filtered = [(l, v, c) for l, v, c in zip(labels, values, colors) if v > 0]
    if filtered:
        labels, values, colors = zip(*filtered)
    
    wedges, texts, autotexts = ax.pie(
        values, labels=labels, colors=colors,
        autopct=lambda p: f'{p:.1f}%' if p > 5 else '',
        startangle=90, pctdistance=0.7
    )
    ax.set_title(f'오탐 유형 분류 (총 {total}회)', fontsize=11, fontweight='bold')


def plot_intercept_result(ax, metrics: Dict[str, Any]):
    """요격 결과 파이차트"""
    successes = metrics['interception']['successes']
    failures = metrics['interception']['failures']
    total = successes + failures
    
    if total == 0:
        ax.text(0.5, 0.5, '요격 시도 없음', ha='center', va='center', fontsize=12,
               transform=ax.transAxes)
        ax.axis('off')
        return
    
    values = [successes, failures]
    labels = ['성공', '실패']
    colors = [COLORS['intercept_success'], COLORS['intercept_fail']]
    
    wedges, texts, autotexts = ax.pie(
        values, labels=labels, colors=colors,
        autopct='%1.1f%%', startangle=90
    )
    
    success_rate = metrics['interception']['success_rate']
    ax.set_title(f'요격 성공률: {success_rate}%', fontsize=11, fontweight='bold')


def plot_intercept_failure_reasons(ax, metrics: Dict[str, Any]):
    """요격 실패 원인 바 차트"""
    failure_reasons = metrics['interception']['failure_reasons']
    
    if not failure_reasons or sum(failure_reasons.values()) == 0:
        ax.text(0.5, 0.5, '실패 데이터 없음', ha='center', va='center', fontsize=12,
               transform=ax.transAxes)
        ax.axis('off')
        return
    
    # 번역된 라벨
    label_map = {
        'evaded': '회피 성공',
        'distance_exceeded': '거리 초과',
        'timeout': '시간 초과',
        'low_speed': '속도 부족',
        'sensor_error': '센서 오류',
        'target_lost': '타겟 손실',
        'other': '기타',
    }
    
    sorted_reasons = sorted(failure_reasons.items(), key=lambda x: x[1], reverse=True)
    labels = [label_map.get(k, k) for k, v in sorted_reasons if v > 0]
    values = [v for k, v in sorted_reasons if v > 0]
    
    if not values:
        ax.text(0.5, 0.5, '실패 데이터 없음', ha='center', va='center', fontsize=12,
               transform=ax.transAxes)
        ax.axis('off')
        return
    
    colors = plt.cm.Reds(range(50, 250, 200 // len(values)))[::-1]
    
    bars = ax.barh(labels, values, color=colors, edgecolor='white')
    ax.set_title('요격 실패 원인 분석', fontsize=11, fontweight='bold')
    ax.set_xlabel('횟수')
    ax.invert_yaxis()
    
    for bar, val in zip(bars, values):
        ax.text(bar.get_width() + max(values)*0.02, bar.get_y() + bar.get_height()/2,
               str(val), ha='left', va='center', fontsize=9)
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)


def plot_drone_stats(ax, metrics: Dict[str, Any]):
    """드론 상태 바 차트"""
    detected = metrics['drones']['detected']
    engaged = metrics['drones']['engaged']
    neutralized = metrics['drones']['neutralized']
    total_hostile = metrics['drones']['hostile']
    
    labels = ['탐지됨', '교전됨', '무력화']
    values = [detected, engaged, neutralized]
    colors = [COLORS['detected'], COLORS['engaged'], COLORS['neutralized']]
    
    bars = ax.bar(labels, values, color=colors, edgecolor='white', linewidth=1.5)
    ax.set_title(f'드론 상태 (적대적 {total_hostile}기)', fontsize=11, fontweight='bold')
    ax.set_ylabel('드론 수')
    
    for bar, val in zip(bars, values):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(values)*0.02, 
                   str(val), ha='center', va='bottom', fontsize=10, fontweight='bold')
    
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)


def plot_delay_boxplot(ax, metrics: Dict[str, Any]):
    """탐지/교전 지연 시간 박스플롯"""
    detection_vals = metrics['detection']['detection_delay'].get('values', [])
    engagement_vals = metrics['engagement']['engagement_delay'].get('values', [])
    
    data = []
    labels = []
    
    if detection_vals:
        data.append(detection_vals)
        labels.append('탐지 지연')
    if engagement_vals:
        data.append(engagement_vals)
        labels.append('교전 지연')
    
    if not data:
        ax.text(0.5, 0.5, '지연 데이터 없음', ha='center', va='center', fontsize=12,
               transform=ax.transAxes)
        ax.axis('off')
        return
    
    bp = ax.boxplot(data, labels=labels, patch_artist=True)
    
    colors_bp = [COLORS['primary'], COLORS['warning']]
    for patch, color in zip(bp['boxes'], colors_bp[:len(data)]):
        patch.set_facecolor(color)
        patch.set_alpha(0.7)
    
    ax.set_title('탐지/교전 지연 시간 분포', fontsize=11, fontweight='bold')
    ax.set_ylabel('시간 (초)')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)


def plot_delay_stats_table(ax, metrics: Dict[str, Any]):
    """지연 시간 통계 테이블"""
    ax.axis('off')
    
    det = metrics['detection']['detection_delay']
    eng = metrics['engagement']['engagement_delay']
    
    table_data = [
        ['지표', '탐지 지연', '교전 지연'],
        ['평균', f"{det.get('mean', 0):.2f}초", f"{eng.get('mean', 0):.2f}초"],
        ['중앙값', f"{det.get('median', 0):.2f}초", f"{eng.get('median', 0):.2f}초"],
        ['표준편차', f"{det.get('std', 0):.2f}초", f"{eng.get('std', 0):.2f}초"],
        ['최소', f"{det.get('min_val', 0):.2f}초", f"{eng.get('min_val', 0):.2f}초"],
        ['최대', f"{det.get('max_val', 0):.2f}초", f"{eng.get('max_val', 0):.2f}초"],
        ['샘플 수', f"{det.get('count', 0)}개", f"{eng.get('count', 0)}개"],
    ]
    
    table = ax.table(
        cellText=table_data,
        loc='center',
        cellLoc='center',
        colWidths=[0.3, 0.35, 0.35]
    )
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1.2, 1.5)
    
    # 헤더 스타일
    for i in range(3):
        table[(0, i)].set_facecolor(COLORS['dark'])
        table[(0, i)].set_text_props(color='white', fontweight='bold')
    
    ax.set_title('지연 시간 상세 통계', fontsize=11, fontweight='bold', pad=20)


def plot_event_totals_table(ax, metrics: Dict[str, Any]):
    """이벤트 총계 테이블"""
    ax.axis('off')
    
    event_totals = metrics.get('event_totals', {})
    
    # 주요 이벤트만 표시
    important_events = [
        ('radar_detection', '레이더 탐지'),
        ('audio_detection', '음향 탐지'),
        ('threat_score_update', '위협도 갱신'),
        ('engage_command', '교전 명령'),
        ('intercept_result', '요격 결과'),
        ('manual_action', '수동 조작'),
    ]
    
    table_data = [['이벤트 유형', '발생 횟수']]
    for event_key, event_name in important_events:
        count = event_totals.get(event_key, 0)
        table_data.append([event_name, f'{count:,}회'])
    
    table = ax.table(
        cellText=table_data,
        loc='center',
        cellLoc='center',
        colWidths=[0.5, 0.3]
    )
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1.2, 1.4)
    
    # 헤더 스타일
    table[(0, 0)].set_facecolor(COLORS['dark'])
    table[(0, 0)].set_text_props(color='white', fontweight='bold')
    table[(0, 1)].set_facecolor(COLORS['dark'])
    table[(0, 1)].set_text_props(color='white', fontweight='bold')
    
    ax.set_title('이벤트 총계', fontsize=11, fontweight='bold', pad=20)


def plot_drone_distribution(ax, metrics: Dict[str, Any]):
    """시나리오별 드론 수 분포 히스토그램"""
    distribution = metrics['drones'].get('per_experiment_distribution', [])
    
    if not distribution:
        ax.text(0.5, 0.5, '분포 데이터 없음', ha='center', va='center', fontsize=12,
               transform=ax.transAxes)
        ax.axis('off')
        return
    
    ax.hist(distribution, bins=range(1, max(distribution)+2), 
           color=COLORS['primary'], edgecolor='white', alpha=0.8)
    ax.set_title('시나리오별 드론 수 분포', fontsize=11, fontweight='bold')
    ax.set_xlabel('드론 수')
    ax.set_ylabel('시나리오 수')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)


def create_full_report_figure(metrics: Dict[str, Any], output_path: str = 'experiment_analysis.png'):
    """
    전체 분석 보고서 그래프 생성
    
    Args:
        metrics: 집계된 지표 딕셔너리
        output_path: 출력 파일 경로
    """
    if not HAS_MATPLOTLIB:
        print("⚠️ matplotlib가 설치되지 않아 그래프를 생성할 수 없습니다.")
        return
    
    fig = plt.figure(figsize=(16, 12))
    gs = GridSpec(3, 4, figure=fig, hspace=0.35, wspace=0.3)
    
    # 헤더
    create_figure_header(fig, metrics)
    
    # Row 1: 탐지 통계
    ax1 = fig.add_subplot(gs[0, 0:2])
    plot_detection_stats(ax1, metrics)
    
    ax2 = fig.add_subplot(gs[0, 2])
    plot_false_alarm_breakdown(ax2, metrics)
    
    ax3 = fig.add_subplot(gs[0, 3])
    plot_drone_distribution(ax3, metrics)
    
    # Row 2: 요격 및 드론 상태
    ax4 = fig.add_subplot(gs[1, 0])
    plot_intercept_result(ax4, metrics)
    
    ax5 = fig.add_subplot(gs[1, 1])
    plot_intercept_failure_reasons(ax5, metrics)
    
    ax6 = fig.add_subplot(gs[1, 2])
    plot_drone_stats(ax6, metrics)
    
    ax7 = fig.add_subplot(gs[1, 3])
    plot_event_totals_table(ax7, metrics)
    
    # Row 3: 지연 시간 분석
    ax8 = fig.add_subplot(gs[2, 0:2])
    plot_delay_boxplot(ax8, metrics)
    
    ax9 = fig.add_subplot(gs[2, 2:4])
    plot_delay_stats_table(ax9, metrics)
    
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    print(f"📈 그래프 저장: {output_path}")
    
    return fig


def create_summary_card(metrics: Dict[str, Any], output_path: str = 'summary_card.png'):
    """
    핵심 지표 요약 카드 생성
    """
    if not HAS_MATPLOTLIB:
        return
    
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.axis('off')
    
    summary_text = f"""
╔══════════════════════════════════════════════════════════════╗
║           대드론 C2 시뮬레이션 실험 결과 요약                    ║
╠══════════════════════════════════════════════════════════════╣
║  📊 실험 개요                                                  ║
║     • 총 실험 횟수: {metrics['experiment_count']}회                                    ║
║     • 총 드론 수: {metrics['drones']['total']}기 (적대적: {metrics['drones']['hostile']}기)                  ║
║     • 평균 드론/실험: {metrics['drones']['avg_per_experiment']}기                                ║
╠══════════════════════════════════════════════════════════════╣
║  🎯 탐지 성능                                                  ║
║     • 레이더 탐지: {metrics['detection']['total_radar']}회                                   ║
║     • 평균 탐지 지연: {metrics['detection']['detection_delay'].get('mean', 0):.2f}초                            ║
║     • 오탐률: {metrics['detection']['false_alarm_rate']}%                                       ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 요격 성능                                                  ║
║     • 요격 성공률: {metrics['interception']['success_rate']}%                                    ║
║     • 무력화율: {metrics['interception']['neutralization_rate']}%                                       ║
╚══════════════════════════════════════════════════════════════╝
"""
    
    ax.text(0.5, 0.5, summary_text, transform=ax.transAxes,
           fontsize=11, ha='center', va='center',
           fontfamily='monospace',
           bbox=dict(boxstyle='round', facecolor='#f8f9fa', edgecolor='#dee2e6'))
    
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    print(f"📊 요약 카드 저장: {output_path}")

