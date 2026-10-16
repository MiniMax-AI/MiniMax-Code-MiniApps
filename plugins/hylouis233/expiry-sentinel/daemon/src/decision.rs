//! 额度与到期判定。
//!
//! 这些分支与 Mini App「蹬王之王」的 `decide()` 一一对应，
//! 由 `verify-parity.mjs` 逐字比对「动作 + 理由文本」来防止漂移。
//! **改动任何一条理由文案，两侧都要同步改，并重跑校验器。**

use serde::Deserialize;

pub const QUOTA_FIVE_HOUR: i64 = 1;
pub const QUOTA_WEEKLY: i64 = 2;
pub const QUOTA_VIDEO: i64 = 3;

/// 一个限额维度的用量。
#[derive(Debug, Clone, Copy)]
pub struct QuotaState {
    pub quota_type: i64,
    pub total: f64,
    pub used: f64,
    pub is_unlimited: bool,
}

impl QuotaState {
    /// 是否已耗尽。不限量或总量为 0 都不算耗尽。
    pub fn exhausted(&self) -> bool {
        if self.is_unlimited || self.total <= 0.0 {
            return false;
        }
        self.used >= self.total
    }

    pub fn remaining_percent(&self) -> f64 {
        if self.is_unlimited || self.total <= 0.0 {
            return 100.0;
        }
        ((self.total - self.used) / self.total * 100.0).max(0.0)
    }

    pub fn label(&self) -> &'static str {
        match self.quota_type {
            QUOTA_FIVE_HOUR => "5小时限额",
            QUOTA_WEEKLY => "周限额",
            QUOTA_VIDEO => "视频限额",
            _ => "未知限额",
        }
    }

    pub fn describe(&self) -> String {
        if self.is_unlimited {
            return format!("{}=不限量", self.label());
        }
        format!(
            "{}=已用{:.0}% / 剩余{:.0}%",
            self.label(),
            self.used,
            self.remaining_percent()
        )
    }
}

/// 金额字符串（可能带千分位）转数字。
pub fn amount(value: &serde_json::Value) -> f64 {
    match value {
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
        serde_json::Value::String(s) => {
            let cleaned: String = s.chars().filter(|c| *c != ',').collect();
            cleaned.trim().parse::<f64>().unwrap_or(0.0)
        }
        _ => 0.0,
    }
}

/// 百分数字符串（如 "71%"）转数字。
///
/// 接口返回的就是 `"71%"` 这种带百分号的字符串，直接 `parse::<f64>()` 会失败并
/// 静默退回 0，把「已用 71%」误判成「已用 0%」。这里必须先剥掉 `%`。
pub fn percent(value: &serde_json::Value) -> f64 {
    match value {
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
        serde_json::Value::String(s) => s.trim().trim_end_matches('%').parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

#[derive(Deserialize)]
pub struct ModelRemains {
    pub model_name: String,
    #[serde(default)]
    pub current_interval_total_percent: serde_json::Value,
    #[serde(default)]
    pub current_interval_used_percent: serde_json::Value,
    #[serde(default)]
    pub current_interval_status: i64,
    #[serde(default)]
    pub current_interval_total_count: f64,
    #[serde(default)]
    pub current_interval_usage_count: f64,
    #[serde(default)]
    pub current_weekly_total_percent: serde_json::Value,
    #[serde(default)]
    pub current_weekly_used_percent: serde_json::Value,
    #[serde(default)]
    pub current_weekly_status: i64,
    #[serde(default)]
    pub end_time: Option<i64>,
}

#[derive(Deserialize)]
pub struct RemainsPayload {
    #[serde(default)]
    pub model_remains: Vec<ModelRemains>,
}

pub fn parse_quotas(payload: &RemainsPayload) -> Vec<QuotaState> {
    let mut out = Vec::with_capacity(3);

    let general = payload
        .model_remains
        .iter()
        .find(|m| m.model_name == "general")
        .or_else(|| payload.model_remains.first());

    if let Some(g) = general {
        let total = {
            let t = percent(&g.current_interval_total_percent);
            if t > 0.0 { t } else { 100.0 }
        };
        out.push(QuotaState {
            quota_type: QUOTA_FIVE_HOUR,
            total,
            used: percent(&g.current_interval_used_percent),
            is_unlimited: g.current_interval_status == 3,
        });
        out.push(QuotaState {
            quota_type: QUOTA_WEEKLY,
            total: {
                let t = percent(&g.current_weekly_total_percent);
                if t > 0.0 { t } else { 100.0 }
            },
            used: percent(&g.current_weekly_used_percent),
            is_unlimited: g.current_weekly_status == 3,
        });
    }

    // 视频额度：只有非 general 且计数 > 0 的模型
    if let Some(v) = payload
        .model_remains
        .iter()
        .find(|m| m.model_name != "general" && m.current_interval_total_count > 0.0)
    {
        out.push(QuotaState {
            quota_type: QUOTA_VIDEO,
            total: v.current_interval_total_count,
            used: v.current_interval_usage_count,
            is_unlimited: v.current_interval_status == 3,
        });
    }

    out
}

/// 一张可用于扣卡的重置卡。
#[derive(Debug, Clone)]
pub struct UsableCard {
    pub card_id: String,
    pub source_type: String,
    pub out_biz_no: String,
    pub expire_time: i64,
}

/// 扣卡决策的动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// 用重置卡重置额度
    UseCard,
    /// 不用卡，让积分先消耗
    KeepCredit,
    /// 额度充足，不动手
    Idle,
    /// 既没积分也没卡，等着
    Wait,
}

impl Action {
    pub fn as_str(&self) -> &'static str {
        match self {
            Action::UseCard => "use-card",
            Action::KeepCredit => "keep-credit",
            Action::Idle => "idle",
            Action::Wait => "wait",
        }
    }
}

