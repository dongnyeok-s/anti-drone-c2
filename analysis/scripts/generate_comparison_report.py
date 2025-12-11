"""
비교 평가 리포트 생성 스크립트

baseline / fusion_default / fusion_tuned 모드별 성능을 비교하여
마크다운 리포트를 생성합니다.
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional
from collections import defaultdict

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'
LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval_comparison'

def load_metrics_from_logs(logs_dir: Path) -> Dict[str, Dict]:
    """
    로그 디렉토리에서 metrics를 계산하여 반환
    
    Returns:
        {
            'all_hostile': { 'accuracy': ..., 'HOSTILE_f1': ..., ... },
            'mixed_civil': { ... },
            'civil_only': { ... },
        }
    """
    # eval_classification_report.py를 사용하여 metrics 계산
    import subprocess
    
    metrics_file = RESULTS_DIR / f'{logs_dir.name}_metrics.json'
    
    try:
        result = subprocess.run(
            [sys.executable, 'scripts/eval_classification_report.py',
             '--logs-dir', str(logs_dir),
             '--output-dir', str(RESULTS_DIR / logs_dir.name)],
            cwd=str(ANALYSIS_DIR),
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode == 0:
            # metrics.json 파일 읽기
            metrics_json = RESULTS_DIR / logs_dir.name / 'metrics.json'
            if metrics_json.exists():
                with open(metrics_json, 'r') as f:
                    metrics_dict = json.load(f)
                
                # 키를 시나리오별로 정리
                scenario_metrics = {}
                for key, metrics in metrics_dict.items():
                    # "all_hostile_FUSION" -> "all_hostile"
                    scenario = key.split('_')[0] + '_' + key.split('_')[1] if '_' in key else key
                    if 'all_hostile' in key:
                        scenario = 'all_hostile'
                    elif 'mixed_civil' in key:
                        scenario = 'mixed_civil'
                    elif 'civil_only' in key:
                        scenario = 'civil_only'
                    else:
                        continue
                    
                    scenario_metrics[scenario] = metrics
                
                return scenario_metrics
    except Exception as e:
        print(f"  ⚠ Metrics 계산 오류 ({logs_dir.name}): {e}")
    
    return {}

def generate_comparison_report():
    """비교 리포트 생성"""
    print("="*60)
    print("  비교 리포트 생성")
    print("="*60)
    
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    all_metrics = {}
    
    # 각 모드별 metrics 로드
    for mode in modes:
        mode_logs_dir = LOGS_DIR / mode
        if not mode_logs_dir.exists():
            print(f"\n⚠ {mode} 로그 디렉토리가 없습니다: {mode_logs_dir}")
            continue
        
        print(f"\n{mode} 분석 중...")
        metrics = load_metrics_from_logs(mode_logs_dir)
        if metrics:
            all_metrics[mode] = metrics
            print(f"  ✓ {len(metrics)}개 시나리오 분석 완료")
    
    if not all_metrics:
        print("\n✗ 분석할 데이터가 없습니다.")
        return
    
    # 리포트 생성
    report_path = RESULTS_DIR / 'fusion_tuning_comparison.md'
    
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("# Fusion Tuning 비교 평가 리포트\n\n")
        f.write("## 실험 개요\n\n")
        f.write("- **평가 모드**: baseline, fusion_default, fusion_tuned\n")
        f.write("- **프로파일**: Fast (빠른 비교 평가)\n")
        f.write("- **시나리오**: all_hostile, mixed_civil, civil_only\n")
        f.write("- **Runs**: 3 runs per experiment\n\n")
        
        f.write("## 시나리오별 성능 비교\n\n")
        
        scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
        
        for scenario in scenarios:
            f.write(f"### {scenario.upper()}\n\n")
            f.write("| 모드 | Accuracy | HOSTILE F1 | HOSTILE Precision | HOSTILE Recall | CIVIL FP Rate |\n")
            f.write("|------|----------|------------|-------------------|----------------|---------------|\n")
            
            for mode in modes:
                if mode in all_metrics and scenario in all_metrics[mode]:
                    m = all_metrics[mode][scenario]
                    accuracy = m.get('accuracy', 0) * 100
                    hostile_f1 = m.get('HOSTILE_f1', 0) * 100
                    hostile_precision = m.get('HOSTILE_precision', 0) * 100
                    hostile_recall = m.get('HOSTILE_recall', 0) * 100
                    civil_fp_rate = m.get('civil_fp_rate', 0) * 100
                    
                    f.write(f"| {mode} | {accuracy:.2f}% | {hostile_f1:.2f}% | {hostile_precision:.2f}% | {hostile_recall:.2f}% | {civil_fp_rate:.2f}% |\n")
                else:
                    f.write(f"| {mode} | - | - | - | - | - |\n")
            
            f.write("\n")
        
        # 핵심 개선점 요약
        f.write("## 핵심 개선점 요약\n\n")
        
        if 'fusion_default' in all_metrics and 'fusion_tuned' in all_metrics:
            f.write("### Fusion Default → Fusion Tuned\n\n")
            
            for scenario in scenarios:
                if scenario in all_metrics['fusion_default'] and scenario in all_metrics['fusion_tuned']:
                    m_default = all_metrics['fusion_default'][scenario]
                    m_tuned = all_metrics['fusion_tuned'][scenario]
                    
                    hostile_f1_diff = (m_tuned.get('HOSTILE_f1', 0) - m_default.get('HOSTILE_f1', 0)) * 100
                    civil_fp_diff = (m_tuned.get('civil_fp_rate', 0) - m_default.get('civil_fp_rate', 0)) * 100
                    
                    f.write(f"**{scenario}**:\n")
                    f.write(f"- HOSTILE F1: {hostile_f1_diff:+.2f}%p\n")
                    f.write(f"- CIVIL FP Rate: {civil_fp_diff:+.2f}%p\n")
                    f.write("\n")
        
        f.write("## Best Config 파라미터\n\n")
        best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
        if best_config_file.exists():
            with open(best_config_file, 'r') as cfg:
                config = json.load(cfg)
                params = config.get('best_params', {})
                f.write(f"- **Best Score**: {config.get('best_score', 0):.4f}\n")
                f.write(f"- **threat_engage_threshold**: {params.get('threat_engage_threshold', 'N/A')}\n")
                f.write(f"- **civil_conf_threshold**: {params.get('civil_conf_threshold', 'N/A')}\n")
                f.write(f"- **sensor_eo_weight**: {params.get('sensor_eo_weight', 'N/A')}\n")
    
    print(f"\n✓ 리포트 생성 완료: {report_path}")
    return report_path

def print_final_summary():
    """최종 요약 출력"""
    print("\n" + "="*60)
    print("  최종 요약")
    print("="*60)
    
    # Best config
    best_config_file = RESULTS_DIR / 'auto_tune_best_config.json'
    if best_config_file.exists():
        with open(best_config_file, 'r') as f:
            config = json.load(f)
        
        print("\n=== Fast Auto_tune 결과 ===")
        print(f"Best Score: {config.get('best_score', 0):.4f}")
        
        params = config.get('best_params', {})
        print(f"\n주요 파라미터:")
        print(f"  - threat_engage_threshold: {params.get('threat_engage_threshold', 'N/A'):.2f}")
        print(f"  - civil_conf_threshold: {params.get('civil_conf_threshold', 'N/A'):.3f}")
        print(f"  - sensor_eo_weight: {params.get('sensor_eo_weight', 'N/A'):.3f}")
    
    # 비교 결과
    print("\n=== Full 평가 결과 ===")
    report_file = RESULTS_DIR / 'fusion_tuning_comparison.md'
    if report_file.exists():
        print(f"  리포트 생성 완료: {report_file}")
        print("\n  리포트 내용 요약:")
        with open(report_file, 'r') as f:
            lines = f.readlines()
            for i, line in enumerate(lines):
                if 'Fusion Default → Fusion Tuned' in line or 'HOSTILE F1:' in line or 'CIVIL FP Rate:' in line:
                    print(f"    {line.strip()}")
                    if i < len(lines) - 1 and lines[i+1].strip():
                        print(f"    {lines[i+1].strip()}")
    else:
        print("  리포트 생성 중...")

def main():
    """메인 함수"""
    report_path = generate_comparison_report()
    print_final_summary()
    
    print("\n" + "="*60)
    print("  모든 작업 완료!")
    print("="*60)

if __name__ == '__main__':
    main()
