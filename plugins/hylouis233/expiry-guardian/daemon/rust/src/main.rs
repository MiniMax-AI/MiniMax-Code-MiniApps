//! 后台守护进程：读**本地账本** → 跑决策 → 如实报出结论。
//!
//! 与 Mini App「蹬王之王」的判定逻辑严格同构，由 `verify-parity.mjs`
//! 逐字比对「动作 + 理由文本」防止漂移。
//!
//! # 这个守护进程现在做什么、不做什么
//!
//! **做**：读 `~/.config/mcode-reset-card/ledger.json`（用户自己维护的账本），
//! 用与 Mini App 完全相同的决策逻辑算出「该用卡还是该留积分」，
//! 把结论写进日志与状态文件，供 Mini App 展示。
//!
//! **不做**（2026-10-20 管理员 review 的红线）：
//! - ❌ 不读 MiniMax Code 的登录凭据（不调账号接口）
//! - ❌ 不读写 MiniMax Code 的内部数据库
//! - ❌ 不读其它插件的数据目录
//! - ❌ **不做任何写操作**（不扣卡、不暂停目标）—— 只给结论，由人执行
//!
//! ⇒ 扣卡这类**真实消耗**的动作必须由用户在面板上点，插件不代替用户决定。

mod clock;
mod config;
mod decision;
mod ledger;

use std::time::Duration;

use decision::{decide, Action};
use serde_json::json;

/// 把 Unix 毫秒格式化成「10月19日 19:41」这样的本地时间。
fn fmt_reset_at(ms: i64) -> String {
    if ms == 0 {
        return "未知".to_string();
    }
    let secs = ms.div_euclid(1000);
    let (m, d) = decision::local_md(secs);
    let (h, mi) = decision::local_hm(secs);
    if m == 0 {
        return "未知".to_string();
    }
    format!("{m}月{d}日 {h:02}:{mi:02}")
}

/// 日志：带本地时间戳，便于 tail 追踪。
pub fn log(msg: &str) {
    use std::io::Write;
    let now = clock::now_ms();
    let secs = now.div_euclid(1000);
    let ms = now.rem_euclid(1000);
    let (m, d) = decision::local_md(secs);
    let (h, mi) = decision::local_hm(secs);
    let line = format!("[{m:02}-{d:02} {h:02}:{mi:02}.{ms:03}] {msg}\n");
    let mut out = std::io::stdout();
    let _ = out.write_all(line.as_bytes());
    let _ = out.flush();
}

/// 一轮判定的结果。
struct Round {
    action: Action,
    reason: String,
    /// 账本读不到时的原因（None = 读到了）。
    ledger_error: Option<String>,
}

/// 跑一轮：读账本 → 决策。
fn run_round(cfg: &config::Config) -> Round {
    let now = clock::now_ms();
    match ledger::read() {
        Ok(l) => {
            let d = decide(
                &l.quotas,
                &l.usable_cards,
                l.credit_expiry_ms,
                &l.credit_desc,
                &cfg.decision_cfg(),
                now,
                l.credit_data_complete,
            );
            Round {
                action: d.action,
                reason: d.reason,
                ledger_error: None,
            }
        }
        Err(e) => {
            // ⚠️ 读不到账本 ⇒ **数据不完整** ⇒ 决策必须是 wait。
            //    绝不能当成「没有积分、没有卡」⇒ 那会把结论翻转成「用卡」。
            //    （「读不到 ≠ 没有」是本项目反复踩过的坑。）
            Round {
                action: Action::Wait,
                reason: format!("账本读不到，本轮不做任何判断（{e}）"),
                ledger_error: Some(e),
            }
        }
    }
}