pub struct Decision {
    pub action: Action,
    pub reason: String,
}

/// 毫秒时间戳 → "10月25日"。与 Python 的 `_fmt_day` 同一时区口径。
pub fn fmt_day(ms: Option<i64>) -> String {
    let Some(ms) = ms else {
        return "未知".to_string();
    };
    if ms == 0 {
        return "未知".to_string();
    }
    // 本地时区；固定 UTC 会导致跨日错位，必须借 localtime_r
    let (m, d) = local_md(ms.div_euclid(1000));
    if m == 0 {
        return "未知".to_string();
    }
    format!("{m}月{d}日")
}

/// 把 Unix 秒换算成本地时区的 (月, 日)。
///
/// 桌面端与 Python 版都用本地时区展示；这里手算避免引入 chrono 依赖。
/// libc 的 `struct tm`，只需本地时区换算用到的字段。
#[repr(C)]
#[derive(Default)]
struct Tm {
    tm_sec: i32, tm_min: i32, tm_hour: i32, tm_mday: i32,
    tm_mon: i32, tm_year: i32, tm_wday: i32, tm_yday: i32, tm_isdst: i32,
    tm_gmtoff: i64, tm_zone: *const u8,
}

#[repr(C)]
struct TimeT(i64);

unsafe extern "C" {
    fn localtime_r(timep: *const TimeT, result: *mut Tm) -> *mut Tm;
}

/// 把 Unix 秒换算成本地时区结构。
fn secs_to_local(secs: i64) -> Option<Tm> {
    let t = TimeT(secs);
    let mut tm = Tm::default();
    unsafe {
        if localtime_r(&t, &mut tm).is_null() {
            return None;
        }
    }
    Some(tm)
}

/// 本地时区的 (月, 日)，供日志使用。
pub fn local_md(secs: i64) -> (u32, u32) {
    secs_to_local(secs)
        .map(|t| (t.tm_mon as u32 + 1, t.tm_mday as u32))
        .unwrap_or((0, 0))
}

/// 本地时区的 (时, 分)。
pub fn local_hm(secs: i64) -> (u32, u32) {
    secs_to_local(secs)
        .map(|t| (t.tm_hour as u32, t.tm_min as u32))
        .unwrap_or((0, 0))
}

