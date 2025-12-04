"""
Sensor Contribution 분석 시각화 스크립트
"""

import json
import sys
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
from typing import Dict
from collections import defaultdict

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval_full'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def extract_sensor_data(log_file: Path) -> Dict[str, int]:
    """로그에서 센서별 탐지 횟수 추출"""
    sensor_counts = defaultdict(int)
    
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    event = json.loads(line.strip())
                    event_type = event.get('event')
                    
                    if event_type == 'radar_detection':
                        sensor_counts['RADAR'] += 1
                    elif event_type == 'audio_detection':
                        sensor_counts['AUDIO'] += 1
                    elif event_type == 'eo_detection':
                        sensor_counts['EO'] += 1
                    elif event_type == 'fused_track_update':
                        sensors = event.get('sensors', {})
                        if sensors.get('radar'):
                            sensor_counts['RADAR_FUSED'] += 1
                        if sensors.get('audio'):
                            sensor_counts['AUDIO_FUSED'] += 1
                        if sensors.get('eo'):
                            sensor_counts['EO_FUSED'] += 1
                except:
                    continue
    except:
        pass
    
    return dict(sensor_counts)

def main():
    """메인 함수"""
    print("="*60)
    print("  Sensor Contribution 시각화")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    
    timestamp = 'latest'
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 모드별 센서 기여도 비교
    fig, ax = plt.subplots(figsize=(12, 6))
    
    mode_labels = []
    radar_counts = []
    audio_counts = []
    eo_counts = []
    
    for mode in modes:
        mode_logs_dir = LOGS_DIR / mode
        if not mode_logs_dir.exists():
            continue
        
        total_counts = defaultdict(int)
        
        # 모든 로그 파일에서 센서 데이터 수집
        for log_file in mode_logs_dir.rglob('*.jsonl'):
            counts = extract_sensor_data(log_file)
            for sensor, count in counts.items():
                total_counts[sensor] += count
        
        mode_labels.append(mode.upper())
        radar_counts.append(total_counts.get('RADAR', 0) + total_counts.get('RADAR_FUSED', 0))
        audio_counts.append(total_counts.get('AUDIO', 0) + total_counts.get('AUDIO_FUSED', 0))
        eo_counts.append(total_counts.get('EO', 0) + total_counts.get('EO_FUSED', 0))
    
    if mode_labels:
        x = np.arange(len(mode_labels))
        width = 0.25
        
        ax.bar(x - width, radar_counts, width, label='RADAR', color='#3498db')
        ax.bar(x, audio_counts, width, label='AUDIO', color='#2ecc71')
        ax.bar(x + width, eo_counts, width, label='EO', color='#e74c3c')
        
        ax.set_ylabel('Detection Count', fontsize=12)
        ax.set_title('Sensor Contribution Comparison', fontsize=14, fontweight='bold')
        ax.set_xticks(x)
        ax.set_xticklabels(mode_labels)
        ax.legend()
        ax.grid(alpha=0.3, axis='y')
        plt.tight_layout()
        
        save_path = output_dir / 'sensor_contribution.png'
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"  ✓ 저장: {save_path}")
    
    print(f"\n✓ Sensor Contribution 시각화 완료")
    print(f"  저장 위치: {output_dir}")

if __name__ == '__main__':
    main()

