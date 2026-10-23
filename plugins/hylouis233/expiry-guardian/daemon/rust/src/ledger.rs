//! 本地账本：额度、积分与重置卡的**本地**数据源。
//!
//! # 为什么是「本地账本」而不是账号接口
//!
//! 社区插件不能读取 MiniMax Code 的登录凭据（2026-10-20 管理员 review 要求），
//! 因此这个插件**不再**自己去调账号接口、也不再去读宿主内部数据库。
//!
//! ⇒ 额度、积分、重置卡的到期信息改由**用户自己维护的一份本地账本**提供：
//! `~/.config/mcode-reset-card/ledger.json`。
//!
//! # 账本长什么样
//!
//! ```json
//! {
//!   "schemaVersion": 1,
//!   "updatedAtMs": 1792480000000,
//!   "quota": {
//!     "fiveHour": { "usedPercent": 3, "unlimited": false, "resetTimeMs": 1792497600000 },
//!     "weekly":  { "usedPercent": 0, "unlimited": true,  "resetTimeMs": 1792944000000 }
//!   },
//!   "cards": [
//!     { "cardId": "card_1", "label": "重置卡 A", "sourceType": "code",
//!       "outBizNo": "biz_1", "expireTimeMs": 1795000000000 }
//!   ],
//!   "credits": [
//!     { "label": "赠送", "source": "code", "granted": 400, "used": 0,
//!       "balance": 400, "expireTimeMs": 1795017600000 }
//!   ]
//! }
//! ```
//!
//! # 关键性质：决策引擎的输入结构**一个字都没改**
//!
//! `decision::decide()` 的入参（`QuotaState` / `UsableCard` / `credit_expiry_ms` …）
//! 与之前从账号接口拿到的完全同构 ⇒
//! 决策逻辑、三方一致性校验（Rust / Mini App / Python 逐字比对）**原样保留**。
//! 变的只是「数据从哪来」。

use std::path::PathBuf;

use crate::decision::{QuotaState, UsableCard, QUOTA_FIVE_HOUR, QUOTA_WEEKLY};

/// 账本文件的位置：`~/.config/mcode-reset-card/ledger.json`。
pub fn ledger_path() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join(".config/mcode-reset-card/ledger.json"))
}

/// 一份账本读出来之后的样子。
#[derive(Debug, Clone, Default)]
pub struct Ledger {
    /// 额度（5 小时 / 周）。
    pub quotas: Vec<QuotaState>,
    /// 还能用的重置卡。
    pub usable_cards: Vec<UsableCard>,
    /// 最早到期的、还有余额的积分的到期时间。
    pub credit_expiry_ms: Option<i64>,
    /// 那一笔积分的来源描述（给「理由文本」用）。
    pub credit_desc: String,
    /// 积分数据是否**完整读到**。
    ///
    /// ⚠️ 「读不到 ≠ 没有」：账本文件缺失或解析失败 ⇒ `false`
    /// ⇒ 决策走 `wait`（绝不做写操作），而不是「没有积分 ⇒ 用卡」。
    pub credit_data_complete: bool,
    /// 账本里记的时间戳（毫秒），0 = 未知。
    pub updated_at_ms: i64,
}

/// 读账本。
///
/// 返回 `Err` 表示**读不到/解析不了**（文件不存在、JSON 坏了、字段不对）。
/// ⇒ 调用方要**如实报出来**，不能当成「账本是空的」。
pub fn read() -> Result<Ledger, String> {
    let Some(path) = ledger_path() else {
        return Err("取不到 $HOME，找不到账本路径".to_string());
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            return Err(format!(
                "读不到账本 {}（{e}）",
                path.display()
            ))
        }
    };
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("账本 {} 解析失败（{e}）", path.display()))?;
    parse(&v)
}

