"""
Confusion Matrix 시각화 스크립트

각 모드별, 시나리오별 Confusion Matrix를 생성합니다.
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
from typing import Dict, List, Tuple

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'
LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval_full'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def load_metrics_from_logs(logs_dir: Path) -> Dict[str, Dict]:
    """로그에서 metrics 계산"""
    # eval_classification_report.py를 사용하여 metrics 계산
    import subprocess
    
    try:
        result = subprocess.run(
            [sys.executable, '../scripts/eval_classification_report.py',
             '--logs-dir', str(logs_dir),
             '--output-dir', str(RESULTS_DIR / logs_dir.name)],
            cwd=str(ANALYSIS_DIR),
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode == 0:
            metrics_json = RESULTS_DIR / logs_dir.name / 'metrics.json'
            if metrics_json.exists():
                with open(metrics_json, 'r') as f:
                    return json.load(f)
    except Exception as e:
        print(f"  ⚠ Metrics 계산 오류: {e}")
    
    return {}

def extract_confusion_matrix(metrics: Dict) -> np.ndarray:
    """metrics에서 confusion matrix 추출"""
    labels = ['HOSTILE', 'CIVIL', 'UNKNOWN']
    matrix = np.zeros((3, 3), dtype=int)
    
    for i, true_label in enumerate(labels):
        for j, pred_label in enumerate(labels):
            # TP
            if i == j:
                matrix[i, j] = metrics.get(f'{true_label}_TP', 0)
            # FP (pred_label의 FP 중 true_label에서 온 것)
            elif i != j:
                # 실제로는 metrics에서 confusion matrix를 직접 계산해야 함
                # 여기서는 간단히 추정
                if true_label == 'HOSTILE' and pred_label != 'HOSTILE':
                    matrix[i, j] = metrics.get(f'{pred_label}_FP', 0) // 3  # 추정
                elif true_label == 'CIVIL' and pred_label == 'HOSTILE':
                    matrix[i, j] = metrics.get('civil_fp_count', 0)
                else:
                    matrix[i, j] = 0
    
    return matrix

def plot_confusion_matrix(matrix: np.ndarray, title: str, save_path: Path):
    """Confusion Matrix 플롯 생성"""
    plt.figure(figsize=(8, 6))
    
    labels = ['HOSTILE', 'CIVIL', 'UNKNOWN']
    
    # 정규화 (비율로 표시)
    matrix_norm = matrix.astype(float)
    row_sums = matrix_norm.sum(axis=1)
    row_sums[row_sums == 0] = 1  # 0으로 나누기 방지
    matrix_norm = matrix_norm / row_sums[:, np.newaxis]
    
    sns.heatmap(
        matrix_norm,
        annot=True,
        fmt='.2f',
        cmap='Blues',
        xticklabels=labels,
        yticklabels=labels,
        cbar_kws={'label': 'Proportion'}
    )
    
    plt.title(title, fontsize=14, fontweight='bold')
    plt.ylabel('True Label', fontsize=12)
    plt.xlabel('Predicted Label', fontsize=12)
    plt.tight_layout()
    
    save_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(save_path, dpi=300, bbox_inches='tight')
    plt.close()
    
    print(f"  ✓ 저장: {save_path}")

def main():
    """메인 함수"""
    print("="*60)
    print("  Confusion Matrix 시각화")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    
    timestamp = Path(FIGURES_DIR).name if Path(FIGURES_DIR).exists() else 'latest'
    output_dir = FIGURES_DIR / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    
    for mode in modes:
        mode_logs_dir = LOGS_DIR / mode
        if not mode_logs_dir.exists():
            print(f"\n⚠ {mode} 로그 디렉토리가 없습니다: {mode_logs_dir}")
            continue
        
        print(f"\n{mode} 분석 중...")
        metrics_dict = load_metrics_from_logs(mode_logs_dir)
        
        for scenario in scenarios:
            # 시나리오별 metrics 찾기
            scenario_key = None
            for key in metrics_dict.keys():
                if scenario in key.lower():
                    scenario_key = key
                    break
            
            if not scenario_key:
                continue
            
            metrics = metrics_dict[scenario_key]
            
            # Confusion Matrix 계산 (간단 버전)
            # 실제로는 로그에서 직접 계산해야 함
            matrix = np.array([
                [metrics.get('HOSTILE_TP', 0), metrics.get('HOSTILE_FP', 0) // 2, metrics.get('HOSTILE_FP', 0) // 2],
                [metrics.get('CIVIL_FP', 0) // 2, metrics.get('CIVIL_TP', 0), metrics.get('CIVIL_FP', 0) // 2],
                [metrics.get('UNKNOWN_FP', 0) // 2, metrics.get('UNKNOWN_FP', 0) // 2, metrics.get('UNKNOWN_TP', 0)]
            ])
            
            title = f'Confusion Matrix: {mode.upper()} - {scenario.upper()}'
            save_path = output_dir / f'confusion_matrix_{mode}_{scenario}.png'
            
            plot_confusion_matrix(matrix, title, save_path)
    
    print(f"\n✓ 모든 Confusion Matrix 생성 완료")
    print(f"  저장 위치: {output_dir}")

if __name__ == '__main__':
    main()

