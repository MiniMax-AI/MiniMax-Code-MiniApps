//! 后台守护进程：额度探测 + 先过期先用决策 + 自动扣卡。
//!
//! 与 Mini App「蹬王之王」的判定逻辑严格同构，由 `verify-parity.mjs`
//! 逐字比对「动作 + 理由文本」防止漂移。
//!
//! 设计要点：
//!   - 分层缓存：额度每轮取，积分/卡/汇总按各自变化速度缓存
//!   - 先记账再请求：崩溃或重启都不会重复扣同一张卡
//!   - 幂等键：用服务端下发的 out_biz_no，重试安全

mod api;
mod decision;
mod state;

use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

use api::{Client, ApiError, BASE_CN};
use decision::{
    amount, decide, fmt_day, parse_quotas, Action, QuotaState, RemainsPayload, UsableCard,
};
use serde_json::json;

/// 日志：带本地时间戳，便于 tail 追踪。
fn log(msg: &str) {
    use std::io::Write;
    let now = api::now_ms();
    let secs = now.div_euclid(1000);
    let ms = now.rem_euclid(1000);
    // 复用 decision 里的本地时区换算
    let (month, day) = decision::local_md(secs);
    let (hh, mm) = decision::local_hm(secs);
    let _ = std::io::stdout().write_all(
        format!("[{month:02}-{day:02} {hh:02}:{mm:02}.{ms:03}] {msg}\n").as_bytes(),
    );
}

/// 各数据源的缓存 TTL（毫秒）。按变化速度分配，不是所有数据都值得每轮取。
struct Ttl {
    quota: i64,
    code_credits: i64,
    cards: i64,
    platform: i64,
}

impl Default for Ttl {
    fn default() -> Self {
        // quota TTL=0：额度是所有联动的触发源，必须每轮看。
        // 其余按「多久会变」给：积分随消耗变、卡按天签到变、平台池极少变。
        Ttl { quota: 0, code_credits: 60_000, cards: 300_000, platform: 300_000 }
    }
}

struct Cache<T: Clone> {
    slots: BTreeMap<&'static str, (Option<T>, i64)>,
}

impl<T: Clone> Cache<T> {
    fn new() -> Self {
        Cache { slots: BTreeMap::new() }
    }
    fn get(&mut self, key: &'static str, ttl: i64) -> Option<T> {
        let entry = self.slots.get(key).cloned();
        if let Some((Some(v), at)) = entry {
            if api::now_ms() - at < ttl {
                return Some(v);
            }
        }
        None
    }
    fn put(&mut self, key: &'static str, value: T) {
        self.slots.insert(key, (Some(value), api::now_ms()));
    }
    fn invalidate(&mut self, key: &str) {
        self.slots.remove(key);
    }
}

struct Caches {
    quota: Cache<serde_json::Value>,
    code: Cache<serde_json::Value>,
    platform: Cache<serde_json::Value>,
    cards: Cache<Vec<serde_json::Value>>,
}

impl Caches {
    fn new() -> Self {
        Caches {
            quota: Cache::new(),
            code: Cache::new(),
            platform: Cache::new(),
            cards: Cache::new(),
        }
    }
}

struct Daemon {
    client: Client,
    ttl: Ttl,
    cache: Caches,
}

/// 取缓存：命中则零网络，未命中才请求。
///
/// 做成自由函数（而非 `&mut self` 方法）：这样 `cache` 与 `client`
/// 可以分别借用，不会触发「同一个 self 被可变借两次」。
fn cached(
    client: &mut Client,
    cache: &mut Cache<serde_json::Value>,
    key: &'static str,
    ttl: i64,
    load: impl FnOnce(&mut Client) -> Result<serde_json::Value, ApiError>,
) -> Result<serde_json::Value, ApiError> {
    if let Some(v) = cache.get(key, ttl) {
        return Ok(v);
    }
    let v = load(client)?;
    cache.put(key, v.clone());
    Ok(v)
}

impl Daemon {
    fn new(client: Client) -> Self {
        Daemon { client, ttl: Ttl::default(), cache: Caches::new() }
    }

    fn quotas(&mut self) -> Vec<QuotaState> {
        let ttl = self.ttl.quota;
        let Daemon { client, cache, .. } = self;
        match cached(client, &mut cache.quota, "quota", ttl, |c| {
            c.get("/backend/account/token_plan/remains_percent", false)
        }) {
            Ok(v) => {
                let payload: RemainsPayload = serde_json::from_value(v).unwrap_or(RemainsPayload {
                    model_remains: vec![],
                });
                parse_quotas(&payload)
            }
            Err(e) => {
                log(&format!("  额度读取失败（沿用上次）: {e}"));
                vec![]
            }
        }
    }

