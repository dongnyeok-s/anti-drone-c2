"""
평가 리포트 생성 스크립트 (통합 버전)

Full Evaluation 결과를 기반으로 리포트와 시각화를 생성합니다.

사용법:
    python generate_report.py [--full] [--no-plots]
"""

import json
import sys
import csv
from pathlib import Path
from datetime import datetime
from typing import Dict, List
import subprocess
import argparse

PROJECT_ROOT = Path(__file__).parent.parent.parent
SIMULATOR_DIR = PROJECT_ROOT / 'simulator'
ANALYSIS_DIR = PROJECT_ROOT / 'analysis'
RESULTS_DIR = ANALYSIS_DIR / 'results'
LOGS_DIR = SIMULATOR_DIR / 'logs' / 'eval_full'
PLOTS_DIR = ANALYSIS_DIR / 'plots'
FIGURES_DIR = ANALYSIS_DIR / 'figures'

def load_metrics_for_mode(mode: str) -> Dict[str, Dict]:
    """모드별 metrics 로드"""
    # 먼저 기존 metrics.json 파일 확인
    metrics_json = RESULTS_DIR / mode / 'metrics.json'
    if metrics_json.exists():
        try:
            with open(metrics_json, 'r') as f:
                metrics = json.load(f)
                if metrics:  # 빈 dict가 아닌 경우
                    return metrics
        except Exception as e:
            print(f"  ⚠ {mode} metrics.json 읽기 오류: {e}")
    
    # 없으면 로그 디렉토리에서 직접 분석
    mode_logs_dir = LOGS_DIR / mode
    if not mode_logs_dir.exists():
        # eval_comparison 디렉토리도 확인
        mode_logs_dir = PROJECT_ROOT / 'simulator' / 'logs' / 'eval_comparison' / mode
        if not mode_logs_dir.exists():
            return {}
    
    # eval_classification_report.py 실행
    try:
        result = subprocess.run(
            [sys.executable, 'scripts/eval_classification_report.py',
             '--logs-dir', str(mode_logs_dir),
             '--output-dir', str(RESULTS_DIR / mode)],
            cwd=str(ANALYSIS_DIR),
            capture_output=True,
            text=True,
            timeout=600
        )
        
        if result.returncode == 0:
            metrics_json = RESULTS_DIR / mode / 'metrics.json'
            if metrics_json.exists():
                with open(metrics_json, 'r') as f:
                    return json.load(f)
    except Exception as e:
        print(f"  ⚠ {mode} metrics 로드 오류: {e}")
    
    return {}

