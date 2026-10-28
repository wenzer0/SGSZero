/*
 * bot.js —— 让无名杀自己跟自己打，顺手把决策都记下来
 *
 * 装法：
 *   1. 先备份 resources/app/app.html
 *   2. 把本文件丢到 resources/app/bot.js
 *   3. 在 app.html 的 </body> 前加一行：
 *        <script type="text/javascript" src="bot.js"></script>
 *
 * 然后开游戏、手动开一局（斗地主），它就自己跑起来了。
 * 右下角有个小方块显示进度，窗口标题也会带进度。
 *
 * 要改的东西都在下面 CONFIG 里，别的地方别乱动。
 */

var CONFIG = {
	// 一共跑多少局（0 = 一直跑，不停）
	TARGET_GAMES: 500,

	// 注入后自动开始，不用敲命令
	AUTO_START: true,

	// 你自己的座位也交给电脑（这样才是纯 AI 对 AI）
	AUTO_PLAY_SELF: true,

	// 数据存到哪（相对脚本所在目录；找不到输出就改成绝对路径）
	OUT_FILE: './data/dataset.jsonl',

	// 每多少局存一次盘（防止中途崩了丢数据）
	// 每局都存：页面每打完一局就会重载，内存里的记录会被冲掉，不存就丢了
	SAVE_EVERY: 1,

	// 要不要跳过「你自己那个座位」的决策记录
	// 原因：托管座位走的虽然也是 AI，但「AI优化」扩展里有 23 处对 game.me 的特判，
	// 比如「AI不砍队友」这条对托管座位就不生效。想数据 100% 干净就设 true（会少约 1/3 的量）。
	// 设 false 时照样记录，只是会打上 isSelf 标记，训练前可以自己筛掉。
	SKIP_SELF_SEAT: false,

	// 窗口标题上显示进度（小方块万一被挡住，看标题栏也能知道在跑）
	SHOW_TITLE: true,

	// 看门狗：多少秒没有任何新决策，就认为卡住了，强制重开一局
	STUCK_TIMEOUT: 90,
};