/// 把这一轮的结论写进状态文件（供 Mini App 读取）。
///
/// ⚠️ 只写**插件自己的**数据目录，不碰宿主的任何数据。
fn write_status(round: &Round) {
    let Some(home) = std::env::var("HOME").ok() else { return };
    let dir = std::path::PathBuf::from(home).join(".config/mcode-reset-card");
    let _ = std::fs::create_dir_all(&dir);
    let body = json!({
        "updatedAtMs": clock::now_ms(),
        "action": match round.action {
            Action::Idle => "idle",
            Action::UseCard => "use-card",
            Action::KeepCredit => "keep-credit",
            Action::Wait => "wait",
        },
        "reason": round.reason,
        "ledgerError": round.ledger_error,
    });
    let path = dir.join("daemon-status.json");
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, format!("{}\n", serde_json::to_string_pretty(&body).unwrap_or_default())).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// 自检：读 stdin 的 JSON 用例，跑一遍决策并把结果打印成 JSON。
///
/// ⚠️ 这个协议是**三方一致性校验器**（`verify-parity.mjs`）的接口：
/// Rust / Mini App / Python 三方读**同一份**用例，各自算出动作与理由，
/// 校验器再逐字比对。**改了输出格式，三方比对就失效了。**
fn selftest() {
    use std::io::Read as _;
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        eprintln!("selftest: 无法读取 stdin");
        std::process::exit(2);
    }
    let payload: serde_json::Value = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("selftest: JSON 解析失败 {e}");
            std::process::exit(2);
        }
    };
    let now = payload["now"].as_i64().unwrap_or(0);
    let day = payload["day"].as_i64().unwrap_or(86_400_000);
    // 三方必须喂同一个阈值，否则比的不是同一件事
    let trigger = payload["trigger"].as_f64().unwrap_or(99.0);
    let tight = payload["tight"].as_f64().unwrap_or(80.0);
    let low = payload["low"].as_f64().unwrap_or(95.0);
    let skip = payload["skipBeforeResetMinutes"].as_f64().unwrap_or(60.0);
    let cfg = decision::DecisionCfg {
        card_trigger_percent: trigger,
        tight,
        low,
        card_skip_before_reset_minutes: skip,
    };
    let mut out = Vec::new();

    for c in payload["cases"].as_array().cloned().unwrap_or_default() {
        let mk = |t: i64, used: f64, total: f64, unlimited: bool| decision::QuotaState {
            quota_type: t,
            total,
            used,
            is_unlimited: unlimited,
            reset_time_ms: None,
        };
        let five_used = c["five"].as_f64().unwrap_or(0.0);
        let week_used = c["week"].as_i64();
        let five_reset = c["resetInMinutes"]
            .as_f64()
            .map(|m| now + (m * 60_000.0) as i64);
        let mut quotas = vec![
            mk(1, five_used, 100.0, false),
            match week_used {
                None => mk(2, 0.0, 100.0, true),
                Some(w) => mk(2, w as f64, 100.0, false),
            },
        ];
        quotas[0].reset_time_ms = five_reset;
        let cards: Vec<decision::UsableCard> = c["cards"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| {
                let d = v.as_i64()?;
                Some(decision::UsableCard {
                    card_id: format!("C{d}"),
                    source_type: "mcode_signin".into(),
                    out_biz_no: format!("b{d}"),
                    expire_time: now + d * day,
                })
            })
            .collect();
        let credit = c["credit"].as_i64().map(|d| now + d * day);
        let complete = c
            .get("creditDataComplete")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let d = decide(&quotas, &cards, credit, "平台积分", &cfg, now, complete);
        let five_level = quotas[0].level(tight, low);
        out.push(json!({
            "n": c["n"].as_str().unwrap_or(""),
            "action": d.action.as_str(),
            "reason": d.reason,
            "level": five_level.as_str(),
        }));
    }
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