def generate_summary_markdown(all_metrics: Dict[str, Dict[str, Dict]]) -> str:
    """Full evaluation summary 마크다운 생성"""
    content = []
    content.append("# Full Evaluation Summary\n")
    content.append(f"생성 시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    content.append("\n## 실험 개요\n")
    content.append("- **평가 모드**: baseline, fusion_default, fusion_tuned\n")
    content.append("- **프로파일**: Full (정식 평가)\n")
    content.append("- **시나리오**: all_hostile, mixed_civil, civil_only\n")
    content.append("- **Runs**: 20 runs per experiment\n")
    
    content.append("\n## 시나리오별 성능 비교\n")
    
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    
    for scenario in scenarios:
        content.append(f"\n### {scenario.upper()}\n")
        content.append("| 모드 | Accuracy | HOSTILE F1 | HOSTILE Precision | HOSTILE Recall | CIVIL FP Rate |\n")
        content.append("|------|----------|------------|-------------------|----------------|---------------|\n")
        
        for mode in modes:
            if mode in all_metrics:
                found = False
                for key, metrics in all_metrics[mode].items():
                    if scenario in key.lower():
                        acc = metrics.get('accuracy', 0) * 100
                        f1 = metrics.get('HOSTILE_f1', 0) * 100
                        prec = metrics.get('HOSTILE_precision', 0) * 100
                        rec = metrics.get('HOSTILE_recall', 0) * 100
                        fp_rate = metrics.get('civil_fp_rate', 0) * 100
                        
                        content.append(f"| {mode} | {acc:.2f}% | {f1:.2f}% | {prec:.2f}% | {rec:.2f}% | {fp_rate:.2f}% |\n")
                        found = True
                        break
                if not found:
                    content.append(f"| {mode} | - | - | - | - | - |\n")
            else:
                content.append(f"| {mode} | - | - | - | - | - |\n")
    
    return ''.join(content)

def generate_metrics_csv(all_metrics: Dict[str, Dict[str, Dict]]) -> Path:
    """Metrics CSV 생성"""
    csv_path = RESULTS_DIR / 'metrics_table.csv'
    
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Mode', 'Scenario', 'Accuracy', 'HOSTILE_F1', 'HOSTILE_Precision', 
                         'HOSTILE_Recall', 'CIVIL_FP_Rate', 'CIVIL_TP', 'CIVIL_FP', 'CIVIL_FN'])
        
        for mode in modes:
            for scenario in scenarios:
                if mode in all_metrics:
                    for key, metrics in all_metrics[mode].items():
                        if scenario in key.lower():
                            writer.writerow([
                                mode,
                                scenario,
                                f"{metrics.get('accuracy', 0):.4f}",
                                f"{metrics.get('HOSTILE_f1', 0):.4f}",
                                f"{metrics.get('HOSTILE_precision', 0):.4f}",
                                f"{metrics.get('HOSTILE_recall', 0):.4f}",
                                f"{metrics.get('civil_fp_rate', 0):.4f}",
                                metrics.get('CIVIL_TP', 0),
                                metrics.get('CIVIL_FP', 0),
                                metrics.get('CIVIL_FN', 0),
                            ])
                            break
    
    return csv_path

def generate_fusion_vs_baseline_csv(all_metrics: Dict[str, Dict[str, Dict]]) -> Path:
    """Fusion vs Baseline 비교 CSV 생성"""
    csv_path = RESULTS_DIR / 'fusion_vs_baseline_table.csv'
    
    scenarios = ['all_hostile', 'mixed_civil', 'civil_only']
    
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Scenario', 'Metric', 'Baseline', 'Fusion_Default', 'Fusion_Tuned', 
                         'Improvement_Default', 'Improvement_Tuned'])
        
        for scenario in scenarios:
            baseline_metrics = {}
            fusion_default_metrics = {}
            fusion_tuned_metrics = {}
            
            # 각 모드에서 metrics 찾기
            for mode in ['baseline', 'fusion_default', 'fusion_tuned']:
                if mode in all_metrics:
                    for key, metrics in all_metrics[mode].items():
                        key_lower = key.lower()
                        if scenario in key_lower:
                            if mode == 'baseline':
                                baseline_metrics = metrics
                            elif mode == 'fusion_default':
                                fusion_default_metrics = metrics
                            elif mode == 'fusion_tuned':
                                fusion_tuned_metrics = metrics
                            break
            
            # 주요 지표 비교
            metrics_to_compare = [
                ('Accuracy', 'accuracy'),
                ('HOSTILE_F1', 'HOSTILE_f1'),
                ('HOSTILE_Precision', 'HOSTILE_precision'),
                ('HOSTILE_Recall', 'HOSTILE_recall'),
                ('CIVIL_FP_Rate', 'civil_fp_rate'),
            ]
            
            for metric_name, metric_key in metrics_to_compare:
                baseline_val = baseline_metrics.get(metric_key, 0) if baseline_metrics else 0
                default_val = fusion_default_metrics.get(metric_key, 0) if fusion_default_metrics else 0
                tuned_val = fusion_tuned_metrics.get(metric_key, 0) if fusion_tuned_metrics else 0
                
                improvement_default = (default_val - baseline_val) * 100 if baseline_val > 0 else 0
                improvement_tuned = (tuned_val - baseline_val) * 100 if baseline_val > 0 else 0
                
                writer.writerow([
                    scenario,
                    metric_name,
                    f"{baseline_val:.4f}",
                    f"{default_val:.4f}",
                    f"{tuned_val:.4f}",
                    f"{improvement_default:+.2f}%p",
                    f"{improvement_tuned:+.2f}%p",
                ])
    
    return csv_path