(function () {
	'use strict';
	if (window.__NN) return;

	var KEY = '__nn_';

	// 看看有没有写文件的权限（这个版本的打包是给的）
	var fs = null;
	try {
		fs = require('fs');
	} catch (e) {
		console.warn('[陪练] 没有写文件权限，数据只能先存在内存里');
	}

	// 日志：脚本有没有被加载、跑得顺不顺，出问题先看这个文件
	var LOG_FILE = './data/bot.log';
	function log(msg) {
		try {
			console.log('[陪练] ' + msg);
		} catch (e) {}
		try {
			fs.appendFileSync(LOG_FILE, new Date().toLocaleString('zh-CN') + '  ' + msg + '\n');
		} catch (e) {}
	}
	log('脚本已加载');
	try {

	var NN = (window.__NN = {
		ready: false,
		hooked: false,
		records: [],
		decisions: 0,
		calls: 0,
		promiseHits: 0,
		objHits: 0,
		retKeys: null,
		nullState: 0,
		stream: null,
		gameId: 0,
	});

	/* ================= 1. 读当前局面 ================= */
	NN.snap = function (p) {
		try {
			p = p || (window.game && game.player);
			if (!p || !p.getCards) return null;
			var others = (game.players || [])
				.filter(function (x) {
					return x !== p;
				})
				.map(function (x) {
					return {
						name: x.name,
						hp: x.hp,
						maxHp: x.maxHp,
						handCount: x.countCards ? x.countCards('h') : null,
						identity: x.identity || null,
						dead: x.isDead ? x.isDead() : false,
						// 装备区是公开信息，直接影响距离和杀/闪判定
						equips: (x.getCards('e') || []).map(function (c) {
							return c.name;
						}),
						// 判定区（乐不思蜀/兵粮寸断/闪电）也是公开的
						judge: (x.getCards('j') || []).map(function (c) {
							return c.name;
						}),
					};
				});
			return {
				gid: NN.gameId,
				seat: game.players.indexOf(p),
				name: p.name,
				hp: p.hp,
				maxHp: p.maxHp,
				identity: p.identity || null, // 自己是地主还是农民
				hand: (p.getCards('h') || []).map(function (c) {
					return {
						name: c.name,
						number: c.number, // 点数 1-13（裴秀那些技能要用）
						suit: c.suit,
						type: c.type,
					};
				}),
				equips: (p.getCards('e') || []).map(function (c) {
					return { name: c.name, number: c.number, suit: c.suit };
				}),
				judge: (p.getCards('j') || []).map(function (c) {
					return c.name;
				}),
				round: game.roundNumber,
				phase: game.phaseNumber,
				// 这次决策是被什么触发的（phaseUse / respond / chooseToDiscard...），
				// 光有 phase 数字看不出「现在该干什么」
				event: (function () {
					try {
						return _status.event && _status.event.name ? String(_status.event.name) : null;
					} catch (e) {
						return null;
					}
				})(),
				deck: (function () {
					try {
						return ui.cardPile ? ui.cardPile.childNodes.length : null;
					} catch (e) {
						return null;
					}
				})(),
				others: others,
			};
		} catch (e) {
			return null;
		}
	};

	/* ================= 2. 调快速度 ================= */
	NN.fast = function () {
		try {
			lib.config.game_speed = 'vvfast'; // 最快档
			lib.config.animation = false; // 关动画
			lib.config.low_performance = true;
			if (game.saveConfig) {
				game.saveConfig('game_speed', 'vvfast');
				game.saveConfig('animation', false);
			}
		} catch (e) {
			console.warn('[陪练] 加速失败', e);
		}
		NN.ensureAuto();
	};

	/* ================= 2b. 确保「托管」一直开着 =================
	 * 光设 _status.auto = true 是不够的，有两个坑：
	 *   ① 游戏开局时会把它重置掉
	 *   ② 如果此刻正卡在「等你出牌」，光改标志不会让局面继续
	 * 所以直接点那个托管按钮（ui.auto）——它的处理函数会把卡住的局面一起恢复。
	 * 因为标志会被重置，这里需要反复检查（见下面的定时器）。
	 */
	NN.ensureAuto = function () {
		if (!CONFIG.AUTO_PLAY_SELF) return;
		try {
			if (typeof _status === 'undefined') return;
			if (window.game && game.noAuto) return; // 这个模式禁用托管
			if (_status.auto) return;

			// 关键：游戏还没开始时也要先把标志设上，
			// 否则「选将」这类事件在创建时就判定成「等真人点」，之后永远卡住
			if (!window.game || !game.me) {
				_status.auto = true;
				return;
			}

			// 游戏进行中：走托管按钮，它会把卡住的局面一起推下去
			if (ui && ui.click && typeof ui.click.auto === 'function') {
				ui.click.auto();
			} else if (ui && ui.auto && typeof ui.auto.click === 'function') {
				ui.auto.click();
			} else {
				_status.auto = true;
				if (_status.imchoosing && _status.paused) {
					try { if (ui.confirm) ui.confirm.close(); } catch (e) {}
					try { ui.control.hide(); } catch (e) {}
					try { if (_status.event.switchToAuto) _status.event.switchToAuto(); } catch (e) {}
					try { game.resume(); } catch (e) {}
				}
			}
		} catch (e) {}
	};

	/* ================= 3. 记下每一次决策 =================
	 * 电脑每次要出牌/选目标/做选择，都会走 player.choose 开头的函数。
	 * 我们在每个函数外面包一层：进去之前拍张照（局面），出来之后记下它选了什么。
	 */
	// 把一个 choose* 方法包一层：调用前拍快照，调用后取结果
	NN.wrapOne = function (orig, k) {
		var wrapped = function () {
			NN.calls++;
			var state = NN.snap(this);
			if (!state) NN.nullState++;

			// chooseControl 只返回一个下标，必须把选项文字一起记下来，
			// 否则「选了 0」根本不知道选的是什么
			var extra = null;
			try {
				var a0 = arguments[0];
				if (k === 'chooseControl' && a0) {
					if (typeof a0 === 'string') {
						// 只有一个选项时传的是字符串，别按字符拆开
						extra = { opts: [a0] };
					} else if (a0.length) {
						extra = {
							opts: Array.prototype.slice.call(a0, 0, 10).map(function (x) {
								return typeof x === 'string' ? x : String(x && x.name ? x.name : x);
							}),
						};
					}
				}
			} catch (e) {}

			var ret = orig.apply(this, arguments);
			try {
				if (ret && typeof ret.then === 'function') {
					NN.promiseHits++;
					ret.then(function (res) {
						NN.record(state, k, res, extra);
					});
				} else if (ret && typeof ret === 'object') {
					// 无名杀的 choose* 返回事件对象，结果稍后写进 ret.result
					NN.objHits++;
					if (!NN.retKeys) {
						try {
							NN.retKeys = Object.keys(ret).slice(0, 14).join(',');
						} catch (e) {}
					}
					NN.watchResult(ret, state, k, extra);
				}
			} catch (e) {}
			return ret;
		};
		wrapped.__nnWrapped = true;
		return wrapped;
	};

	// 第一步：包原型
	NN.hook = function () {
		try {
			var proto = lib.element.player;
			var n = 0;
			Object.keys(proto).forEach(function (k) {
				if (!/^choose/.test(k)) return;
				var orig = proto[k];
				if (typeof orig !== 'function' || orig.__nnWrapped) return;
				proto[k] = NN.wrapOne(orig, k);
				n++;
			});
			if (!NN.hooked) log('已包原型，共 ' + n + ' 个决策方法');
			NN.hooked = true;
		} catch (e) {
			log('包原型失败：' + e.message);
		}
		NN.hookPlayers();
	};

	// 第二步（关键）：无名杀会把方法复制到每个玩家实例上，
	// 这些副本在包原型之前就存在，所以必须逐个实例再包一遍
	NN.hookPlayers = function () {
		try {
			var g = window.game;
			if (!g || !g.players) return;
			var n = 0;
			for (var i = 0; i < g.players.length; i++) {
				var p = g.players[i];
				if (!p) continue;
				for (var k in p) {
					if (!/^choose/.test(k)) continue;
					var f = p[k];
					if (typeof f !== 'function' || f.__nnWrapped) continue;
					p[k] = NN.wrapOne(f, k);
					n++;
				}
			}
			if (n && !NN.playersHooked) {
				NN.playersHooked = true;
				log('已包玩家实例，共 ' + n + ' 个方法');
			}
		} catch (e) {}
	};

	NN.watchResult = function (obj, state, kind, extra) {
		var tries = 0;
		var t = setInterval(function () {
			if (++tries > 600) {
				clearInterval(t);
				return;
			}
			try {
				if (obj.result) {
					clearInterval(t);
					NN.record(state, kind, obj.result, extra);
				} else if (obj.finished) {
					clearInterval(t);
				}
			} catch (e) {
				clearInterval(t);
			}
		}, 100);
	};

	// 把按钮对象压成一个短标签：只留能认出「按了哪个」的信息，丢掉 DOM 节点
	function btnTag(b) {
		if (!b) return null;
		if (typeof b === 'string') return b;
		try {
			if (b.link) return String(b.link);
			if (b.name && b.number !== undefined) return String(b.name) + b.number;
			if (b.name) return String(b.name);
			if (b._link) return String(b._link);
		} catch (e) {}
		return null;
	}

	NN.plain = function (r) {
		if (!r) return null;
		var out = {};
		try {
			if (r.cards)
				out.cards = r.cards.map(function (c) {
					return (c.name || '?') + (c.number !== undefined ? c.number : '');
				});
			if (r.targets)
				out.targets = r.targets.map(function (t) {
					return t.name || '?';
				});
			if (r.buttons && r.buttons.length) {
				out.buttons = r.buttons.map(btnTag).filter(function (x) {
					return x;
				});
			}
			if (typeof r.bool === 'boolean') out.bool = r.bool;
			if (typeof r.index === 'number') out.index = r.index;
			// 什么都没提取到 = 玩家取消了这次选择，这本身也是一个有效决策
			if (!Object.keys(out).length) out.pass = true;
		} catch (e) {}
		return out;
	};

	NN._recent = []; // 去重用的滑动窗口

	NN.record = function (state, kind, res, extra) {
		NN._lastDecisionAt = Date.now(); // 看门狗用：最近一次有决策的时间
		if (!state) return;

		// 过滤脏数据：选将/初始化阶段的快照，武将和血量都还没有，没用
		if (!state.name || typeof state.hp !== 'number') return;

		// 标记「这是你自己那个座位」——扩展里对它有一些特判，数据纯度略低
		var isSelf = false;
		try {
			isSelf = state.seat === game.players.indexOf(game.me);
		} catch (e) {}
		if (isSelf && CONFIG.SKIP_SELF_SEAT) return;

		var plain = NN.plain(res);
		if (extra) {
			for (var ek in extra) plain[ek] = extra[ek];
		}

		// 去重：同一个决策有时会被记两次（chooseToUse 内部还会调别的 choose*）
		var sig = kind + '|' + state.name + '|' + state.round + '|' + state.phase + '|' + JSON.stringify(plain);
		if (NN._recent.indexOf(sig) >= 0) return;
		NN._recent.push(sig);
		if (NN._recent.length > 40) NN._recent.shift();

		NN.decisions++;
		var rec = { gid: NN.gameId, kind: kind, isSelf: isSelf, state: state, result: plain };
		NN.records.push(rec);
		if (NN.records.length > 8000) NN.records.shift();
		// 不在这里写盘：统一由 NN.save() 一次写，避免重复
	};

	/* ================= 4. 存盘 ================= */
	NN.save = function () {
		if (!fs) return;
		try {
			if (!NN.stream) NN.stream = fs.createWriteStream(CONFIG.OUT_FILE, { flags: 'a' });
			var n = NN.records.length;
			NN.records.forEach(function (r) {
				NN.stream.write(JSON.stringify(r) + '\n');
			});
			NN.records = [];
			console.log('[陪练] 存了 ' + n + ' 条 → ' + CONFIG.OUT_FILE);
		} catch (e) {
			console.warn('[陪练] 存盘失败', e);
		}
	};

	NN.dump = function () {
		console.log(JSON.stringify(NN.records, null, 1));
		return NN.records.length + ' 条';
	};

	/* ================= 5. 屏幕上的小进度条 ================= */
	var hud = null;
	var hudLogged = false;

	function makeHud() {
		if (hud && hud.isConnected) return; // 还在页面上就别重建
		if (!document.body) {
			if (!hudLogged) {
				log('小方块没建出来：document.body 还不存在');
				hudLogged = true;
			}
			return;
		}
		try {
			hud = document.createElement('div');
			hud.id = '__nn_hud';
			hud.style.cssText = [
				'position:fixed',
				'right:12px',
				'bottom:12px',
				'background:rgba(12,18,26,.92)',
				'color:#7fd8c8',
				'font:13px/1.75 ui-monospace,Consolas,monospace',
				'padding:8px 12px',
				'border-radius:8px',
				'border:1px solid rgba(70,179,164,.4)',
				'pointer-events:none',
				'white-space:pre',
				'box-shadow:0 4px 16px rgba(0,0,0,.5)',
			].join(';');
			hud.style.setProperty('z-index', '2147483647', 'important');
			hud.textContent = '陪练启动中…';
			document.body.appendChild(hud);
			hudLogged = true;
		} catch (e) {
			log('创建小方块出错：' + e.message);
		}
	}

	function updateHud() {
		if (!hud || !hud.isConnected) makeHud(); // 被游戏冲掉了就重建
		if (!hud) return;
		var done = +localStorage.getItem(KEY + 'games') || 0;
		var target = CONFIG.TARGET_GAMES;

		var inGame = false,
			auto = false;
		try {
			inGame = !!(window.game && game.me && game.players && game.players.length);
			auto = !!(typeof _status !== 'undefined' && _status.auto);
		} catch (e) {}

		var head;
		if (!inGame) head = '○ 等待开局（请手动开一局）';
		else if (auto) head = '● 自动对打中';
		else head = '⚠ 托管没开，正在重试…';

		hud.textContent =
			head +
			'\n第 ' + done + ' 局' + (target ? ' / ' + target : '') +
			'\n已记录 ' + NN.decisions + ' 步';
		hud.style.color = !inGame ? '#8b95a7' : auto ? '#7fd8c8' : '#e2b95f';

		// 窗口标题也带上进度——小方块万一被挡住，看标题栏也能知道
		if (CONFIG.SHOW_TITLE) {
			try {
				document.title =
					'三国杀·琉璃版 · ' +
					(inGame ? (auto ? 'AI对打中' : '托管未开') : '等待开局') +
					' · 第' + done + '局 · 记' + NN.decisions;
			} catch (e) {}
		}
	}

	// 每 0.5 秒：确认托管还开着（游戏会重置这个标志）+ 刷新进度
	setInterval(function () {
		NN.ensureAuto();
		NN.hookPlayers(); // 新开的局会创建新玩家，要补包
		updateHud();
	}, 500);

	// 立刻先刷新一次，不等定时器
	try {
		updateHud();
	} catch (e) {
		log('首次刷新出错：' + e.message);
	}

	/* ================= 6. 自动循环 ================= */
	NN._timer = null;
	NN._counted = false;

	NN.loop = function (target) {
		localStorage.setItem(KEY + 'loop', '1');
		if (target) CONFIG.TARGET_GAMES = target;
		NN._counted = false;
		NN._tick();
	};

	NN.stop = function () {
		localStorage.setItem(KEY + 'loop', '0');
		if (NN._timer) clearTimeout(NN._timer);
		console.log('[陪练] 已暂停');
	};

	NN.progress = function () {
		var n = +localStorage.getItem(KEY + 'games') || 0;
		console.log('已完成 ' + n + ' 局，记录 ' + NN.decisions + ' 步');
		return { done: n, target: CONFIG.TARGET_GAMES };
	};

	NN._tick = function () {
		if (localStorage.getItem(KEY + 'loop') !== '1') return;
		if (NN._timer) clearTimeout(NN._timer);

		NN._timer = setTimeout(function () {
			try {
				// 一局打完的标志
				// 只有真的进过对局，才把 _status.over 当成「一局打完」
				var inGame = !!(window.game && game.players && game.players.length > 0);
				if (inGame) NN._sawGame = true;

				// 看门狗：卡住了就强制重开（自己死了但队友还在打，不算卡住）
				if (inGame && NN._sawGame && !(typeof _status !== 'undefined' && _status.over) && NN._lastDecisionAt) {
					var idle = (Date.now() - NN._lastDecisionAt) / 1000;
					if (idle > CONFIG.STUCK_TIMEOUT) {
						NN._lastDecisionAt = Date.now();
						log('看门狗：' + Math.round(idle) + ' 秒没有新决策，强制重开');
						if (NN.records.length) NN.save();
						setTimeout(function () {
							try {
								game.reloadCurrent();
							} catch (e) {}
						}, 300);
						return;
					}
				}

				if (typeof _status !== 'undefined' && _status.over && !NN._counted && NN._sawGame) {
					NN._counted = true;
					NN._sawGame = false;

					var n = (+localStorage.getItem(KEY + 'games') || 0) + 1;
					localStorage.setItem(KEY + 'games', String(n));
					NN.gameId = n;

					log('第 ' + n + ' 局结束，累计记录 ' + NN.decisions + ' 步');
					if (n % CONFIG.SAVE_EVERY === 0 && NN.records.length) NN.save();

					var target = CONFIG.TARGET_GAMES;
					if (target && n >= target) {
						NN.save();
						NN.stop();
						console.log('[陪练] 跑完 ' + n + ' 局，收工。数据在 ' + CONFIG.OUT_FILE);
						return;
					}

					// 重开下一局（这个函数会写 directstart，重载后免菜单直接开打）
					setTimeout(function () {
						try {
							if (game.players && game.players.length) game.reloadCurrent();
							else NN._tick(); // 不在局中就先别重开
						} catch (e) {
							try {
								game.reload();
							} catch (e2) {}
						}
					}, 400);
					return;
				}
			} catch (e) {}
			NN._tick();
		}, 400);
	};

	/* ================= 7. 启动 ================= */
	var tries = 0;
	var boot = setInterval(function () {
		if (++tries > 240) {
			clearInterval(boot);
			console.warn('[陪练] 等太久了，游戏可能没起来');
			return;
		}
		try {
			if (typeof game !== 'undefined' && game && lib && lib.element && lib.element.player) {
				clearInterval(boot);
				NN.ready = true;
				// 局号 = 已完成的局数 + 1（正在打的就是这一局）
				NN.gameId = (+localStorage.getItem(KEY + 'games') || 0) + 1;
				makeHud();
				log('已连上游戏');

				if (CONFIG.AUTO_START) {
					NN.fast();
					NN.hook();
					NN.loop(CONFIG.TARGET_GAMES);
				}

				// 页面重载后自动接着跑
				if (localStorage.getItem(KEY + 'loop') === '1') {
					NN._counted = false;
					NN._tick();
				}
			}
		} catch (e) {}
	}, 500);

	} catch (e) {
		log('初始化出错：' + e.message + '  @ ' + ((e.stack || '').split('\n')[1] || ''));
	}
})();