fn main() {
    clock::install_signal_handlers();
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--selftest") {
        selftest();
        return;
    }

    let mut interval: f64 = 60.0;
    let mut cmd = "watch".to_string();
    let mut config_path: Option<std::path::PathBuf> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--interval" if i + 1 < args.len() => {
                interval = args[i + 1].parse().unwrap_or(60.0);
                i += 2;
            }
            "--config" if i + 1 < args.len() => {
                config_path = Some(std::path::PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "watch" | "once" | "status" => {
                cmd = args[i].clone();
                i += 1;
            }
            _ => i += 1,
        }
    }

    // 每轮重读：改配置无需 `launchctl unload/load`
    let load_cfg = || match &config_path {
        Some(p) => config::load(p),
        None => config::load_or_default(),
    };
    let (cfg, issues) = load_cfg();
    for s in &issues {
        log(&format!("⚠️  {s}"));
    }

    if cmd == "status" {
        let r = run_round(&cfg);
        println!("动作: {:?}", r.action);
        println!("理由: {}", r.reason);
        return;
    }

    if cmd == "once" {
        let r = run_round(&cfg);
        write_status(&r);
        println!("{}", r.reason);
        return;
    }

    log(&format!(
        "启动后台监控，间隔 {interval}s（Ctrl+C 退出）；扣卡触发线 {:.0}%，额度分界 {:.0}%/{:.0}%",
        cfg.card_trigger_percent, cfg.quota_levels.tight, cfg.quota_levels.low
    ));
    log("数据来源：本地账本 ~/.config/mcode-reset-card/ledger.json（不读宿主凭据、不碰宿主数据库）");
    log("决策策略：与 Mini App「蹬王之王」一致 —— 按先过期先用；只给结论，不代你扣卡");

    // 连续失败计数：账本读不到时必须**逐级喊出来**，
    // 而不是每轮都被当成平常事刷过去（更不能静默 —— 静默 = 看起来一切正常）。
    let mut fails: u32 = 0;
    let mut last_ledger_error: Option<String> = None;
    loop {
        if clock::should_stop() {
            log("收到终止信号，守护进程退出");
            return;
        }
        let (cfg, issues) = load_cfg();
        for s in &issues {
            log(&format!("⚠️  {s}"));
        }

        let r = run_round(&cfg);
        write_status(&r);

        // 同一个「读不到」的原因只说一次（换原因了才再说）。
        if let Some(e) = &r.ledger_error {
            if last_ledger_error.as_deref() != Some(e.as_str()) {
                last_ledger_error = Some(e.clone());
                log(&format!("⚠️  {e} —— 本轮**没有任何结论**（不是「没有卡/没有积分」）"));
            }
            fails += 1;
            if fails == 5 {
                log("🔴 连续 5 轮读不到账本：到期雷达与决策建议都不可用。");
            } else if fails % 30 == 0 {
                log(&format!("🔴 已连续 {fails} 轮读不到账本。"));
            }
        } else {
            if fails > 0 {
                log(&format!("✓ 账本已恢复可读（此前连续失败 {fails} 轮）"));
            }
            fails = 0;
            last_ledger_error = None;
            log(&format!("决策: {:?}", r.action));
            log(&format!("理由: {}", r.reason));
            if r.action == Action::UseCard {
                log("👉 结论是「用卡」—— 请在「蹬王之王」面板上确认并手动执行（本插件不代你扣卡）。");
            }
        }

        // 抖动，避免与整点撞在一起
        let jitter = (clock::now_ms() % 1000) as f64 / 1000.0 * 4.0 - 2.0;
        std::thread::sleep(Duration::from_millis(((interval + jitter) * 1000.0) as u64));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_ledger_never_says_use_card() {
        // ⚠️「读不到 ≠ 没有」：账本读不到时**绝不能**得出「用卡」的结论
        //    （那等于把「没数据」当成「没有积分」⇒ 建议去烧掉一张真卡）。
        let cfg = config::Config::default();
        let r = run_round(&cfg);
        assert_eq!(r.action, Action::Wait, "理由：{}", r.reason);
        assert!(r.ledger_error.is_some(), "读不到账本必须报出来");
    }
}