def main():
    """메인 함수"""
    parser = argparse.ArgumentParser(description='평가 리포트 생성')
    parser.add_argument('--full', action='store_true',
                       help='전체 리포트 생성 (플롯 포함)')
    parser.add_argument('--no-plots', action='store_true',
                       help='플롯 생성 스킵')
    
    args = parser.parse_args()
    
    print("="*60)
    print("  평가 리포트 생성")
    print("="*60)
    
    # 1. Full eval 결과 읽기
    print("\n[1/4] Full Evaluation 결과 로드 중...")
    all_metrics = {}
    modes = ['baseline', 'fusion_default', 'fusion_tuned']
    
    for mode in modes:
        print(f"  {mode} 분석 중...")
        metrics = load_metrics_for_mode(mode)
        if metrics:
            all_metrics[mode] = metrics
            print(f"    ✓ {len(metrics)}개 시나리오 분석 완료")
        else:
            print(f"    ⚠ 데이터 없음")
    
    if not all_metrics:
        print("\n✗ 분석할 데이터가 없습니다.")
        print("  Full Evaluation을 먼저 실행하세요:")
        print("    python analysis/scripts/run_evaluation.py")
        return
    
    # 2. 플롯 생성 (옵션)
    if args.full and not args.no_plots:
        print("\n[2/4] 논문용 Figure 생성 중...")
        try:
            result = subprocess.run(
                [sys.executable, 'plots/generate_all_figures.py'],
                cwd=str(ANALYSIS_DIR),
                capture_output=True,
                text=True,
                timeout=1800
            )
            
            if result.returncode == 0:
                print("  ✓ 모든 Figure 생성 완료")
            else:
                print(f"  ⚠ Figure 생성 중 일부 오류 발생")
                print(result.stderr[:500])
        except Exception as e:
            print(f"  ⚠ Figure 생성 오류: {e}")
    else:
        print("\n[2/4] 플롯 생성 스킵")
    
    # 3. 테이블 생성
    print("\n[3/4] 평가 테이블 생성 중...")
    
    # Summary Markdown
    summary_md = generate_summary_markdown(all_metrics)
    summary_path = RESULTS_DIR / 'full_evaluation_summary.md'
    with open(summary_path, 'w', encoding='utf-8') as f:
        f.write(summary_md)
    print(f"  ✓ {summary_path}")
    
    # Metrics CSV
    metrics_csv = generate_metrics_csv(all_metrics)
    print(f"  ✓ {metrics_csv}")
    
    # Fusion vs Baseline CSV
    comparison_csv = generate_fusion_vs_baseline_csv(all_metrics)
    print(f"  ✓ {comparison_csv}")
    
    # 4. 최종 출력
    print("\n[4/4] 완료!")
    print("="*60)
    
    figures_dir = FIGURES_DIR / 'latest'
    
    print("\n📁 생성된 파일:")
    print(f"  - 리포트: {summary_path}")
    print(f"  - Metrics CSV: {metrics_csv}")
    print(f"  - 비교 CSV: {comparison_csv}")
    if args.full and not args.no_plots:
        print(f"  - Figures: {figures_dir}")
    
    print("\n📊 핵심 지표 요약:")
    if 'fusion_default' in all_metrics and 'fusion_tuned' in all_metrics:
        for scenario in ['all_hostile', 'mixed_civil', 'civil_only']:
            print(f"\n  {scenario.upper()}:")
            for mode in ['fusion_default', 'fusion_tuned']:
                if mode in all_metrics:
                    for key, metrics in all_metrics[mode].items():
                        if scenario in key.lower():
                            print(f"    {mode}: F1={metrics.get('HOSTILE_f1', 0):.3f}, "
                                  f"FP={metrics.get('civil_fp_rate', 0):.3f}")
                            break
    
    print("\n" + "="*60)
    print("  모든 작업 완료!")
    print("="*60)

if __name__ == '__main__':
    main()

