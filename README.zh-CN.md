# SGSZero

[English](README.md) | **中文**

从零训练的三国杀出牌 AI。1.76M 参数，CPU 实时推理，出牌决策准确率 **80.9%**。

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23828678.svg)](https://doi.org/10.5281/zenodo.23828678)

| 项目 | 数据 |
|---|---|
| 任务 | 出牌阶段判断「出还是不出」 |
| 准确率 | **80.9%**（多数类基线 74.4%） |
| 模型 | 1,760,527 参数 / 6.72 MB |
| 推理 | CPU，毫秒级，无需 GPU |
| 训练 | 40 epoch / 70 秒 / 单张 RTX 4060 |
| 数据 | 13,536 条自采对局记录，零人工标注 |

[预印本](https://doi.org/10.5281/zenodo.23828678) · [论文 PDF](paper/main.pdf) · [复现](#复现)

---

## 为什么做这个

三国杀有几百个武将技能、连锁结算、隐藏手牌，在卡牌游戏里算复杂的一类，但至今没有一个开源的决策 AI。

名字致敬 [DouZero](https://github.com/kwai/DouZero)——斗地主从零开始。这次轮到三国杀了。

## 这个项目是什么

一条完整的管线，从采集到部署：

1. **采集** — `scripts/bot.js` 注入[无名杀](https://github.com/libnoname/noname)，让内置强 AI（10,966 行手写规则）自己跟自己打，逐手记录「局面 → 决策」。
2. **训练** — 局面编码成 561 个 token 的序列，喂给 3 层 Transformer，学「这个局面该不该出牌」。
3. **蒸馏** — 规则 AI 会给每张牌打分，这个分数玩家看不到，但训练时作为特权信号监督一个辅助头，部署时丢掉。
4. **部署** — 1.76M 参数，CPU 毫秒级出牌，不需要 GPU。

## 当前进度

- [x] 数据采集管线：bot.js 注入 + 强 AI 自对弈，决策样本落盘
- [x] Tokenizer + SFT 训练：**出牌决策准确率 80.9%**（v1 论文）
- [x] 阶段 1：定位 **argmax 塌陷**（监督策略 top-1 整局 44%，扩展候选集恢复 62–66%）
- [x] 阶段 2：DQN 策略 RL，v6 在统一 argmax 口径下 **48.0%**
- [ ] 阶段 3：完整动作空间 → 自对弈 / PFSP → 规模化（进行中）

**阶段 2 的诚实结论**：v6 48.0% vs 手写规则 AI 46.7%，diff −1.3pt，95% CI [−7.7, +5.1]，t = −0.41 —— **统计上无法区分，不是"打赢规则 AI"**。

更关键的是：agent 目前只接管了 `engine/ai.py` 里 9 个决策接口中的 **1 个**（出哪张牌 + 过牌），其余 8 个（响应 / 救命 / 无懈 / 弃牌 / 各类 choose_*）仍走规则 AI。**所以这是架构天花板，不是能力天花板**，也是下一阶段要扩的地方。

详见 [结论修订与目标说明](docs/results/结论修订与目标说明.md)。

> 所有胜率数字遵循 [评估协议-标准](docs/protocol/评估协议-标准.md)（配对同牌双跑、argmax、六项必报）。
> 这一阶段被实测数据抓出的六个评估口径陷阱，见 [评估协议-六个陷阱](docs/protocol/评估协议-六个陷阱.md) —— 每一条都曾推翻过一次结论。

## 结果

任务 A：出牌阶段判断"出还是不出"。

| 版本 | 输入 | 验证集 | 准确率 | 说明 |
|---|---|---|---|---|
| V5 | 全状态 + 规则 AI 估值 | 819 | 83.9% | ⚠️ 部署时崩溃到 35.6% |
| V6 | 仅玩家可见信息 | 819 | 78.0–78.4% | 去掉特权信息后的真实水平 |
| V7 | 可见信息 + 价值头 | 819 | 80.8–81.8% | LUPI 补回大部分差距 |
| **V8** | **全套可见字段 + 价值头** | 340 | **80.6–80.9%** | 字段最全 |
| — | 多数类基线 | 340 | 69.2% | |

**几个值得记的发现**：

- **模型不是瓶颈，数据才是。** 超参扫了 7 组，全部卡在 72–73%；数据量 +7.6%，准确率跳了 5.3 个点。
- **数据质量 > 数据量。** 1.1 万条字段完整的记录，打平 3 万条混合数据（约 2.7 倍）。
- **91% 的错误是"五五开"的边界犹豫**，不是理解错了局面；高置信预测（≥95%）的实际正确率是 98.0%。
- **平均值掩盖了一个坑**：手里没有【杀】的时候，模型只比瞎猜强 2.9 个点。加上价值头之后变成 +19.6。

## 方法：为什么是特权信息

规则引擎知道每张牌值几分，玩家不知道，部署时也没有。直接把这个数字喂给模型，它会学会"读数字"而不是"打牌"——V5 就是这样崩的：离线 83.9%，上线 35.6%。

所以改成 LUPI（Learning Using Privileged Information）的做法：

```
训练：可见信息 → 编码器 → 决策头（出/不出）
                    └→ 价值头（每张牌的估值分桶，13 类）
部署：可见信息 → 编码器 → 决策头        （价值头丢掉）
```

价值头只在训练时存在，作用是逼编码器把"这张牌值多少"内化进表征，而不是从输入里读。

> 注意这与 **PerfectDou**（arXiv:2203.16406）的"完美信息蒸馏"不同。PerfectDou 的特权信息是对手手牌——客观存在、只是被隐藏，补的是**可观测性缺口**；我们的特权信息是规则引擎算出来的估值，游戏状态里根本不存在，补的是**知识缺口**。就算把所有牌摊开，网络仍然不知道一张【杀】值几分。

## 目录结构

```
SGSZero/
├── scripts/
│   └── bot.js                  # 无名杀注入：自动托管 + 逐手决策存盘
├── docs/
│   ├── README.md               # 文档索引（先读这里）
│   ├── results/                # 阶段 1 / 2 全部结果记录，按时间保留原貌
│   ├── protocol/               # 评估协议标准 + 六个陷阱
│   ├── figures/                # 两张论文图 + 可复现绘图脚本
│   ├── 部署一致性检查清单.md
│   └── *.md                    # 早期训练方案与工程落地设计
├── paper/
│   ├── main.tex / main.pdf     # v1 论文（任务 A + LUPI，80.9%）
│   └── v2-outline.md           # v2 骨架，非正文；方法节待重写
└── CITATION.cff / LICENSE
```

**已知缺口**：`src/`（tokenizer / 训练 / 评估代码）与 `engine/`（规则引擎移植）**尚未公开**，因此目前 `clone` 下来跑不通训练。这两部分会在阶段 3 动作空间定型、并跑通部署一致性检查后补齐——现在推代码会两周内过期。

复现命令（`python src/tok/build.py` 等）描述的是 v1 的流程；当前公开仓库只包含数据采集脚本与全部研究文档。

## 复现

```bash
# 重建数据集
python src/tok/build.py

# 体检 + 自检（过拟合 / mask / 打乱标签）
python src/train/train.py --check
python src/train/train.py --quick

# 训练（最佳配置）
python src/train/train.py --d-model 256 --layers 3 --epochs 40 --seed 7
```

环境：Python 3.13 + PyTorch 2.11（cu128）。40 epoch 在 RTX 4060 Laptop 上约 70 秒。

## 论文

**SGSzero: Training a Compact Sanguosha Agent via Privileged Rule-Based Supervision**
Evan Wen · Independent Researcher · [ORCID 0009-0005-7254-8002](https://orcid.org/0009-0005-7254-8002)

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23828678.svg)](https://doi.org/10.5281/zenodo.23828678)

- **预印本**：[10.5281/zenodo.23828678](https://doi.org/10.5281/zenodo.23828678)（Zenodo, 2026-10-31）
- **arXiv**：待背书
- **PDF**：[paper/main.pdf](paper/main.pdf)

如果这个工作对你有用，欢迎引用：

```bibtex
@misc{wen2026sgszero,
  title  = {SGSzero: Training a Compact Sanguosha Agent via Privileged Rule-Based Supervision},
  author = {Wen, Evan},
  year   = {2026},
  doi    = {10.5281/zenodo.23828678},
  url    = {https://doi.org/10.5281/zenodo.23828678}
}
```

## 版权声明

- 无名杀引擎为第三方 GPL-3.0 开源项目（[无名杀 Noname](https://github.com/libnoname/noname)），本项目仅将其作为训练环境使用，不包含引擎本体代码；
- 本项目代码以 GPL-3.0 协议开源，与无名杀保持一致，避免协议冲突。

## 免责声明

本项目为独立学术研究，与游卡桌游（Yoka Games）无关。

「三国杀」（Sanguosha / Legends of the Three Kingdoms）为游卡桌游的注册商标。本项目仅将其作为研究对象提及，不包含任何官方游戏素材，训练环境使用第三方开源实现[无名杀](https://github.com/libnoname/noname)（GPL-3.0）。

---

*从零开始，然后赢下第一局。*
