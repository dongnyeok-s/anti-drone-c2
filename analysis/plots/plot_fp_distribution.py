"""
False Positive 분포 시각화 스크립트
"""

import json
import sys
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
from typing import Dict

PROJECT_ROOT = Path(__file__).parent.parent.parent
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'
LOGS_DIR = PROJECT_ROOT / 'simulator' / 'logs' / 'eval_full'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def load_metrics(logs_dir: Path) -> Dict:
    """Metrics 로드"""
    metrics_json = RESULTS_DIR / logs_dir.name / 'metrics.json'
    if metrics_json.exists():
        with open(metrics_json, 'r') as f:
            return json.load(f)
    return {}

def main():
    """메인 함수"""
    print("="*60)
    print("  False Positive 분포 시각화")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    
    timestamp = 'latest'
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 모드별 FP Rate 비교
    fig, ax = plt.subplots(figsize=(10, 6))
    
    mode_labels = []
    fp_rates = []
    
    for mode in modes:
        mode_logs_dir = LOGS_DIR / mode
        if not mode_logs_dir.exists():
            continue
        
        metrics_dict = load_metrics(mode_logs_dir)
        
        # mixed_civil 시나리오의 CIVIL FP Rate
        for key, metrics in metrics_dict.items():
            if 'mixed_civil' in key.lower():
                fp_rate = metrics.get('civil_fp_rate', 0) * 100
                mode_labels.append(mode.upper())
                fp_rates.append(fp_rate)
                break
    
    if fp_rates:
        bars = ax.bar(mode_labels, fp_rates, color=['#3498db', '#2ecc71', '#e74c3c'])
        ax.set_ylabel('CIVIL False Positive Rate (%)', fontsize=12)
        ax.set_title('CIVIL False Positive Rate Comparison (mixed_civil)', fontsize=14, fontweight='bold')
        ax.set_ylim(0, max(fp_rates) * 1.2)
        
        # 값 표시
        for bar, rate in zip(bars, fp_rates):
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{rate:.2f}%', ha='center', va='bottom', fontsize=11)
        
        plt.tight_layout()
        
        save_path = output_dir / 'fp_distribution.png'
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"  ✓ 저장: {save_path}")
    
    print(f"\n✓ FP 분포 시각화 완료")
    print(f"  저장 위치: {output_dir}")

if __name__ == '__main__':
    main()

