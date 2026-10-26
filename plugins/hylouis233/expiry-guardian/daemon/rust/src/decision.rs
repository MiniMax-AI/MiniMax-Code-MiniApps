//! 额度与到期判定。
//!
//! 这些分支与 Mini App「蹬王之王」的 `decide(, true)` 一一对应，
//! 由 `verify-parity.mjs` 逐字比对「动作 + 理由文本」来防止漂移。
//! **改动任何一条理由文案，两侧都要同步改，并重跑校验器。**

use serde::Deserialize;

pub const QUOTA_FIVE_HOUR: i64 = 1;
pub const QUOTA_WEEKLY: i64 = 2;
pub const QUOTA_VIDEO: i64 = 3;

/// 默认触发阈值 99%。实际生效值来自 config.json，这里只作兜底。
/// 与 Node / Python 保持一致；改动必须同步三处。
pub const DEFAULT_QUOTA_TRIGGER_PERCENT: f64 = 99.0;
/// 默认「额度紧张」分界点（黄）。
pub const DEFAULT_QUOTA_TIGHT_PERCENT: f64 = 80.0;
/// 默认「额度不足」分界点（红）。
pub const DEFAULT_QUOTA_LOW_PERCENT: f64 = 95.0;
/// 默认「距刷新不足这么多分钟就不烧重置卡」。实际生效值来自 config.json。
pub const DEFAULT_CARD_SKIP_BEFORE_RESET_MINUTES: f64 = 60.0;

/// 额度分档。与 Node 的 `quotaLevel()`、Python 的 `_quota_level()` 逐字同构。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Comfortable,
    Tight,
    Low,
    Burned,
}

impl Level {
    /// 中文文案。**属于 parity 契约的一部分**，改一个字三方都要改。
    pub fn label(&self) -> &'static str {
        match self {
            Level::Comfortable => "额度充足",
            Level::Tight => "额度紧张",
            Level::Low => "额度不足",
            Level::Burned => "额度燃尽",
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Level::Comfortable => "comfortable",
            Level::Tight => "tight",
            Level::Low => "low",
            Level::Burned => "burned",
        }
    }
}

/// 额度分档：comfortable / tight / low / burned。
///
/// **burned 必须先判**：若先判 low，`used=100` 会命中 `ratio >= low`
/// 被算成「不足」，燃尽这一档就永远显示不出来。
///
/// 燃尽只用 `used >= total` 判定，**不读 exhausted**：
/// Python 的 exhausted 带 -1e-9 容差而本文件没有，
/// 若依赖它会在极限值上产生三方不一致。
pub fn quota_level(
    used: f64,
    total: f64,
    unlimited: bool,
    tight: f64,
    low: f64,
) -> Level {
    if unlimited || total <= 0.0 {
        return Level::Comfortable;
    }
    if used >= total {
        return Level::Burned;
    }
    let ratio = used / total * 100.0;
    if ratio >= low {
        return Level::Low;
    }
    if ratio >= tight {
        return Level::Tight;
    }
    Level::Comfortable
}

/// 一个限额维度的用量。
#[derive(Debug, Clone, Copy)]
pub struct QuotaState {
    pub quota_type: i64,
    pub total: f64,
    pub used: f64,
    pub is_unlimited: bool,
    /// 该维度额度的刷新时间（毫秒时间戳）。
    ///
    /// 有了它才能判断「额度马上就要自己刷新了」——
    /// 那种时候再烧一张重置卡就是纯浪费。
    pub reset_time_ms: Option<i64>,
}

impl QuotaState {
    /// 是否已耗尽。不限量或总量为 0 都不算耗尽。
    pub fn exhausted(&self) -> bool {
        if self.is_unlimited || self.total <= 0.0 {
            return false;
        }
        self.used >= self.total
    }

    /// 决策触发线：额度用到 `trigger_percent` 即视为「该动手了」。
    ///
    /// 不等真正耗尽 —— 等耗尽时那次请求已经失败，会打断当前目标
    /// 正在跑的自动执行。提前介入代价几乎为零。
    pub fn triggered(&self, trigger_percent: f64) -> bool {
        if self.is_unlimited || self.total <= 0.0 {
            return false;
        }
        self.used >= self.total * trigger_percent / 100.0
    }

