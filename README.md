# SGSZero

A Sanguosha agent trained from scratch. 1.76M parameters, CPU inference in milliseconds, **80.9%** accuracy on play/pass decisions.

**English** | [中文](README.zh-CN.md)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23828678.svg)](https://doi.org/10.5281/zenodo.23828678)

| | |
|---|---|
| **Task** | Play or pass, at the play phase |
| **Accuracy** | **80.9%** (majority baseline 74.4%) |
| **Model** | 1,760,527 parameters / 6.72 MB |
| **Inference** | CPU, milliseconds, no GPU required |
| **Training** | 40 epochs / 70 s / a single RTX 4060 |
| **Data** | 13,536 self-collected games, zero human labels |

[Preprint](https://doi.org/10.5281/zenodo.23828678) · [PDF](paper/main.pdf) · [Reproduce](#reproduce)

---

## Why

Sanguosha has several hundred hero skills, chained effect resolution, and hidden hands — among the more complex card games — yet no open decision-making agent exists for it.

The name is a nod to [DouZero](https://github.com/kwai/DouZero): zero human data for DouDizhu. This time it is Sanguosha.

## What this is

A pipeline from collection to deployment:

1. **Collect** — `scripts/bot.js` injects into [Noname](https://github.com/libnoname/noname), letting its built-in rule engine (10,966 lines of hand-written rules) play itself, logging every (state, decision) pair.
2. **Train** — each state becomes a 561-token sequence, fed to a 3-layer Transformer that learns "should I play a card here?"
3. **Distill** — the rule engine scores every card in hand. Players cannot see those scores, but training uses them to supervise an auxiliary head that is discarded before deployment.
4. **Deploy** — 1.76M parameters, millisecond inference on CPU.

## Status

| Stage | Result |
|---|---|
| v1 — SFT + LUPI | **80.9%** play/pass accuracy ([preprint](https://doi.org/10.5281/zenodo.23828678)) |
| Stage 1 — diagnosis | **Argmax collapse**: a supervised top-1 policy wins only 44% of games; sampling from a candidate set recovers 62–66% |
| Stage 2 — DQN RL | v6 **48.0%** vs a hand-written rule AI's 46.7% |
| Stage 3 — in progress | Full action space → self-play / PFSP → scale |

**The honest reading of Stage 2:** diff −1.3pt, 95% CI [−7.7, +5.1], t = −0.41 — **statistically indistinguishable, not a win over the rule AI**. More importantly, the agent currently controls only **1 of 9** decision interfaces in the engine (`use_phase_action`: which card to play, plus pass). The other eight (responses, saves, wuxie, discards, all `choose_*`) still run the rule AI. **This is an architectural ceiling, not a capability ceiling** — and it is what Stage 3 expands.

See [conclusions and goal statement](docs/results/结论修订与目标说明.md).

> Every win rate in this repo follows the [evaluation protocol](docs/protocol/评估协议-标准.md): paired same-deal runs, argmax, six mandatory fields. The six measurement pitfalls that each invalidated a conclusion along the way are documented [here](docs/protocol/评估协议-六个陷阱.md).

## Results

Task A: decide whether to play a card or pass at the play phase.

| Version | Input | Val | Accuracy | Note |
|---|---|---|---|---|
| V5 | Full state + engine valuations | 819 | 83.9% | Collapses to 35.6% at deployment |
| V6 | Observable-only | 819 | 78.0–78.4% | True level without privileged input |
| V7 | Observable + value head | 819 | 80.8–81.8% | LUPI recovers most of the gap |
| **V8** | **All observable fields + value head** | 340 | **80.6–80.9%** | Most complete feature set |
| — | Majority baseline | 340 | 74.4% | |

**Three findings worth keeping:**

- **Capacity is not the bottleneck; data is.** Seven hyper-parameter configurations all plateaued at 72–73%. A 7.6% increase in data moved accuracy by 5.3 points.
- **Data quality beats data quantity.** 11k records with the complete feature set matched 30k mixed records (roughly 2.7×).
- **Averages hide local failures.** With no attack card in hand, the model was only 2.9 points above the majority baseline. The value head lifts that to +19.6.

## Method: why privileged information

The rule engine knows what each card is worth. Players do not, and neither does a deployed model. Feeding those numbers in as features teaches the model to read the number instead of the game — which is exactly how V5 collapsed from 83.9% to 35.6%.

So we use LUPI (Learning Using Privileged Information) instead:

```
train:   observable state → encoder → decision head (play/pass)
                                   └→ value head (per-card utility, 13 bins)
deploy:  observable state → encoder → decision head        (value head dropped)
```

The value head exists only during training. Its job is to force the encoder to internalize card utility rather than read it off an input feature.

> This differs from **PerfectDou** (arXiv:2203.16406). PerfectDou's privileged signal is the opponent's hand — information that exists but is hidden, so it closes an *observability* gap. Ours is a scalar valuation computed by a symbolic engine, which exists nowhere in the game state; it closes a *knowledge* gap. Revealing every card would not help: a network still has to learn what a card is worth.

## Repository layout

```
SGSZero/
├── scripts/
│   └── bot.js              # Noname injection: auto-play + per-decision logging
├── docs/
│   ├── README.md           # Documentation index (start here)
│   ├── results/            # Stage 1 / 2 result logs, kept as-is in time order
│   ├── protocol/           # Evaluation standard + six pitfalls
│   ├── figures/            # Two paper figures + reproducible plot scripts
│   └── *.md                # Early design documents
├── paper/
│   ├── main.tex / main.pdf # v1 preprint (Task A + LUPI, 80.9%)
│   └── v2-outline.md       # v2 outline, NOT the paper; method section outdated
└── CITATION.cff / LICENSE
```

**Known gap:** `src/` (tokenizer, training, evaluation) and `engine/` (ported rule engine) are **not public yet**, so a fresh clone cannot run training. They will be added once the Stage 3 action space stabilizes and the deployment-consistency checks pass — publishing the code now would make it stale within weeks.

The commands below describe the v1 pipeline; the public repo currently ships the data-collection script plus the full set of research documents.

## Reproduce

```bash
# Rebuild the dataset
python src/tok/build.py

# Sanity checks (overfit / mask / shuffled labels)
python src/train/train.py --check
python src/train/train.py --quick

# Train (best configuration)
python src/train/train.py --d-model 256 --layers 3 --epochs 40 --seed 7
```

Environment: Python 3.13 + PyTorch 2.11 (cu128). 40 epochs take about 70 seconds on an RTX 4060 Laptop.

## Paper

**SGSzero: Training a Compact Sanguosha Agent via Privileged Rule-Based Supervision**
Evan Wen · Independent Researcher · [ORCID 0009-0005-7254-8002](https://orcid.org/0009-0005-7254-8002)

- **Preprint**: [10.5281/zenodo.23828678](https://doi.org/10.5281/zenodo.23828678) (Zenodo, 2026-10-31)
- **arXiv**: pending endorsement
- **PDF**: [paper/main.pdf](paper/main.pdf)

If you find this useful, please cite:

```bibtex
@misc{wen2026sgszero,
  title  = {SGSzero: Training a Compact Sanguosha Agent via Privileged Rule-Based Supervision},
  author = {Wen, Evan},
  year   = {2026},
  doi    = {10.5281/zenodo.23828678},
  url    = {https://doi.org/10.5281/zenodo.23828678}
}
```

## License

- The Noname engine is a third-party GPL-3.0 project ([libnoname/noname](https://github.com/libnoname/noname)). This repository uses it only as a training environment and does not redistribute the engine.
- This project's code is released under GPL-3.0, matching the upstream license to avoid conflicts.

## Disclaimer

This is an independent academic project, not affiliated with or endorsed by Yoka Games.

*Sanguosha* (Legends of the Three Kingdoms) is a registered trademark of Yoka Games. This project mentions the game only as a research subject, contains no proprietary game assets, and uses a third-party open-source implementation as its environment.

---

*Start from zero, then win the first game.*
