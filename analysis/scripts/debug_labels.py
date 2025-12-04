"""
true_label / pred_label 디버깅 스크립트

로그 파일에서 true_label 분포와 pred_label 분포를 확인합니다.
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
from typing import Dict, List

def analyze_log_file(log_file: Path) -> Dict:
    """로그 파일 분석"""
    true_label_counts = defaultdict(int)
    pred_label_counts = defaultdict(int)
    confusion_matrix = defaultdict(lambda: defaultdict(int))
    
    total_events = 0
    drone_spawned_events = 0
    fused_track_events = 0
    
    with open(log_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            try:
                event = json.loads(line)
                total_events += 1
                
                # drone_spawned 이벤트에서 true_label 확인
                if event.get('event') == 'drone_spawned':
                    drone_spawned_events += 1
                    true_label = event.get('true_label')
                    if true_label:
                        true_label_counts[true_label] += 1
                
                # fused_track_update 이벤트에서 pred_label 계산
                if event.get('event') == 'fused_track_update':
                    fused_track_events += 1
                    true_label = event.get('true_label')
                    threat_score = event.get('threat_score') or event.get('fused_threat_score')
                    classification = event.get('classification') or event.get('fused_classification')
                    class_confidence = event.get('class_confidence') or event.get('class_info', {}).get('confidence', 0)
                    
                    # pred_label 계산
                    pred_label = 'UNKNOWN'
                    if threat_score is not None and threat_score >= 70:
                        pred_label = 'HOSTILE'
                    elif classification == 'CIVIL' and class_confidence >= 0.7:
                        pred_label = 'CIVIL'
                    
                    if true_label:
                        pred_label_counts[pred_label] += 1
                        confusion_matrix[true_label][pred_label] += 1
                        
            except json.JSONDecodeError:
                continue
    
    return {
        'total_events': total_events,
        'drone_spawned_events': drone_spawned_events,
        'fused_track_events': fused_track_events,
        'true_label_counts': dict(true_label_counts),
        'pred_label_counts': dict(pred_label_counts),
        'confusion_matrix': {k: dict(v) for k, v in confusion_matrix.items()},
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python debug_labels.py <log_file.jsonl>")
        sys.exit(1)
    
    log_file = Path(sys.argv[1])
    if not log_file.exists():
        print(f"Error: Log file not found: {log_file}")
        sys.exit(1)
    
    print(f"Analyzing: {log_file}")
    print("=" * 60)
    
    result = analyze_log_file(log_file)
    
    print(f"\nTotal events: {result['total_events']}")
    print(f"Drone spawned events: {result['drone_spawned_events']}")
    print(f"Fused track update events: {result['fused_track_events']}")
    
    print("\n=== True Label Distribution ===")
    for label, count in sorted(result['true_label_counts'].items()):
        print(f"  {label}: {count}")
    
    print("\n=== Pred Label Distribution ===")
    for label, count in sorted(result['pred_label_counts'].items()):
        print(f"  {label}: {count}")
    
    print("\n=== Confusion Matrix ===")
    print("True\\Pred | HOSTILE | CIVIL | UNKNOWN")
    print("-" * 40)
    for true_label in ['HOSTILE', 'CIVIL', 'UNKNOWN']:
        row = confusion_matrix.get(true_label, {})
        print(f"{true_label:9} | {row.get('HOSTILE', 0):7} | {row.get('CIVIL', 0):5} | {row.get('UNKNOWN', 0):7}")


if __name__ == '__main__':
    main()

