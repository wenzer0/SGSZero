"""Architecture diagram — paper style: square boxes, thin lines, tensor shapes."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch

INK   = '#1a1a1a'
FILL  = '#f2f2f2'
ACC   = '#c0392b'   # only for the privileged head
LW    = 1.0

def box(ax, x, y, w, h, text, fc=FILL, ec=INK, ls='-', fs=8, bold=False, color=INK):
    ax.add_patch(Rectangle((x, y), w, h, fc=fc, ec=ec, lw=LW, ls=ls, zorder=2))
    ax.text(x+w/2, y+h/2, text, ha='center', va='center', fontsize=fs, zorder=3,
            color=color, fontweight='bold' if bold else 'normal', linespacing=1.4)

def arr(ax, p1, p2, color=INK, ls='-'):
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle='-|>', mutation_scale=11,
                                 color=color, lw=LW, ls=ls, zorder=1,
                                 shrinkA=0, shrinkB=0))

def shape(ax, x, y, t, color='#666'):
    ax.text(x, y, t, fontsize=6.8, color=color, ha='center', va='top', style='italic')

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10.5, 5.6))
for ax in (ax1, ax2):
    ax.set_xlim(0, 11.6); ax.set_ylim(0, 3.2); ax.axis('off')

# ---------- (a) training ----------
ax1.text(0.05, 3.05, '(a)  Training', fontsize=10, fontweight='bold', color=INK)

box(ax1, 0.1, 1.35, 1.25, 0.75, 'observable\nstate', fs=7.6)
box(ax1, 1.95, 1.35, 1.15, 0.75, 'tokenizer', fs=7.6)
box(ax1, 3.7, 1.15, 1.5, 1.15, 'encoder\n3 layers', fs=7.6, bold=True)
box(ax1, 5.85, 1.85, 1.25, 0.6, 'policy', fs=7.6)
box(ax1, 5.85, 0.42, 1.25, 0.6, 'value', fs=7.6, ec=ACC, fc='#fdf2f0', color=ACC)
box(ax1, 7.85, 1.85, 1.15, 0.6, 'play/pass', fs=7.6)
box(ax1, 7.85, 0.42, 1.15, 0.6, '13 bins', fs=7.6, ec=ACC, fc='#fdf2f0', color=ACC)
box(ax1, 9.75, 0.42, 1.55, 0.6, 'rule engine\nvaluation', fs=7.0, fc='white', ls='--')

arr(ax1, (1.36, 1.72), (1.94, 1.72))
arr(ax1, (3.11, 1.72), (3.69, 1.72))
arr(ax1, (5.21, 1.9), (5.84, 2.12))
arr(ax1, (5.21, 1.55), (5.84, 0.74), color=ACC)
arr(ax1, (7.11, 2.15), (7.84, 2.15))
arr(ax1, (7.11, 0.72), (7.84, 0.72), color=ACC)
arr(ax1, (9.73, 0.72), (9.02, 0.72), color='#999', ls=':')

shape(ax1, 2.52, 1.30, '[B, 561]')
shape(ax1, 4.45, 1.10, '[B, 561, 256]')
shape(ax1, 6.47, 0.36, 'supervised by $v$')

# ---------- (b) deployment ----------
ax2.text(0.05, 3.05, '(b)  Deployment', fontsize=10, fontweight='bold', color=INK)

box(ax2, 0.1, 1.35, 1.25, 0.75, 'observable\nstate', fs=7.6)
box(ax2, 1.95, 1.35, 1.15, 0.75, 'tokenizer', fs=7.6)
box(ax2, 3.7, 1.15, 1.5, 1.15, 'encoder\n3 layers', fs=7.6, bold=True)
box(ax2, 5.85, 1.35, 1.25, 0.75, 'policy', fs=7.6)
box(ax2, 7.85, 1.35, 1.15, 0.75, 'play/pass', fs=7.6)

arr(ax2, (1.36, 1.72), (1.94, 1.72))
arr(ax2, (3.11, 1.72), (3.69, 1.72))
arr(ax2, (5.21, 1.72), (5.84, 1.72))
arr(ax2, (7.11, 1.72), (7.84, 1.72))

# removed head: dashed outline only, no fill
ax2.add_patch(Rectangle((5.85, 0.42), 1.25, 0.6, fc='white', ec='#8a8a8a', lw=1.0, ls=(0,(3,2))))
ax2.plot([5.98, 6.98], [0.60, 0.84], color='#8a8a8a', lw=1.0)
arr(ax2, (5.21, 1.5), (5.84, 0.75), color='#8a8a8a', ls=(0,(3,2)))

ax2.text(9.2, 1.72, '1.76M params\n6.72 MB\nCPU, ms', fontsize=7, color='#555',
         ha='left', va='center', linespacing=1.5)
shape(ax2, 2.52, 1.30, '[B, 561]')
shape(ax2, 4.45, 1.10, '[B, 561, 256]')

fig.text(0.5, 0.015,
         'The value head exists only during training: it is supervised by the rule engine\u2019s per-card valuation and removed before deployment.',
         ha='center', fontsize=7.6, color='#444', style='italic')

plt.tight_layout(rect=[0, 0.035, 1, 1])
plt.savefig('docs/figures/architecture.png', dpi=240, bbox_inches='tight')
plt.savefig('docs/figures/architecture.pdf', bbox_inches='tight')
print('saved')
