"""
ROC/PR Curve 시각화 스크립트
"""

import json
import sys
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
from typing import Dict, List

PROJECT_ROOT = Path(__file__).parent.parent.parent
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'
LOGS_DIR = PROJECT_ROOT / 'simulator' / 'logs' / 'eval_full'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def load_roc_pr_data(logs_dir: Path) -> Dict:
    """ROC/PR 데이터 로드"""
    # eval_classification_report.py가 생성한 ROC/PR 데이터 사용
    roc_pr_dir = RESULTS_DIR / logs_dir.name / 'roc_pr_data'
    
    if not roc_pr_dir.exists():
        return {}
    
    data = {}
    for json_file in roc_pr_dir.glob('*.json'):
        scenario = json_file.stem.replace('_roc_pr', '')
        with open(json_file, 'r') as f:
            data[scenario] = json.load(f)
    
    return data

def plot_roc_curve(fpr: List[float], tpr: List[float], label: str, ax):
    """ROC Curve 플롯"""
    ax.plot(fpr, tpr, label=label, linewidth=2)
    ax.plot([0, 1], [0, 1], 'k--', alpha=0.5)
    ax.set_xlabel('False Positive Rate', fontsize=12)
    ax.set_ylabel('True Positive Rate', fontsize=12)
    ax.set_title('ROC Curve', fontsize=14, fontweight='bold')
    ax.legend()
    ax.grid(alpha=0.3)

def plot_pr_curve(recall: List[float], precision: List[float], label: str, ax):
    """PR Curve 플롯"""
    ax.plot(recall, precision, label=label, linewidth=2)
    ax.set_xlabel('Recall', fontsize=12)
    ax.set_ylabel('Precision', fontsize=12)
    ax.set_title('Precision-Recall Curve', fontsize=14, fontweight='bold')
    ax.legend()
    ax.grid(alpha=0.3)

def main():
    """메인 함수"""
    print("="*60)
    print("  ROC/PR Curve 시각화")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    
    timestamp = 'latest'
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 시나리오별로 비교 플롯 생성
    for scenario in scenarios:
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        for mode in modes:
            mode_logs_dir = LOGS_DIR / mode
            if not mode_logs_dir.exists():
                continue
            
            roc_pr_data = load_roc_pr_data(mode_logs_dir)
            
            if scenario not in roc_pr_data:
                continue
            
            data = roc_pr_data[scenario]
            
            # ROC Curve
            if 'fpr' in data and 'tpr' in data:
                plot_roc_curve(data['fpr'], data['tpr'], mode.upper(), ax1)
            
            # PR Curve
            if 'recall' in data and 'precision' in data:
                plot_pr_curve(data['recall'], data['precision'], mode.upper(), ax2)
        
        plt.suptitle(f'{scenario.upper()} - ROC/PR Curves', fontsize=16, fontweight='bold')
        plt.tight_layout()
        
        save_path = output_dir / f'roc_pr_{scenario}.png'
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"  ✓ 저장: {save_path}")
    
    print(f"\n✓ 모든 ROC/PR Curve 생성 완료")
    print(f"  저장 위치: {output_dir}")

if __name__ == '__main__':
    main()

