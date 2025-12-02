#!/usr/bin/env python3
"""
PN vs PURE_PURSUIT 유도 모드 성능 비교 시각화
"""

import matplotlib
matplotlib.use('Agg')  # GUI 없는 백엔드
import matplotlib.pyplot as plt
import numpy as np

# 한글 폰트 설정
matplotlib.rcParams['font.family'] = 'Apple SD Gothic Neo'
matplotlib.rcParams['axes.unicode_minus'] = False

# 실험 데이터 (30회 실험 기준)
data = {
    'PN (최적화 전)': {
        'success_rate': 35.71,
        'attempts': 70,
        'successes': 25,
        'failures': 45,
        'total_drones': 255,
        'neutralized': 25
    },
    'PN (최적화 후)': {
        'success_rate': 35.56,
        'attempts': 135,
        'successes': 48,
        'failures': 87,
        'total_drones': 255,
        'neutralized': 48
    },
    'PURE_PURSUIT': {
        'success_rate': 38.10,
        'attempts': 189,
        'successes': 72,
        'failures': 117,
        'total_drones': 255,
        'neutralized': 72
    }
}

# 색상 팔레트
colors = {
    'PN (최적화 전)': '#ff6b6b',      # 빨강
    'PN (최적화 후)': '#4ecdc4',       # 청록
    'PURE_PURSUIT': '#45b7d1'          # 파랑
}

fig = plt.figure(figsize=(16, 10))
fig.suptitle('Proportional Navigation (PN) vs Pure Pursuit 유도 알고리즘 비교\n(30회 실험 기준)', 
             fontsize=16, fontweight='bold', y=0.98)

# 1. 요격 성공률 비교
ax1 = fig.add_subplot(2, 3, 1)
modes = list(data.keys())
success_rates = [data[m]['success_rate'] for m in modes]
bars1 = ax1.bar(range(len(modes)), success_rates, color=[colors[m] for m in modes], 
                edgecolor='black', linewidth=1.5)
ax1.set_ylabel('성공률 (%)', fontsize=11)
ax1.set_title('① 요격 성공률', fontsize=13, fontweight='bold')
ax1.set_xticks(range(len(modes)))
ax1.set_xticklabels(['PN\n(최적화 전)', 'PN\n(최적화 후)', 'PURE\nPURSUIT'], fontsize=9)
ax1.set_ylim(0, 50)
ax1.axhline(y=40, color='gray', linestyle='--', alpha=0.5, label='목표 40%')
for i, (bar, val) in enumerate(zip(bars1, success_rates)):
    ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, 
             f'{val:.1f}%', ha='center', fontsize=10, fontweight='bold')

# 2. 요격 시도 횟수 비교
ax2 = fig.add_subplot(2, 3, 2)
attempts = [data[m]['attempts'] for m in modes]
bars2 = ax2.bar(range(len(modes)), attempts, color=[colors[m] for m in modes], 
                edgecolor='black', linewidth=1.5)
ax2.set_ylabel('시도 횟수', fontsize=11)
ax2.set_title('② 요격 시도 횟수', fontsize=13, fontweight='bold')
ax2.set_xticks(range(len(modes)))
ax2.set_xticklabels(['PN\n(최적화 전)', 'PN\n(최적화 후)', 'PURE\nPURSUIT'], fontsize=9)
ax2.set_ylim(0, 220)
for bar, val in zip(bars2, attempts):
    ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 3, 
             f'{val}회', ha='center', fontsize=10, fontweight='bold')

# 개선 화살표
ax2.annotate('', xy=(1, 135), xytext=(0, 70),
             arrowprops=dict(arrowstyle='->', color='#2ecc71', lw=3))
ax2.text(0.5, 95, '+93%', fontsize=11, color='#2ecc71', fontweight='bold', ha='center',
         bbox=dict(boxstyle='round', facecolor='white', edgecolor='#2ecc71', alpha=0.8))

# 3. 실제 격추 수 비교
ax3 = fig.add_subplot(2, 3, 3)
successes = [data[m]['successes'] for m in modes]
bars3 = ax3.bar(range(len(modes)), successes, color=[colors[m] for m in modes], 
                edgecolor='black', linewidth=1.5)