    /// 展示用分档。与 `triggered()` 相互独立。
    pub fn level(&self, tight: f64, low: f64) -> Level {
        quota_level(self.used, self.total, self.is_unlimited, tight, low)
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
    /// 周限额的刷新时间。与 Python 的 `weekly_end_time` 同一字段名。
    #[serde(default)]
    pub weekly_end_time: Option<i64>,
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
            reset_time_ms: g.end_time,
        });
        out.push(QuotaState {
            quota_type: QUOTA_WEEKLY,
            total: {
                let t = percent(&g.current_weekly_total_percent);
                if t > 0.0 { t } else { 100.0 }
            },
            used: percent(&g.current_weekly_used_percent),
            is_unlimited: g.current_weekly_status == 3,
            reset_time_ms: g.weekly_end_time,
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
            reset_time_ms: v.end_time,
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

/// `decide(, true)` 需要的判定参数。默认值对应 config.json 缺失时的兜底。
#[derive(Debug, Clone, Copy)]
pub struct DecisionCfg {
    pub card_trigger_percent: f64,
    pub tight: f64,
    pub low: f64,
    /// 距 5 小时额度刷新还剩不到这么多分钟时，**不消耗重置卡**。
    ///
    /// 额度马上就要自己刷新了，这时候烧一张重置卡纯属浪费。
    /// 设为 0 表示不做这个保护。
    pub card_skip_before_reset_minutes: f64,
}

impl Default for DecisionCfg {
    fn default() -> Self {
        DecisionCfg {
            card_trigger_percent: DEFAULT_QUOTA_TRIGGER_PERCENT,
            tight: DEFAULT_QUOTA_TIGHT_PERCENT,
            low: DEFAULT_QUOTA_LOW_PERCENT,
            card_skip_before_reset_minutes: DEFAULT_CARD_SKIP_BEFORE_RESET_MINUTES,
        }
    }
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
struct Tm {
    tm_sec: i32, tm_min: i32, tm_hour: i32, tm_mday: i32,
    tm_mon: i32, tm_year: i32, tm_wday: i32, tm_yday: i32, tm_isdst: i32,
    tm_gmtoff: i64, tm_zone: *const u8,
}

// ⚠️ 手写而不是 `#[derive(Default)]`（2026-10-21 维护者 review）：
// `*const u8` 的 `Default` 实现并非所有 Rust 工具链都有
// （老版本 cargo 直接报 E0277 ⇒ 整个包编译不过）。
// ⇒ 自己给一个全零的 tm：语义与 derive 一致，且不依赖工具链版本。
impl Default for Tm {
    fn default() -> Self {
        Tm {
            tm_sec: 0, tm_min: 0, tm_hour: 0, tm_mday: 0,
            tm_mon: 0, tm_year: 0, tm_wday: 0, tm_yday: 0, tm_isdst: 0,
            tm_gmtoff: 0, tm_zone: std::ptr::null(),
        }
    }
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

/// 5 小时额度距离刷新还有多少分钟。取不到刷新时间时返回 `None`。
///
/// 负数表示刷新时间已经过去了（接口数据没刷新），按 0 处理。
pub fn minutes_to_reset(q: Option<&QuotaState>, now_ms: i64) -> Option<f64> {
    let reset = q?.reset_time_ms?;
    Some(((reset - now_ms) as f64 / 60_000.0).max(0.0))
}

/// 后台扣卡决策（纯函数，不触碰网络）。
///
/// 动作 ∈ {use-card, keep-credit, idle, wait}。
///
/// 分支与 Mini App 的 `decide(, true)` 刻意同构：
///   未耗尽                  → idle
///   耗尽 + 无积分 + 有卡     → use-card
///   耗尽 + 无积分 + 无卡     → wait
///   耗尽 + 有积分 + 无卡     → keep-credit
///   耗尽 + 都有，卡先过期    → use-card
///   耗尽 + 都有，积分先过期  → keep-credit
///
/// `credit_data_complete` 表示「积分数据是否**完整读到**」。
///
/// ⚠️ 2026-10-19 PR #28 review 修：读不到 ≠ 没有。
/// `credit_expiry_ms = None` 同时可能表示「确实没有积分」与「接口读失败」，
/// 以前两者都落到 `use-card` 分支 —— 而扣卡是**真实写操作**，
/// 于是网络故障会被当成业务状态，可能误扣真卡。
/// ⇒ 数据不完整时一律**不做写操作**（`Action::Wait`），只如实报出来。
pub fn decide(
    quotas: &[QuotaState],
    usable_cards: &[UsableCard],
    credit_expiry_ms: Option<i64>,
    credit_desc: &str,
    cfg: &DecisionCfg,
    now_ms: i64,
    credit_data_complete: bool,
) -> Decision {
    let five = quotas.iter().find(|q| q.quota_type == QUOTA_FIVE_HOUR);
    let weekly = quotas.iter().find(|q| q.quota_type == QUOTA_WEEKLY);

    let five_triggered = five.is_some_and(|q| q.triggered(cfg.card_trigger_percent));
    let weekly_triggered = weekly.is_some_and(|q| q.triggered(cfg.card_trigger_percent));

    // ── 额度即将自己刷新 → 不烧重置卡 ──
    // 距刷新只剩几分钟的时候再扣一张重置卡是纯浪费：额度马上就自己回来了。
    // 这个保护要在所有「用卡」分支之前判定。
    let reset_in_min = minutes_to_reset(five, now_ms);
    let skip_card_reason = if cfg.card_skip_before_reset_minutes > 0.0 {
        reset_in_min.filter(|m| *m <= cfg.card_skip_before_reset_minutes).map(|m| {
            format!("5 小时额度 {:.0} 分钟后刷新，暂不消耗重置卡", m)
        })
    } else {
        None
    };

    // ── 未到触发线 ──
    if !five_triggered && !weekly_triggered {
        return Decision {
            action: Action::Idle,
            // 等级词随分档走，而不是永远写「额度充足」——
            // 否则用量 92% 时页面上仍显示「额度充足」，是误导。
            // 把触发线也说进来：否则「额度不足但暂不需要处理」看起来自相矛盾。
            //
            // burned 永远不会出现在这里：它必然已 triggered，走的是下面用卡/留卡分支。
            reason: format!(
                "{}（5 小时已用 {:.0}%），未到 {:.0}% 触发线，暂不动用重置卡",
                five
                    .map(|q| q.level(cfg.tight, cfg.low).label())
                    .unwrap_or(Level::Comfortable.label()),
                five.map(|q| q.used).unwrap_or(0.0),
                cfg.card_trigger_percent
            ),
        };
    }

    // ── 积分数据没读全 ⇒ 无法判断「卡先过期还是积分先过期」──
    // ⇒ 绝不做写操作（扣卡是真实消耗，宁可等下一轮）。
    if !credit_data_complete {
        return Decision {
            action: Action::Wait,
            reason: "积分数据读取不完整，本轮不执行写操作（等下一轮重新判定）".to_string(),
        };
    }

    // ── 无可用积分：只能靠卡 ──
    let Some(credit_expiry) = credit_expiry_ms else {
        if !usable_cards.is_empty() {
            // 额度马上要自己刷新了，就别烧卡了
            if let Some(reason) = &skip_card_reason {
                return Decision {
                    action: Action::Wait,
                    reason: reason.clone(),
                };
            }
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
        // 额度马上要自己刷新了，就别烧卡了
        if let Some(reason) = &skip_card_reason {
            return Decision {
                action: Action::Wait,
                reason: reason.clone(),
            };
        }
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
        QuotaState { quota_type: t, total, used, is_unlimited: unlimited, reset_time_ms: None }
    }

    /// 判定用的固定「当前时间」。所有与刷新时间相关的用例都以它为基准。
    const NOW: i64 = 1_700_000_000_000;

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
    fn skip_card_when_reset_is_imminent() {
        // 额度已经到触发线，本来会走「用卡」分支。
        let mut quotas = vec![q(1, 100.0, 99.0, false), q(2, 100.0, 0.0, true)];
        let credit = Some(NOW + 13 * 86_400_000);
        let cfg = DecisionCfg::default(); // 默认跳过窗口 60 分钟

        // 刷新在 2 小时后 → 照常用卡
        quotas[0].reset_time_ms = Some(NOW + 120 * 60_000);
        assert_eq!(decide(&quotas, &[c(7)], credit, "平台积分", &cfg, NOW, true).action, Action::UseCard);

        // 刷新在 10 分钟后 → 不烧卡，等它自己刷新
        quotas[0].reset_time_ms = Some(NOW + 10 * 60_000);
        let d = decide(&quotas, &[c(7)], credit, "平台积分", &cfg, NOW, true);
        assert_eq!(d.action, Action::Wait, "额度马上要刷新，不该烧重置卡");
        assert!(d.reason.contains("分钟后刷新"), "理由要说清为什么不动: {}", d.reason);

        // 窗口设为 0 → 关闭该保护，照常烧卡
        let no_skip = DecisionCfg { card_skip_before_reset_minutes: 0.0, ..Default::default() };
        assert_eq!(decide(&quotas, &[c(7)], credit, "平台积分", &no_skip, NOW, true).action, Action::UseCard);

        // 窗口放大到 180 分钟 → 10 分钟后刷新也跳过
        let wide = DecisionCfg { card_skip_before_reset_minutes: 180.0, ..Default::default() };
        assert_eq!(decide(&quotas, &[c(7)], credit, "平台积分", &wide, NOW, true).action, Action::Wait);
    }

    #[test]
    fn minutes_to_reset_is_optional_and_clamped() {
        assert_eq!(minutes_to_reset(None, NOW), None);
        assert_eq!(minutes_to_reset(Some(&q(1, 100.0, 50.0, false)), NOW), None, "没有刷新时间就无从判断");
        let mut x = q(1, 100.0, 50.0, false);
        x.reset_time_ms = Some(NOW + 30 * 60_000);
        assert_eq!(minutes_to_reset(Some(&x), NOW), Some(30.0));
        x.reset_time_ms = Some(NOW - 60_000);
        assert_eq!(minutes_to_reset(Some(&x), NOW), Some(0.0), "已过去的时间按 0 算");
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
        let cfg = DecisionCfg::default();
        let five_ok = vec![q(1, 100.0, 50.0, false), q(2, 100.0, 0.0, true)];
        let five_dead = vec![q(1, 100.0, 100.0, false), q(2, 100.0, 0.0, true)];
        let week_dead = vec![q(1, 100.0, 50.0, false), q(2, 100.0, 100.0, false)];
        let credit = Some(1_700_000_000_000 + 13 * 86_400_000);

        assert_eq!(decide(&five_ok, &[c(7)], credit, "平台积分", &cfg, NOW, true).action, Action::Idle);
        assert_eq!(decide(&five_dead, &[c(7)], credit, "平台积分", &cfg, NOW, true).action, Action::UseCard);
        assert_eq!(decide(&five_dead, &[], credit, "平台积分", &cfg, NOW, true).action, Action::KeepCredit);
        assert_eq!(decide(&five_dead, &[], None, "", &cfg, NOW, true).action, Action::Wait);
        assert_eq!(decide(&five_dead, &[c(7)], None, "", &cfg, NOW, true).action, Action::UseCard);
        assert_eq!(decide(&week_dead, &[c(7)], credit, "平台积分", &cfg, NOW, true).action, Action::UseCard);
        // 积分更早过期 → 不用卡
        let credit_soon = Some(1_700_000_000_000 + 2 * 86_400_000);
        assert_eq!(
            decide(&five_dead, &[c(20)], credit_soon, "平台积分", &cfg, NOW, true).action,
            Action::KeepCredit
        );
    }

    #[test]
    fn threshold_is_configurable() {
        // 同一份输入，换阈值就换结论 —— 这正是功能1的可配置性。
        // 积分早于卡过期，所以一旦越过触发线，结论必然是 keep-credit（不用卡）。
        let quotas = vec![q(1, 100.0, 95.0, false), q(2, 100.0, 0.0, true)];
        let credit_soon = Some(1_700_000_000_000);
        let strict = DecisionCfg { card_trigger_percent: 99.0, ..Default::default() };
        let loose = DecisionCfg { card_trigger_percent: 90.0, ..Default::default() };
        assert_eq!(
            decide(&quotas, &[c(7)], credit_soon, "平台积分", &strict, NOW, true).action,
            Action::Idle,
            "95% 未到 99% 触发线，应保持 idle"
        );
        assert_eq!(
            decide(&quotas, &[c(7)], credit_soon, "平台积分", &loose, NOW, true).action,
            Action::KeepCredit,
            "阈值放宽到 90% 后应越过触发线，进入先过期先用判定"
        );
    }

    #[test]
    fn quota_level_boundaries() {
        let l = quota_level;
        assert_eq!(l(79.0, 100.0, false, 80.0, 95.0), Level::Comfortable);
        assert_eq!(l(80.0, 100.0, false, 80.0, 95.0), Level::Tight);
        assert_eq!(l(94.9, 100.0, false, 80.0, 95.0), Level::Tight);
        assert_eq!(l(95.0, 100.0, false, 80.0, 95.0), Level::Low);
        assert_eq!(l(99.0, 100.0, false, 80.0, 95.0), Level::Low);
        // 燃尽必须先判，不能被 low 抢先命中
        assert_eq!(l(100.0, 100.0, false, 80.0, 95.0), Level::Burned);
        assert_eq!(l(120.0, 100.0, false, 80.0, 95.0), Level::Burned);
        // 不限量 / 总量为 0 → 恒为充足
        assert_eq!(l(99.0, 100.0, true, 80.0, 95.0), Level::Comfortable);
        assert_eq!(l(0.0, 0.0, false, 80.0, 95.0), Level::Comfortable);
        // 分界点可配
        assert_eq!(l(70.0, 100.0, false, 60.0, 90.0), Level::Tight);
    }

    #[test]
    fn idle_reason_follows_level() {
        let cfg = DecisionCfg::default();
        // 92% 不能再写「额度充足」——那是误导
        let d92 = decide(&vec![q(1, 100.0, 92.0, false), q(2, 100.0, 0.0, true)], &[], Some(1), "平台积分", &cfg, NOW, true);
        assert_eq!(d92.action, Action::Idle);
        assert!(d92.reason.starts_with("额度紧张"), "{}", d92.reason);
        assert!(d92.reason.contains("92%"), "{}", d92.reason);

        let d12 = decide(&vec![q(1, 100.0, 12.0, false), q(2, 100.0, 0.0, true)], &[], Some(1), "平台积分", &cfg, NOW, true);
        assert!(d12.reason.starts_with("额度充足"), "{}", d12.reason);

        let d97 = decide(&vec![q(1, 100.0, 97.0, false), q(2, 100.0, 0.0, true)], &[], Some(1), "平台积分", &cfg, NOW, true);
        assert!(d97.reason.starts_with("额度不足"), "{}", d97.reason);
    }

    #[test]
    fn burned_never_appears_in_idle_reason() {
        // burned 必然已 triggered，走用卡/留卡分支，不该出现在 idle 理由里
        let cfg = DecisionCfg { card_trigger_percent: 100.0, ..Default::default() };
        let d = decide(&vec![q(1, 100.0, 100.0, false), q(2, 100.0, 0.0, true)], &[c(7)], Some(1_700_000_000_000), "平台积分", &cfg, NOW, true);
        assert_ne!(d.action, Action::Idle);
        assert!(!d.reason.contains("额度燃尽"), "{}", d.reason);
    }

    #[test]
    fn reasons_are_filled() {
        let cfg = DecisionCfg::default();
        let five_dead = vec![q(1, 100.0, 100.0, false), q(2, 100.0, 0.0, true)];
        let d = decide(&five_dead, &[], Some(1_700_000_000_000 + 13 * 86_400_000), "平台积分", &cfg, NOW, true);
        assert!(d.reason.contains("没有可用的重置卡"), "{}", d.reason);
        assert!(d.reason.contains("平台积分"), "{}", d.reason);
    }

    /// 回归测试：积分数据读取失败时**绝不扣卡**。
    ///
    /// ⚠️ 2026-10-19 PR #28 review 修：读不到 ≠ 没有。
    /// `credit_expiry_ms = None` 同时可能表示「确实没有积分」与「接口读失败」，
    /// 以前两者都落到 `use-card` —— 而扣卡是真实写操作，
    /// 网络故障会被当成业务状态，可能误扣真卡。
    #[test]
    fn incomplete_credit_data_never_spends_a_card() {
        let cfg = DecisionCfg::default();
        // 额度已耗尽，有一张卡，但积分数据**没读全**
        let quotas = vec![q(1, 100.0, 100.0, false)];
        let cards = vec![c(7)];
        let d = decide(&quotas, &cards, None, "", &cfg, NOW, false);
        assert_eq!(
            d.action,
            Action::Wait,
            "积分数据不完整时必须 wait，不能用卡"
        );
        assert!(
            d.reason.contains("读取不完整"),
            "理由要如实说明数据不完整: {}",
            d.reason
        );

        // 对照：同样条件下，数据完整 ⇒ 确实没有积分 ⇒ 可以用卡
        let d2 = decide(&quotas, &cards, None, "", &cfg, NOW, true);
        assert_eq!(
            d2.action,
            Action::UseCard,
            "数据完整且确实无积分时，用卡是正确的"
        );
    }
}
