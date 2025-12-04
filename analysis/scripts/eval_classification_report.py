"""
2차 성능 향상 평가용 분류 성능 리포트 생성 스크립트

여러 시나리오×모드 조합의 JSONL 로그를 읽어서
Confusion Matrix, Accuracy, Precision/Recall/F1, FP/FN 비율 등을 계산하고
마크다운 리포트로 출력합니다.

사용법:
    python eval_classification_report.py
    또는
    python eval_classification_report.py --logs-dir ../simulator/logs/eval
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
import csv

# ============================================
# 타입 정의
# ============================================

TrueLabel = str  # 'HOSTILE' | 'CIVIL' | 'UNKNOWN'
PredLabel = str  # 'HOSTILE' | 'CIVIL' | 'UNKNOWN'
Classification = str  # 'HOSTILE' | 'FRIENDLY' | 'CIVIL' | 'UNKNOWN'

# ============================================
# 설정
# ============================================

THREAT_ENGAGE_THRESHOLD = 70.0  # 위협 점수 임계값
CLASS_CONFIDENCE_THRESHOLD = 0.7  # 분류 신뢰도 임계값

# ============================================
# 예측 레이블 계산
# ============================================

def compute_pred_label(
    threat_score: Optional[float],
    classification: Optional[Classification],
    class_confidence: Optional[float],
    threat_threshold: float = THREAT_ENGAGE_THRESHOLD,
    class_confidence_threshold: float = CLASS_CONFIDENCE_THRESHOLD
) -> PredLabel:
    """
    시스템이 판단한 레이블(pred_label) 계산
    
    규칙:
    - pred_label = "HOSTILE" if threat_score >= THREAT_ENGAGE_THRESHOLD
    - pred_label = "CIVIL" if classification == "CIVIL" AND class_confidence >= 0.7
    - 나머지는 pred_label = "UNKNOWN"
    
    주의: classification은 'HOSTILE' | 'FRIENDLY' | 'CIVIL' | 'UNKNOWN' 중 하나
    """
    # 위협 점수 기반 HOSTILE 판단 (우선순위 1)
    if threat_score is not None and threat_score >= threat_threshold:
        return 'HOSTILE'
    
    # 분류 기반 CIVIL 판단 (우선순위 2)
    # classification 문자열 정규화
    if classification:
        classification_normalized = str(classification).upper().strip()
        if classification_normalized == 'CIVIL' and class_confidence is not None and class_confidence >= class_confidence_threshold:
            return 'CIVIL'
    
    # 나머지는 UNKNOWN
    return 'UNKNOWN'


# ============================================
# 데이터 로딩
# ============================================

def load_log_events(log_file: Path) -> List[Dict]:
    """JSONL 로그 파일 읽기"""
    events = []
    with open(log_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                events.append(event)
            except json.JSONDecodeError as e:
                print(f"Warning: JSON 파싱 오류 (라인 무시): {e}", file=sys.stderr)
    return events


def extract_drone_labels(events: List[Dict]) -> Dict[str, TrueLabel]:
    """drone_spawned 이벤트에서 드론별 true_label 추출"""
    drone_labels: Dict[str, TrueLabel] = {}
    
    for event in events:
        if event.get('event') == 'drone_spawned':
            drone_id = event.get('drone_id')
            true_label = event.get('true_label')
            if drone_id and true_label:
                # 문자열 정규화 (대소문자 통일)
                true_label_normalized = str(true_label).upper().strip()
                if true_label_normalized in ['HOSTILE', 'CIVIL', 'UNKNOWN']:
                    drone_labels[drone_id] = true_label_normalized
    
    return drone_labels


def extract_predictions_from_log(log_file: Path) -> List[Dict]:
    """단일 로그 파일에서 예측 데이터 추출"""
    events = load_log_events(log_file)
    drone_labels = extract_drone_labels(events)
    
    if not drone_labels:
        return []
    
    predictions = []
    
    for event in events:
        event_type = event.get('event')
        drone_id = event.get('drone_id')
        
        if not drone_id or drone_id not in drone_labels:
            continue
        
        true_label = drone_labels[drone_id]
        
        # fused_track_update 이벤트에서 데이터 추출
        if event_type == 'fused_track_update':
            threat_score = event.get('threat_score') or event.get('fused_threat_score')
            # classification 필드명 확인: classification 또는 fused_classification
            classification = event.get('classification') or event.get('fused_classification')
            class_confidence = event.get('class_confidence') or event.get('class_info', {}).get('confidence', 0)
            
            # true_label이 이벤트에 직접 포함되어 있을 수도 있음
            event_true_label = event.get('true_label')
            if event_true_label:
                true_label = event_true_label
            
            pred_label = compute_pred_label(threat_score, classification, class_confidence)
            
            predictions.append({
                'drone_id': drone_id,
                'true_label': true_label,
                'pred_label': pred_label,
                'threat_score': threat_score,
                'classification': classification,
                'class_confidence': class_confidence,
                'timestamp': event.get('timestamp', 0),
            })
        
        # threat_score_update 이벤트에서도 추출 가능
        elif event_type == 'threat_score_update':
            threat_score = event.get('total_score')
            classification = None
            class_confidence = None
            
            pred_label = compute_pred_label(threat_score, classification, class_confidence)
            
            predictions.append({
                'drone_id': drone_id,
                'true_label': true_label,
                'pred_label': pred_label,
                'threat_score': threat_score,
                'classification': classification,
                'class_confidence': class_confidence,
                'timestamp': event.get('timestamp', 0),
            })
    
    return predictions


# ============================================
# 성능 지표 계산
# ============================================

def compute_metrics(predictions: List[Dict]) -> Dict[str, float]:
    """
    성능 지표 계산
    
    - Accuracy: 전체 정확도
    - 각 클래스별 Precision, Recall, F1
    - FP/FN 비율
    """
    if not predictions:
        return {}
    
    # 전체 정확도
    correct = sum(1 for p in predictions if p['true_label'] == p['pred_label'])
    accuracy = correct / len(predictions) if predictions else 0.0
    
    # 클래스별 TP, FP, FN 카운트
    class_stats = defaultdict(lambda: {'TP': 0, 'FP': 0, 'FN': 0})
    
    for pred in predictions:
        true_label = pred['true_label']
        pred_label = pred['pred_label']
        
        if true_label == pred_label:
            class_stats[true_label]['TP'] += 1
        else:
            class_stats[true_label]['FN'] += 1
            class_stats[pred_label]['FP'] += 1
    
    metrics = {
        'accuracy': accuracy,
        'total_predictions': len(predictions),
        'correct': correct,
        'incorrect': len(predictions) - correct,
    }
    
    # 클래스별 통계
    for label in ['HOSTILE', 'CIVIL', 'UNKNOWN']:
        stats = class_stats[label]
        tp = stats['TP']
        fp = stats['FP']
        fn = stats['FN']
        
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
        
        metrics[f'{label}_precision'] = precision
        metrics[f'{label}_recall'] = recall
        metrics[f'{label}_f1'] = f1
        metrics[f'{label}_TP'] = tp
        metrics[f'{label}_FP'] = fp
        metrics[f'{label}_FN'] = fn
    
    # FP/FN 비율 (HOSTILE 기준)
    hostile_stats = class_stats['HOSTILE']
    total_hostile = hostile_stats['TP'] + hostile_stats['FN']
    fp_rate = hostile_stats['FP'] / len(predictions) if predictions else 0.0
    fn_rate = hostile_stats['FN'] / total_hostile if total_hostile > 0 else 0.0
    
    metrics['FP_rate'] = fp_rate
    metrics['FN_rate'] = fn_rate
    
    # CIVIL False Positive Rate 계산
    # true_label == CIVIL인데 pred_label == HOSTILE인 경우
    civil_fp_count = 0
    total_civil = 0
    for pred in predictions:
        if pred['true_label'] == 'CIVIL':
            total_civil += 1
            if pred['pred_label'] == 'HOSTILE':
                civil_fp_count += 1
    
    civil_fp_rate = civil_fp_count / total_civil if total_civil > 0 else 0.0
    metrics['civil_fp_rate'] = civil_fp_rate
    metrics['civil_fp_count'] = civil_fp_count
    metrics['total_civil_samples'] = total_civil
    
    return metrics


def compute_confusion_matrix(predictions: List[Dict]) -> Dict[Tuple[TrueLabel, PredLabel], int]:
    """Confusion Matrix 계산"""
    matrix = defaultdict(int)
    
    for pred in predictions:
        true_label = pred['true_label']
        pred_label = pred['pred_label']
        matrix[(true_label, pred_label)] += 1
    
    return dict(matrix)


# ============================================
# ROC/PR Curve 데이터 계산
# ============================================

def compute_roc_pr_data(predictions: List[Dict], label: str = 'HOSTILE') -> Dict:
    """
    ROC/PR Curve에 필요한 데이터 계산
    
    threshold를 변화시키면서 TPR/FPR, Precision/Recall 계산
    """
    # 위협 점수 기준으로 정렬
    sorted_preds = sorted(
        [p for p in predictions if p.get('threat_score') is not None],
        key=lambda x: x.get('threat_score', 0),
        reverse=True
    )
    
    if not sorted_preds:
        return {'roc_points': [], 'pr_points': []}
    
    roc_points = []
    pr_points = []
    
    # 다양한 threshold에 대해 계산
    thresholds = [i * 5 for i in range(0, 21)]  # 0, 5, 10, ..., 100
    
    for threshold in thresholds:
        tp = 0
        fp = 0
        fn = 0
        tn = 0
        
        for pred in sorted_preds:
            threat_score = pred.get('threat_score', 0)
            true_label = pred['true_label']
            pred_label = 'HOSTILE' if threat_score >= threshold else 'UNKNOWN'
            
            if true_label == label:
                if pred_label == label:
                    tp += 1
                else:
                    fn += 1
            else:
                if pred_label == label:
                    fp += 1
                else:
                    tn += 1
        
        # TPR (True Positive Rate = Recall = Sensitivity)
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        # FPR (False Positive Rate)
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        # Precision
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        # Recall
        recall = tpr
        
        roc_points.append({
            'threshold': threshold,
            'tpr': tpr,
            'fpr': fpr,
        })
        
        pr_points.append({
            'threshold': threshold,
            'precision': precision,
            'recall': recall,
        })
    
    return {
        'roc_points': roc_points,
        'pr_points': pr_points,
    }


# ============================================
# 리포트 생성
# ============================================

def generate_report(
    results: Dict[Tuple[str, str], Dict],
    output_dir: Path
) -> None:
    """마크다운 리포트 생성"""
    
    report_path = output_dir / 'classification_summary.md'
    
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('# 분류 성능 평가 리포트\n\n')
        f.write('## 개요\n\n')
        f.write('이 리포트는 여러 시나리오×모드 조합에 대한 분류 성능을 요약합니다.\n\n')
        f.write('## 성능 지표\n\n')
        f.write('| Scenario | Mode | Acc | Prec(H) | Recall(H) | F1(H) | FP_rate | FN_rate |\n')
        f.write('|----------|------|-----|---------|-----------|-------|----------|----------|\n')
        
        # 시나리오별로 정렬
        scenarios = sorted(set(k[0] for k in results.keys()))
        modes = ['BASELINE', 'FUSION']
        
        for scenario in scenarios:
            for mode in modes:
                key = (scenario, mode)
                if key not in results:
                    continue
                
                metrics = results[key]
                f.write(f"| {scenario} | {mode} | "
                       f"{metrics.get('accuracy', 0):.3f} | "
                       f"{metrics.get('HOSTILE_precision', 0):.3f} | "
                       f"{metrics.get('HOSTILE_recall', 0):.3f} | "
                       f"{metrics.get('HOSTILE_f1', 0):.3f} | "
                       f"{metrics.get('FP_rate', 0):.3f} | "
                       f"{metrics.get('FN_rate', 0):.3f} |\n")
        
        f.write('\n## 상세 통계\n\n')
        
        for scenario in scenarios:
            f.write(f'### {scenario}\n\n')
            for mode in modes:
                key = (scenario, mode)
                if key not in results:
                    continue
                
                metrics = results[key]
                f.write(f'#### {mode}\n\n')
                f.write(f'- Accuracy: {metrics.get("accuracy", 0):.4f}\n')
                f.write(f'- Total Predictions: {metrics.get("total_predictions", 0)}\n')
                f.write(f'- Correct: {metrics.get("correct", 0)}\n')
                f.write(f'- Incorrect: {metrics.get("incorrect", 0)}\n')
                f.write(f'- FP Rate: {metrics.get("FP_rate", 0):.4f}\n')
                f.write(f'- FN Rate: {metrics.get("FN_rate", 0):.4f}\n')
                f.write('\n')
                
                for label in ['HOSTILE', 'CIVIL', 'UNKNOWN']:
                    f.write(f'**{label}:**\n')
                    f.write(f'- Precision: {metrics.get(f"{label}_precision", 0):.4f}\n')
                    f.write(f'- Recall: {metrics.get(f"{label}_recall", 0):.4f}\n')
                    f.write(f'- F1: {metrics.get(f"{label}_f1", 0):.4f}\n')
                    f.write(f'- TP: {metrics.get(f"{label}_TP", 0)}, FP: {metrics.get(f"{label}_FP", 0)}, FN: {metrics.get(f"{label}_FN", 0)}\n')
                    f.write('\n')
    
    print(f"\n리포트 저장: {report_path}")


def save_roc_pr_data(
    results: Dict[Tuple[str, str], Dict],
    output_dir: Path
) -> None:
    """ROC/PR Curve 데이터를 JSON으로 저장"""
    
    roc_pr_dir = output_dir / 'roc_pr_data'
    roc_pr_dir.mkdir(exist_ok=True)
    
    for (scenario, mode), data in results.items():
        if 'roc_pr_data' not in data:
            continue
        
        filename = f'roc_pr_{scenario}_{mode}.json'
        filepath = roc_pr_dir / filename
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump({
                'scenario': scenario,
                'mode': mode,
                **data['roc_pr_data']
            }, f, indent=2)
        
        print(f"ROC/PR 데이터 저장: {filepath}")


# ============================================
# 메인 함수
# ============================================

def main():
    parser = argparse.ArgumentParser(description='2차 성능 향상 평가 리포트 생성')
    parser.add_argument(
        '--logs-dir',
        type=str,
        default='../simulator/logs/eval',
        help='평가 로그 디렉토리 경로'
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        default='results',
        help='결과 출력 디렉토리'
    )
    parser.add_argument(
        '--threat-threshold',
        type=float,
        default=THREAT_ENGAGE_THRESHOLD,
        help=f'위협 점수 임계값 (기본값: {THREAT_ENGAGE_THRESHOLD})'
    )
    
    args = parser.parse_args()
    
    logs_dir = Path(args.logs_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True)
    
    if not logs_dir.exists():
        print(f"Error: 로그 디렉토리를 찾을 수 없습니다: {logs_dir}")
        sys.exit(1)
    
    print(f"로그 디렉토리: {logs_dir}")
    print(f"결과 출력 디렉토리: {output_dir}")
    print()
    
    # 모든 로그 파일 찾기 (run_*.jsonl 또는 gen_*.jsonl 패턴)
    log_files = list(logs_dir.glob('**/run_*.jsonl'))
    if not log_files:
        # run_*.jsonl이 없으면 gen_*.jsonl도 시도
        log_files = list(logs_dir.glob('**/*.jsonl'))
    
    if not log_files:
        print("Warning: 로그 파일을 찾을 수 없습니다.")
        print(f"  예상 경로: {logs_dir}/**/run_*.jsonl")
        return
    
    print(f"총 {len(log_files)}개 로그 파일 발견")
    print()
    
    # 디버그: true_label 분포 확인
    print("=== True Label 분포 확인 (디버그) ===")
    for log_file in log_files[:3]:  # 처음 3개만 확인
        events = load_log_events(log_file)
        drone_labels = extract_drone_labels(events)
        label_counts = defaultdict(int)
        for label in drone_labels.values():
            label_counts[label] += 1
        print(f"  {log_file.name}: {dict(label_counts)}")
    print()
    
    # 시나리오×모드별로 그룹화
    results: Dict[Tuple[str, str], Dict] = {}
    
    for log_file in log_files:
        # 경로에서 시나리오와 모드 추출
        # 예: logs/eval/all_hostile_baseline/BASELINE/run_0.jsonl
        # 또는: logs/eval/all_hostile_fusion/FUSION/gen_*.jsonl
        parts = log_file.parts
        
        # logs/eval 경로를 기준으로 상대 경로 계산
        try:
            rel_path = log_file.relative_to(logs_dir)
            parts = rel_path.parts
        except ValueError:
            # 절대 경로인 경우
            if 'eval' in parts:
                eval_index = parts.index('eval')
                parts = parts[eval_index + 1:]
            else:
                continue
        
        if len(parts) < 2:
            continue
        
        experiment_name = parts[0] if len(parts) >= 2 else parts[-3]  # all_hostile_baseline
        mode = parts[1] if len(parts) >= 2 else parts[-2]  # BASELINE or FUSION
        
        # 실험 이름에서 시나리오 추출
        # experiment_name 예시: "all_hostile_baseline", "mixed_civil_fusion", "civil_only_fusion"
        if 'all_hostile' in experiment_name:
            scenario = 'all_hostile'
        elif 'mixed_civil' in experiment_name:
            scenario = 'mixed_civil'
        elif 'civil_only' in experiment_name:
            scenario = 'civil_only'
        else:
            continue
        
        key = (scenario, mode)
        
        print(f"처리 중: {scenario} / {mode} - {log_file.name}")
        
        # 예측 데이터 추출
        predictions = extract_predictions_from_log(log_file)
        
        if not predictions:
            print(f"  Warning: 예측 데이터가 없습니다.")
            continue
        
        # 디버그: pred_label 분포 확인
        pred_label_counts = defaultdict(int)
        true_label_counts = defaultdict(int)
        for p in predictions:
            pred_label_counts[p['pred_label']] += 1
            true_label_counts[p['true_label']] += 1
        
        print(f"    True labels: {dict(true_label_counts)}")
        print(f"    Pred labels: {dict(pred_label_counts)}")
        
        # 성능 지표 계산
        metrics = compute_metrics(predictions)
        
        # ROC/PR 데이터 계산 (HOSTILE 기준)
        roc_pr_data = compute_roc_pr_data(predictions, 'HOSTILE')
        
        # 결과 누적
        if key not in results:
            results[key] = {
                'predictions': [],
                'metrics': {
                    'accuracy': 0.0,
                    'total_predictions': 0,
                    'correct': 0,
                    'incorrect': 0,
                    'HOSTILE_precision': 0.0,
                    'HOSTILE_recall': 0.0,
                    'HOSTILE_f1': 0.0,
                    'FP_rate': 0.0,
                    'FN_rate': 0.0,
                },
                'roc_pr_data': roc_pr_data,
            }
        
        # 평균 계산을 위해 데이터 누적
        results[key]['predictions'].extend(predictions)
    
    # 최종 평균 계산
    for key in results:
        all_predictions = results[key]['predictions']
        if all_predictions:
            final_metrics = compute_metrics(all_predictions)
            results[key]['metrics'] = final_metrics
    
    # 리포트 생성
    metrics_results = {k: v['metrics'] for k, v in results.items()}
    generate_report(metrics_results, output_dir)
    
    # ROC/PR 데이터 저장
    save_roc_pr_data(results, output_dir)
    
    # Metrics JSON 저장 (auto_tune에서 사용)
    metrics_json_path = output_dir / 'metrics.json'
    with open(metrics_json_path, 'w', encoding='utf-8') as f:
        # 키를 문자열로 변환 (JSON 호환)
        # 형식: "all_hostile_FUSION", "mixed_civil_FUSION" 등
        metrics_dict = {}
        for (scenario, mode), metrics in metrics_results.items():
            key_str = f"{scenario}_{mode}"
            metrics_dict[key_str] = metrics
        json.dump(metrics_dict, f, indent=2)
    
    print("\n=== 분석 완료 ===")
    print(f"\n결과 파일:")
    print(f"  - {output_dir / 'classification_summary.md'}")
    print(f"  - {output_dir / 'metrics.json'}")
    print(f"  - {output_dir / 'roc_pr_data'}/*.json")


if __name__ == '__main__':
    main()

