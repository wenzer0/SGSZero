"""Argmax collapse figure — same code path only (top-N random sampling)."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import csv, os

os.makedirs('docs/figures', exist_ok=True)

# ---- same-path data (top-N random, 100 games each) ----
labels  = ['top-1\n(argmax)', 'top-2\n(random)', 'top-3\n(random)', 'top-5\n(random)']
win     = [0.44, 0.66, 0.62, 0.63]
turns_m = [60.4, 31, 20, 20]          # median; top-1 has mean only
top1_is_mean = True
n = 100
ci = [1.96*np.sqrt(p*(1-p)/n) for p in win]

with open('docs/figures/argmax_collapse.csv','w',newline='',encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['config','win_rate','win_ci95','turns_median','games','note'])
    for i in range(4):
        note = 'median not reported, mean=60.4 used' if (i==0 and top1_is_mean) else ''
        w.writerow([labels[i].replace('\n',' '), win[i], round(ci[i],3), turns_m[i], n, note])

plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,(ax1,ax2)=plt.subplots(1,2,figsize=(11,4.4)); x=np.arange(4)

# --- left: win rate ---
ax1.errorbar(x,[v*100 for v in win],yerr=[c*100 for c in ci],
             fmt='o-',capsize=5,color='#2E86AB',ms=9,lw=2,zorder=3)
ax1.axhline(50,ls='--',c='#888',lw=1.2,label='random (50%)')
ax1.axhline(58,ls=':',c='#E67E22',lw=1.5,label='rule AI self-play (58%)')
ax1.annotate('argmax collapse',xy=(0,44),xytext=(0.3,33),
             arrowprops=dict(arrowstyle='->',color='#C0392B'),color='#C0392B',fontsize=9)
ax1.set_xticks(x); ax1.set_xticklabels(labels)
ax1.set_ylabel('Landlord win rate (%)'); ax1.set_ylim(28,82)
ax1.set_title('Win rate vs. candidate set size',fontsize=11)
ax1.legend(fontsize=8,loc='lower right'); ax1.grid(alpha=.25)

# --- right: median turns ---
ax2.plot(x,turns_m,'s-',color='#A23B72',ms=9,lw=2,zorder=3)
ax2.annotate('mean only\n(median n/r)',xy=(0,60.4),xytext=(0.3,50),
             arrowprops=dict(arrowstyle='->',color='#888'),color='#666',fontsize=8)
ax2.set_xticks(x); ax2.set_xticklabels(labels)
ax2.set_ylabel('Median turns per game'); ax2.set_ylim(0,70)
ax2.set_title('Game length vs. candidate set size',fontsize=11)
ax2.grid(alpha=.25)

fig.suptitle('Same code path only: top-1 (argmax) collapses; any tolerance recovers '
             '(100 games/point, 95% CI)', fontsize=10.5, y=1.02)
plt.tight_layout()
plt.savefig('docs/figures/argmax_collapse.png',dpi=220,bbox_inches='tight')
print('saved')