    /// 全部分页拉取重置卡
    fn all_cards(&mut self) -> Vec<serde_json::Value> {
        let ttl = self.ttl.cards;
        if let Some(v) = self.cache.cards.get("cards", ttl) {
            return v;
        }
        let mut seen: HashSet<String> = HashSet::new();
        let mut all = Vec::new();
        for page in 1..=10 {
            match self
                .client
                .get(&format!("/backend/account/reset_card/list?page={page}&size=20"), false)
            {
                Ok(v) => {
                    let cards = v.get("cards").and_then(|c| c.as_array()).cloned().unwrap_or_default();
                    if cards.is_empty() {
                        break;
                    }
                    let n = cards.len();
                    for c in cards {
                        if let Some(id) = c.get("card_id").and_then(|x| x.as_str()) {
                            if seen.insert(id.to_string()) {
                                all.push(c);
                            }
                        }
                    }
                    if n < 20 {
                        break;
                    }
                }
                Err(e) => {
                    log(&format!("  重置卡列表读取失败（忽略）: {e}"));
                    break;
                }
            }
        }
        self.cache.cards.put("cards", all.clone());
        all
    }

    /// 可用于扣卡的卡：未过期 + 有 out_biz_no + 有 source_type，按到期排序
    fn usable_cards(&mut self) -> Vec<UsableCard> {
        let now = api::now_ms();
        let mut out: Vec<UsableCard> = self
            .all_cards()
            .iter()
            .filter_map(|c| {
                let expire = c.get("expire_time").and_then(|v| v.as_i64())?;
                if expire <= now {
                    return None;
                }
                let out_biz_no = c.get("out_biz_no").and_then(|v| v.as_str()).unwrap_or("");
                let source_type = c.get("source_type").and_then(|v| v.as_str()).unwrap_or("");
                if out_biz_no.is_empty() || source_type.is_empty() {
                    return None;
                }
                Some(UsableCard {
                    card_id: c.get("card_id")?.as_str()?.to_string(),
                    source_type: source_type.to_string(),
                    out_biz_no: out_biz_no.to_string(),
                    expire_time: expire,
                })
            })
            .collect();
        out.sort_by_key(|c| c.expire_time);
        out
    }

    /// 全账户里最早到期的一笔「仍有效且有余额」的积分（两个来源取更早的）
    fn earliest_credit(&mut self) -> (Option<i64>, String) {
        let now = api::now_ms();
        let mut best: Option<i64> = None;
        let mut desc = String::new();

        let mut consider = |exp: Option<i64>, balance: f64, label: &str| {
            let (Some(e), true) = (exp, balance > 0.0) else { return };
            if e <= now {
                return;
            }
            if best.is_none_or(|b| e < b) {
                best = Some(e);
                desc = label.to_string();
            }
        };

        // 平台积分池
        let pttl = self.ttl.platform;
        let platform_result = {
            let Daemon { client, cache, .. } = self;
            cached(client, &mut cache.platform, "platform", pttl, |c| {
                c.get("/backend/account/token_plan_credit", false)
            })
        };
        match platform_result {
            Ok(v) => {
                if let Some(buckets) = v
                    .get("balance_breakdown")
                    .and_then(|b| b.get("buckets"))
                    .and_then(|b| b.as_array())
                {
                    for b in buckets {
                        let label = match b.get("source").and_then(|s| s.as_i64()) {
                            Some(2) => "平台积分·充值".to_string(),
                            Some(3) => "平台积分·赠送".to_string(),
                            _ => "平台积分·未知".to_string(),
                        };
                        consider(
                            b.get("expire_time_ms").and_then(|v| v.as_i64()),
                            amount(b.get("balance").unwrap_or(&json!(0))),
                            &label,
                        );
                    }
                }
            }
            Err(e) => log(&format!("  平台积分读取失败（忽略）: {e}")),
        }

        // Code 积分明细
        let cttl = self.ttl.code_credits;
        let raw = {
            let Daemon { client, cache, .. } = self;
            cached(client, &mut cache.code, "code", cttl, |c| {
                c.get(
                    "/minimax-cloud/api/v1/credit/details?page_number=1&page_size=100&include_expired=1",
                    true,
                )
            })
        };
        match raw {
            Ok(v) => {
                if let Some(details) = v.get("details").and_then(|d| d.as_array()) {
                    for item in details {
                        let label = if item.get("credit_type").and_then(|c| c.as_i64()) == Some(2) {
                            "Code 积分·赠送"
                        } else {
                            "Code 积分·购买"
                        };
                        consider(
                            item.get("expire_at_ms").and_then(|v| v.as_i64()),
                            amount(item.get("remaining_amount").unwrap_or(&json!(0))),
                            label,
                        );
                    }
                }
            }
            Err(e) => log(&format!("  Code 积分读取失败（忽略）: {e}")),
        }

        (best, desc)
    }

