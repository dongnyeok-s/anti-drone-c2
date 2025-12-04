"""
Precision-Recall Curve 시각화 스크립트
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

def load_pr_data(logs_dir: Path) -> Dict:
    """PR 데이터 로드"""
    roc_pr_dir = RESULTS_DIR / logs_dir.name / 'roc_pr_data'
    
    if not roc_pr_dir.exists():
        return {}
    
    data = {}
    for json_file in roc_pr_dir.glob('*.json'):
        scenario = json_file.stem.replace('_roc_pr', '')
        with open(json_file, 'r') as f:
            data[scenario] = json.load(f)
    
    return data

def main():
    """메인 함수"""
    print("="*60)
    print("  Precision-Recall Curve 시각화")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    
    timestamp = 'latest'
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for scenario in scenarios:
        plt.figure(figsize=(10, 6))
        
        for mode in modes:
            mode_logs_dir = LOGS_DIR / mode
            if not mode_logs_dir.exists():
                continue
            
            pr_data = load_pr_data(mode_logs_dir)
            
            if scenario not in pr_data:
                continue
            
            data = pr_data[scenario]
            
            if 'recall' in data and 'precision' in data:
                plt.plot(data['recall'], data['precision'], label=mode.upper(), linewidth=2)
        
        plt.xlabel('Recall', fontsize=12)
        plt.ylabel('Precision', fontsize=12)
        plt.title(f'Precision-Recall Curve: {scenario.upper()}', fontsize=14, fontweight='bold')
        plt.legend()
        plt.grid(alpha=0.3)
        plt.tight_layout()
        
        save_path = output_dir / f'pr_curve_{scenario}.png'
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"  ✓ 저장: {save_path}")
    
    print(f"\n✓ 모든 PR Curve 생성 완료")
    print(f"  저장 위치: {output_dir}")

if __name__ == '__main__':
    main()