/// 从已解析的 JSON 里取账本（纯函数，可直接单测）。
pub fn parse(v: &serde_json::Value) -> Result<Ledger, String> {
    let updated_at_ms = v.get("updatedAtMs").and_then(|x| x.as_i64()).unwrap_or(0);

    // ── 额度 ──
    let mut quotas = Vec::new();
    if let Some(q) = v.get("quota") {
        let pick = |key: &str| -> Option<QuotaState> {
            let o = q.get(key)?;
            let used = o.get("usedPercent").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let unlimited = o.get("unlimited").and_then(|x| x.as_bool()).unwrap_or(false);
            let total = o.get("totalPercent").and_then(|x| x.as_f64()).unwrap_or(100.0);
            let reset = o.get("resetTimeMs").and_then(|x| x.as_i64()).filter(|v| *v > 0);
            Some(QuotaState {
                quota_type: if key == "fiveHour" { QUOTA_FIVE_HOUR } else { QUOTA_WEEKLY },
                total,
                used,
                is_unlimited: unlimited,
                reset_time_ms: reset,
            })
        };
        if let Some(s) = pick("fiveHour") {
            quotas.push(s);
        }
        if let Some(s) = pick("weekly") {
            quotas.push(s);
        }
    }

    // ── 重置卡 ──
    // ⚠️ 「能用」= 有 out_biz_no + 有 source_type + 还没过期。
    //    这三个字段缺一不可（决策与执行都要用）。
    let now = crate::clock::now_ms();
    let mut usable_cards = Vec::new();
    if let Some(list) = v.get("cards").and_then(|x| x.as_array()) {
        for c in list {
            let expire_time = c.get("expireTimeMs").and_then(|x| x.as_i64()).unwrap_or(0);
            let out_biz_no = c.get("outBizNo").and_then(|x| x.as_str()).unwrap_or("");
            let source_type = c.get("sourceType").and_then(|x| x.as_str()).unwrap_or("");
            if out_biz_no.is_empty() || source_type.is_empty() || expire_time <= now {
                continue;
            }
            usable_cards.push(UsableCard {
                card_id: c
                    .get("cardId")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                source_type: source_type.to_string(),
                out_biz_no: out_biz_no.to_string(),
                expire_time,
            });
        }
    }

    // ── 积分 ──
    // ⚠️ `credits` 字段**必须存在**（哪怕是空数组）才算「数据完整」。
    //    字段缺失 ⇒ 读不到 ⇒ `credit_data_complete = false` ⇒ 决策走 wait。
    let mut credit_data_complete = false;
    let mut credit_expiry_ms = None;
    let mut credit_desc = "积分".to_string();
    if let Some(list) = v.get("credits").and_then(|x| x.as_array()) {
        credit_data_complete = true;
        let mut best: Option<(i64, String)> = None;
        for c in list {
            let balance = c.get("balance").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let expire = c.get("expireTimeMs").and_then(|x| x.as_i64()).unwrap_or(0);
            if balance <= 0.0 || expire <= 0 {
                continue;
            }
            let label = c
                .get("label")
                .and_then(|x| x.as_str())
                .unwrap_or("积分")
                .to_string();
            match &best {
                Some((e, _)) if *e <= expire => {}
                _ => best = Some((expire, label)),
            }
        }
        if let Some((e, label)) = best {
            credit_expiry_ms = Some(e);
            credit_desc = label;
        }
    }

    Ok(Ledger {
        quotas,
        usable_cards,
        credit_expiry_ms,
        credit_desc,
        credit_data_complete,
        updated_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> serde_json::Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn missing_credits_field_means_incomplete() {
        // ⚠️「读不到 ≠ 没有」：credits 字段缺失 ⇒ 数据不完整
        // ⇒ 决策必须走 wait（绝不能当成「没有积分 ⇒ 用卡」）。
        let l = parse(&v(r#"{"quota":{"fiveHour":{"usedPercent":3}}}"#)).unwrap();
        assert!(!l.credit_data_complete);
        assert_eq!(l.credit_expiry_ms, None);
    }

    #[test]
    fn empty_credits_array_is_complete() {
        // 字段在、但是空数组 ⇒ 确实没有积分 ⇒ 数据是完整的。
        let l = parse(&v(r#"{"credits":[]}"#)).unwrap();
        assert!(l.credit_data_complete);
        assert_eq!(l.credit_expiry_ms, None);
    }

    #[test]
    fn earliest_credit_wins() {
        let l = parse(&v(
            r#"{"credits":[
                {"label":"远","balance":100,"expireTimeMs":1795000000000},
                {"label":"近","balance":50,"expireTimeMs":1794000000000},
                {"label":"用光","balance":0,"expireTimeMs":1793000000000}
            ]}"#,
        ))
        .unwrap();
        assert_eq!(l.credit_expiry_ms, Some(1794000000000));
        assert_eq!(l.credit_desc, "近");
    }

    #[test]
    fn cards_without_out_biz_no_are_not_usable() {
        let now = crate::clock::now_ms();
        let l = parse(&v(&format!(
            r#"{{"cards":[
                {{"cardId":"a","outBizNo":"biz","sourceType":"code","expireTimeMs":{}}},
                {{"cardId":"b","sourceType":"code","expireTimeMs":{}}},
                {{"cardId":"c","outBizNo":"biz2","expireTimeMs":{}}}
            ]}}"#,
            now + 86_400_000,
            now + 86_400_000,
            now + 86_400_000
        )))
        .unwrap();
        assert_eq!(l.usable_cards.len(), 1, "缺 out_biz_no / source_type 的卡不能用");
        assert_eq!(l.usable_cards[0].card_id, "a");
    }

    #[test]
    fn expired_cards_are_not_usable() {
        let now = crate::clock::now_ms();
        let l = parse(&v(&format!(
            r#"{{"cards":[{{"cardId":"old","outBizNo":"b","sourceType":"code","expireTimeMs":{}}}]}}"#,
            now - 1000
        )))
        .unwrap();
        assert!(l.usable_cards.is_empty(), "已过期的卡不能用");
    }

    #[test]
    fn quota_is_mapped_to_both_dimensions() {
        let l = parse(&v(
            r#"{"quota":{"fiveHour":{"usedPercent":3,"resetTimeMs":111},"weekly":{"unlimited":true}}}"#,
        ))
        .unwrap();
        assert_eq!(l.quotas.len(), 2);
        let five = l.quotas.iter().find(|q| q.quota_type == QUOTA_FIVE_HOUR).unwrap();
        assert_eq!(five.used, 3.0);
        assert_eq!(five.reset_time_ms, Some(111));
        let weekly = l.quotas.iter().find(|q| q.quota_type == QUOTA_WEEKLY).unwrap();
        assert!(weekly.is_unlimited);
    }
}