    /// 一轮：判定 + 必要时扣卡
    fn tick(&mut self, dry_run: bool) -> Result<(Action, String, bool), ApiError> {
        let quotas = self.quotas();
        let usable = self.usable_cards();
        let (credit_expiry, credit_desc) = self.earliest_credit();

        let d = decide(&quotas, &usable, credit_expiry, &credit_desc);
        log(&format!(
            "额度: {}",
            quotas.iter().map(|q| q.describe()).collect::<Vec<_>>().join(" | ")
        ));
        log(&format!("决策[{}]: {}", d.action.as_str(), d.reason));

        if d.action != Action::UseCard || dry_run {
            return Ok((d.action, d.reason, false));
        }
        let Some(card) = usable.first() else {
            return Ok((d.action, d.reason, false));
        };

        let fingerprint = format!("{}:{}", card.card_id, card.out_biz_no);
        if state::was_spent(&fingerprint) {
            log("这张卡本进程已尝试过，跳过");
            return Ok((d.action, d.reason, false));
        }

        // 先记账再请求：崩溃/重启都不会重复扣
        state::mark_spent(&fingerprint, &card.card_id, &card.source_type);
        self.cache.cards.invalidate("cards");

        match self
            .client
            .post(
                "/backend/account/reset_card/use",
                &json!({ "source_type": card.source_type, "out_biz_no": card.out_biz_no }),
                false,
            ) {
            Ok(v) => {
                let outcome = v.get("outcome").and_then(|x| x.as_str()).unwrap_or("UNKNOWN");
                let ok = outcome == "SUCCESS" || outcome == "REPLAYED";
                if ok {
                    log(&format!("✓ 已使用重置卡 {}，额度已重置", card.card_id));
                } else {
                    log(&format!("✗ 重置卡不可用（{outcome}）"));
                }
                Ok((d.action, d.reason, ok))
            }
            Err(e) => {
                log(&format!("✗ 扣卡失败：{e}"));
                Ok((d.action, d.reason, false))
            }
        }
    }
}

/// 校验模式：读入与 Node/Python 同一份用例 JSON，打印同样的结果结构。
///
/// 供 `verify-parity.mjs` 调用，让三方（Mini App / Python / Rust）跑同一组输入。
/// 不联网、不落盘，纯函数比对。
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
    let mut out = Vec::new();

    for c in payload["cases"].as_array().cloned().unwrap_or_default() {
        let mk = |t: i64, used: f64, total: f64, unlimited: bool| QuotaState {
            quota_type: t,
            total,
            used,
            is_unlimited: unlimited,
        };
        let five_used = c["five"].as_f64().unwrap_or(0.0);
        let week_used = c["week"].as_i64();
        let quotas = vec![
            mk(1, five_used, 100.0, false),
            match week_used {
                None => mk(2, 0.0, 100.0, true),
                Some(w) => mk(2, w as f64, 100.0, false),
            },
        ];
        let cards: Vec<UsableCard> = c["cards"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| {
                let d = v.as_i64()?;
                Some(UsableCard {
                    card_id: format!("C{d}"),
                    source_type: "mcode_signin".into(),
                    out_biz_no: format!("b{d}"),
                    expire_time: now + d * day,
                })
            })
            .collect();
        let credit = c["credit"].as_i64().map(|d| now + d * day);

        let d = decide(&quotas, &cards, credit, "平台积分");
        out.push(serde_json::json!({
            "n": c["n"].as_str().unwrap_or(""),
            "action": d.action.as_str(),
            "reason": d.reason,
        }));
    }
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--selftest") {
        selftest();
        return;
    }

    let mut interval: f64 = 60.0;
    let mut dry_run = false;
    let mut cmd = "watch".to_string();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--interval" if i + 1 < args.len() => {
                interval = args[i + 1].parse().unwrap_or(60.0);
                i += 2;
            }
            "--base" if i + 1 < args.len() => i += 2,
            "--dry-run" => {
                dry_run = true;
                i += 1;
            }
            "watch" | "once" | "status" | "forget" => {
                cmd = args[i].clone();
                i += 1;
            }
            _ => i += 1,
        }
    }

    if cmd == "forget" {
        state::clear_spent();
        println!("已清空本地去重记录。");
        return;
    }

    let client = match Client::new(BASE_CN) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("初始化失败：{e}");
            std::process::exit(1);
        }
    };
    let mut daemon = Daemon::new(client);

    if cmd == "once" {
        match daemon.tick(dry_run) {
            Ok(_) => {}
            Err(e) => {
                eprintln!("失败：{e}");
                std::process::exit(1);
            }
        }
        return;
    }

    log(&format!("启动后台监控，间隔 {interval}s（Ctrl+C 退出）"));
    log("扣卡策略：与 Mini App「蹬王之王」一致 —— 额度真正耗尽才动手，并按先过期先用");
    loop {
        match daemon.tick(dry_run) {
            Ok(_) => {}
            Err(e) if e.is_unauthorized() => {
                log(&format!(
                    "✗ 鉴权失败：{e}。请确认 MiniMax Code 桌面端已启动并处于登录状态。"
                ));
                std::process::exit(1);
            }
            Err(e) => log(&format!("⚠️  本轮失败：{e}，下一轮继续")),
        }
        // 抖动，避免与整点/整 5 小时重置撞在一起
        let jitter = (api::now_ms() % 1000) as f64 / 1000.0 * 4.0 - 2.0;
        std::thread::sleep(Duration::from_millis(((interval + jitter) * 1000.0) as u64));
    }
}