ax3.set_ylabel('격추 횟수', fontsize=11)
ax3.set_title('③ 실제 격추 수 (핵심 지표)', fontsize=13, fontweight='bold')
ax3.set_xticks(range(len(modes)))
ax3.set_xticklabels(['PN\n(최적화 전)', 'PN\n(최적화 후)', 'PURE\nPURSUIT'], fontsize=9)
ax3.set_ylim(0, 90)
for bar, val in zip(bars3, successes):
    ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, 
             f'{val}회', ha='center', fontsize=10, fontweight='bold')

# 개선 화살표
ax3.annotate('', xy=(1, 48), xytext=(0, 25),
             arrowprops=dict(arrowstyle='->', color='#2ecc71', lw=3))
ax3.text(0.5, 34, '+92%', fontsize=11, color='#2ecc71', fontweight='bold', ha='center',
         bbox=dict(boxstyle='round', facecolor='white', edgecolor='#2ecc71', alpha=0.8))

# 4. 성공/실패 분포 (스택 바)
ax4 = fig.add_subplot(2, 3, 4)
successes_list = [data[m]['successes'] for m in modes]
failures_list = [data[m]['failures'] for m in modes]
x = range(len(modes))
width = 0.6
bars_success = ax4.bar(x, successes_list, width, label='성공', color='#2ecc71', edgecolor='black')
bars_fail = ax4.bar(x, failures_list, width, bottom=successes_list, label='실패', color='#e74c3c', edgecolor='black')
ax4.set_ylabel('횟수', fontsize=11)
ax4.set_title('④ 성공/실패 분포', fontsize=13, fontweight='bold')
ax4.set_xticks(x)
ax4.set_xticklabels(['PN\n(최적화 전)', 'PN\n(최적화 후)', 'PURE\nPURSUIT'], fontsize=9)
ax4.legend(loc='upper right')
for i, (s, f) in enumerate(zip(successes_list, failures_list)):
    ax4.text(i, s/2, f'{s}', ha='center', va='center', fontsize=10, fontweight='bold', color='white')
    ax4.text(i, s + f/2, f'{f}', ha='center', va='center', fontsize=10, fontweight='bold', color='white')

# 5. 무력화율 (전체 드론 대비)
ax5 = fig.add_subplot(2, 3, 5)
neutralize_rates = [data[m]['neutralized'] / data[m]['total_drones'] * 100 for m in modes]
bars5 = ax5.bar(range(len(modes)), neutralize_rates, color=[colors[m] for m in modes], 
                edgecolor='black', linewidth=1.5)
ax5.set_ylabel('무력화율 (%)', fontsize=11)
ax5.set_title('⑤ 전체 드론 무력화율 (255기 기준)', fontsize=13, fontweight='bold')
ax5.set_xticks(range(len(modes)))
ax5.set_xticklabels(['PN\n(최적화 전)', 'PN\n(최적화 후)', 'PURE\nPURSUIT'], fontsize=9)
ax5.set_ylim(0, 40)
for bar, val in zip(bars5, neutralize_rates):
    ax5.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, 
             f'{val:.1f}%', ha='center', fontsize=10, fontweight='bold')

# 6. 요약 텍스트 박스
ax6 = fig.add_subplot(2, 3, 6)
ax6.axis('off')

summary_text = """
[분석 결과 요약]

+-------------------------------------------+
|  PN 최적화 효과                            |
+-------------------------------------------+
|  [O] 요격 시도: 70회 -> 135회 (+93%)       |
|  [O] 실제 격추: 25회 -> 48회 (+92%)        |
|  [!] 성공률: 35.71% -> 35.56% (-0.15%p)   |
+-------------------------------------------+

[핵심 인사이트]
  * 성공률은 거의 동일하지만
  * 교전 기회가 2배 증가하여
  * 실제 방어력(격추 수)이 크게 향상됨

[결론]
  PN 최적화는 "더 적극적인 교전"을
  통해 전체 방어 효율을 높이는 데 성공

[PURE_PURSUIT 대비]
  * 성공률: -2.5%p (약간 열세)
  * 총 시도 수: -29% (덜 공격적)
  * 장단점이 있어 상황에 따라 선택 필요
"""

ax6.text(0.05, 0.95, summary_text, transform=ax6.transAxes, fontsize=10,
         verticalalignment='top', fontfamily='Apple SD Gothic Neo',
         bbox=dict(boxstyle='round', facecolor='#f8f9fa', edgecolor='#dee2e6', alpha=0.9))

plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.savefig('analysis/guidance_comparison.png', dpi=150, bbox_inches='tight', facecolor='white')
plt.close()
print("✅ 시각화 저장 완료: analysis/guidance_comparison.png")

