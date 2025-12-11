"""
Threat Score 동적 변화 시각화 스크립트
"""

import json
import sys
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
from typing import Dict, List
from collections import defaultdict

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval_full'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def extract_threat_scores(log_file: Path) -> List[float]:
    """로그 파일에서 threat score 추출"""
    scores = []
    
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    event = json.loads(line.strip())
                    if event.get('event') == 'fused_track_update':
                        threat_score = event.get('threat_score') or event.get('fused_threat_score')
                        if threat_score is not None:
                            scores.append(threat_score)
                except:
                    continue
    except:
        pass
    
    return scores

def main():
    """메인 함수"""
    print("="*60)
    print("  Threat Score 동적 변화 시각화")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    scenarios = ['all_hostile', 'mixed_civil']
    
    timestamp = 'latest'
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for scenario in scenarios:
        fig, ax = plt.subplots(figsize=(12, 6))
        
        for mode in modes:
            mode_logs_dir = LOGS_DIR / mode
            if not mode_logs_dir.exists():
                continue
            
            # 시나리오별 로그 파일 찾기
            all_scores = []
            for log_file in mode_logs_dir.rglob('*.jsonl'):
                if scenario in str(log_file):
                    scores = extract_threat_scores(log_file)
                    all_scores.extend(scores)
            
            if all_scores:
                # 히스토그램
                ax.hist(all_scores, bins=50, alpha=0.6, label=mode.upper(), density=True)
        
        ax.set_xlabel('Threat Score', fontsize=12)
        ax.set_ylabel('Density', fontsize=12)
        ax.set_title(f'Threat Score Distribution: {scenario.upper()}', fontsize=14, fontweight='bold')
        ax.legend()
        ax.grid(alpha=0.3)
        plt.tight_layout()
        
        save_path = output_dir / f'threat_dynamics_{scenario}.png'
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"  ✓ 저장: {save_path}")
    
    print(f"\n✓ Threat Score 동적 변화 시각화 완료")
    print(f"  저장 위치: {output_dir}")

if __name__ == '__main__':
    main()