/// 后台扣卡决策（纯函数，不触碰网络）。
///
/// 动作 ∈ {use-card, keep-credit, idle, wait}。
///
/// 分支与 Mini App 的 `decide()` 刻意同构：
///   未耗尽                  → idle
///   耗尽 + 无积分 + 有卡     → use-card
///   耗尽 + 无积分 + 无卡     → wait
///   耗尽 + 有积分 + 无卡     → keep-credit
///   耗尽 + 都有，卡先过期    → use-card
///   耗尽 + 都有，积分先过期  → keep-credit
pub fn decide(
    quotas: &[QuotaState],
    usable_cards: &[UsableCard],
    credit_expiry_ms: Option<i64>,
    credit_desc: &str,
) -> Decision {
    let five = quotas.iter().find(|q| q.quota_type == QUOTA_FIVE_HOUR);
    let weekly = quotas.iter().find(|q| q.quota_type == QUOTA_WEEKLY);

    let five_exhausted = five.is_some_and(|q| q.exhausted());
    let weekly_exhausted = weekly.is_some_and(|q| q.exhausted());

    // ── 未耗尽 ──
    if !five_exhausted && !weekly_exhausted {
        return Decision {
            action: Action::Idle,
            reason: "额度充足，暂不需要处理".to_string(),
        };
    }

    // ── 无可用积分：只能靠卡 ──
    let Some(credit_expiry) = credit_expiry_ms else {
        if !usable_cards.is_empty() {
            return Decision {
                action: Action::UseCard,
                reason: "没有可用积分，使用重置卡重置额度".to_string(),
            };
        }
        return Decision {
            action: Action::Wait,
            reason: "额度已耗尽，既没有积分也没有可用的重置卡".to_string(),
        };
    };

    // ── 有积分但没卡：让积分先消耗 ──
    // 注意这一句带「到期」二字，与 Mini App / Python 的文案保持逐字一致。
    // 改文案前务必跑 `node verify-parity.mjs`。
    if usable_cards.is_empty() {
        return Decision {
            action: Action::KeepCredit,
            reason: format!(
                "没有可用的重置卡，让{credit_desc}（{}到期）先消耗",
                fmt_day(Some(credit_expiry))
            ),
        };
    }

    let card_expiry = usable_cards[0].expire_time;

    // ── 两者都有：比「先过期先用」 ──
    if card_expiry < credit_expiry {
        return Decision {
            action: Action::UseCard,
            reason: format!(
                "重置卡（{}）比{credit_desc}（{}）先过期，先用卡保住积分",
                fmt_day(Some(card_expiry)),
                fmt_day(Some(credit_expiry))
            ),
        };
    }
    Decision {
        action: Action::KeepCredit,
        reason: format!(
            "{credit_desc}（{}）比重置卡（{}）先过期，不用卡，让积分先消耗",
            fmt_day(Some(credit_expiry)),
            fmt_day(Some(card_expiry))
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(t: i64, total: f64, used: f64, unlimited: bool) -> QuotaState {
        QuotaState { quota_type: t, total, used, is_unlimited: unlimited }
    }

    fn c(days: i64) -> UsableCard {
        UsableCard {
            card_id: "C1".into(),
            source_type: "mcode_signin".into(),
            out_biz_no: "b1".into(),
            expire_time: 1_700_000_000_000 + days * 86_400_000,
        }
    }

    #[test]
    fn percent_strings() {
        assert_eq!(percent(&serde_json::json!("71%")), 71.0);
        assert_eq!(percent(&serde_json::json!("100%")), 100.0);
        assert_eq!(percent(&serde_json::json!(0)), 0.0);
        assert_eq!(percent(&serde_json::json!("")), 0.0);
    }

    #[test]
    fn amount_strings() {
        assert_eq!(amount(&serde_json::json!("17400.00")), 17400.0);
        assert_eq!(amount(&serde_json::json!("1,200.50")), 1200.5);
    }

    #[test]
    fn exhausted_rules() {
        assert!(!q(1, 100.0, 99.0, false).exhausted());
        assert!(q(1, 100.0, 100.0, false).exhausted());
        assert!(!q(1, 100.0, 100.0, true).exhausted(), "不限量不算耗尽");
        assert!(!q(1, 0.0, 0.0, false).exhausted(), "总量为 0 不算耗尽");
    }

    #[test]
    fn decide_branches() {
        let five_ok = vec![q(1, 100.0, 50.0, false), q(2, 100.0, 0.0, true)];
        let five_dead = vec![q(1, 100.0, 100.0, false), q(2, 100.0, 0.0, true)];
        let week_dead = vec![q(1, 100.0, 50.0, false), q(2, 100.0, 100.0, false)];
        let credit = Some(1_700_000_000_000 + 13 * 86_400_000);

        assert_eq!(decide(&five_ok, &[c(7)], credit, "平台积分").action, Action::Idle);
        assert_eq!(decide(&five_dead, &[c(7)], credit, "平台积分").action, Action::UseCard);
        assert_eq!(decide(&five_dead, &[], credit, "平台积分").action, Action::KeepCredit);
        assert_eq!(decide(&five_dead, &[], None, "").action, Action::Wait);
        assert_eq!(decide(&five_dead, &[c(7)], None, "").action, Action::UseCard);
        assert_eq!(decide(&week_dead, &[c(7)], credit, "平台积分").action, Action::UseCard);
        // 积分更早过期 → 不用卡
        let credit_soon = Some(1_700_000_000_000 + 2 * 86_400_000);
        assert_eq!(
            decide(&five_dead, &[c(20)], credit_soon, "平台积分").action,
            Action::KeepCredit
        );
    }

    #[test]
    fn reasons_are_filled() {
        let five_dead = vec![q(1, 100.0, 100.0, false), q(2, 100.0, 0.0, true)];
        let d = decide(&five_dead, &[], Some(1_700_000_000_000 + 13 * 86_400_000), "平台积分");
        assert!(d.reason.contains("没有可用的重置卡"), "{}", d.reason);
        assert!(d.reason.contains("平台积分"), "{}", d.reason);
    }
}
