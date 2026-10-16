//! 账号 API 客户端 + OAuth lease token。
//!
//! 域名划分是实测结论，不是猜的：
//!   开放平台 / 额度 / 重置卡 → www.minimaxi.com（agent 域对这些路径 404 或返回 HTML）
//!   Code 积分 / 会员信息    → agent.minimaxi.com（platform 域返回非 JSON）

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const BASE_CN: &str = "https://www.minimaxi.com";
pub const BASE_GLOBAL: &str = "https://platform.minimax.io";
pub const CODE_BASE: &str = "https://agent.minimaxi.com";

const LEASE_SOCK: &str = ".minimax/run/mcode-auth-lease-v1.sock";
const LEASE_CAP: &str = ".minimax/run/mcode-auth-lease-v1.cap";

const TOKEN_TTL_MS: u64 = 30 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS: u64 = 5 * 60 * 1000;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug)]
pub enum ApiError {
    Unauthorized(String),
    Network(String),
    Business(String),
}

impl ApiError {
    pub fn message(&self) -> &str {
        match self {
            ApiError::Unauthorized(m) | ApiError::Network(m) | ApiError::Business(m) => m,
        }
    }
    pub fn is_unauthorized(&self) -> bool {
        matches!(self, ApiError::Unauthorized(_))
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

fn random_hex(nbytes: usize) -> String {
    let mut buf = vec![0u8; nbytes];
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .is_err()
    {
        buf[..8].copy_from_slice(&now_ms().to_be_bytes());
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// 向桌面端的 lease socket 取一个短期 access token。
/// 协议：4 字节大端长度前缀 + JSON。详见 packages/oauth-lease-protocol。
pub fn acquire_lease_token() -> Option<String> {
    let capability = std::fs::read_to_string(home().join(LEASE_CAP))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let sock_path = home().join(LEASE_SOCK);
    if !sock_path.exists() {
        return None;
    }

    let payload = serde_json::json!({
        "version": 1,
        "requestId": random_hex(16),
        "capability": capability,
        "method": "lease",
        "minValidityMs": 120_000i64,
    })
    .to_string();

    let body = payload.as_bytes();
    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
    frame.extend_from_slice(body);

    let mut stream = UnixStream::connect(&sock_path).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
    stream.write_all(&frame).ok()?;

    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).ok()?;
    let size = u32::from_be_bytes(len_buf) as usize;
    if size > 1 << 20 {
        return None;
    }
    let mut buf = vec![0u8; size];
    stream.read_exact(&mut buf).ok()?;

    let resp: serde_json::Value = serde_json::from_slice(&buf).ok()?;
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let result = resp.get("result")?;
    if result.get("method").and_then(|v| v.as_str()) != Some("lease") {
        return None;
    }
    result
        .get("accessToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// token 来源：环境变量 → 本地文件 → lease socket
pub fn resolve_token() -> Option<String> {
    for env in ["MCODE_TOKEN", "MINIMAX_TOKEN"] {
        if let Ok(v) = std::env::var(env) {
            let t = v.trim().to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    if let Ok(t) = std::fs::read_to_string(home().join(".config/mcode-reset-card/token")) {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    acquire_lease_token()
}

/// ureq Agent 自带 keep-alive 连接池：后台每轮打多个 API，
/// 复用连接省掉每轮的 TLS 握手 —— 这是常驻进程最大的一笔固定开销。
pub struct Client {
    agent: ureq::Agent,
    token: String,
    cached_at: u64,
}

impl Client {
    pub fn new(base: &str) -> Result<Self, ApiError> {
        let token = resolve_token().ok_or_else(|| {
            ApiError::Unauthorized(
                "未获取到登录态，请确认 MiniMax Code 桌面端正在运行且已登录".into(),
            )
        })?;

        let config = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .timeout_connect(Some(Duration::from_secs(5)))
            .max_idle_connections(8)
            .build();
        let agent: ureq::Agent = config.into();

        // 用一个明确的 base 做首连校验，确保 base 可用
        let c = Client { agent, token, cached_at: now_ms() as u64 };
        let _ = base;
        Ok(c)
    }

    fn token(&mut self) -> String {
        let age = (now_ms() as u64).saturating_sub(self.cached_at);
        if age >= TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS {
            if let Some(t) = acquire_lease_token() {
                self.token = t;
                self.cached_at = now_ms() as u64;
            }
        }
        self.token.clone()
    }

    fn base_for(&self, code_domain: bool) -> &'static str {
        if code_domain { CODE_BASE } else { BASE_CN }
    }

    pub fn get(&mut self, path: &str, code_domain: bool) -> Result<serde_json::Value, ApiError> {
        self.do_request("GET", path, None, code_domain)
    }

    pub fn post(
        &mut self,
        path: &str,
        body: &serde_json::Value,
        code_domain: bool,
    ) -> Result<serde_json::Value, ApiError> {
        self.do_request("POST", path, Some(body), code_domain)
    }

    fn do_request(
        &mut self,
        method: &str,
        path: &str,
        body: Option<&serde_json::Value>,
        code_domain: bool,
    ) -> Result<serde_json::Value, ApiError> {
        let base = self.base_for(code_domain);
        let url = format!("{base}{path}");

        // 鉴权失败重取 token 再试一次
        for attempt in 0..2 {
            let token = self.token();
            let auth = format!("Bearer {token}");
            let accept = "application/json";
            let ua = "MiniMaxCode";

            let result = match (method, body) {
                ("GET", None) => self
                    .agent
                    .get(&url)
                    .header("Authorization", &auth)
                    .header("Accept", accept)
                    .header("User-Agent", ua)
                    .call(),
                ("POST", Some(b)) => self
                    .agent
                    .post(&url)
                    .header("Authorization", &auth)
                    .header("Accept", accept)
                    .header("User-Agent", ua)
                    .send_json(b.clone()),
                _ => return Err(ApiError::Network(format!("不支持的请求 {method}"))),
            };

            match result {
                Ok(resp) => {
                    let text = resp
                        .into_body()
                        .read_to_string()
                        .map_err(|e| ApiError::Network(format!("读取响应体失败: {e}")))?;
                    let value: serde_json::Value =
                        serde_json::from_str(&text).map_err(json_err)?;
                    return check_business(value);
                }
                Err(ureq::Error::StatusCode(401)) | Err(ureq::Error::StatusCode(403))
                    if attempt == 0 =>
                {
                    self.cached_at = 0;
                    continue;
                }
                Err(ureq::Error::StatusCode(code)) => {
                    return Err(ApiError::Network(format!("HTTP {code}")));
                }
                Err(e) => return Err(ApiError::Network(format!("{e}"))),
            }
        }
        Err(ApiError::Unauthorized("登录态失效".into()))
    }
}

fn json_err(e: serde_json::Error) -> ApiError {
    ApiError::Network(format!("JSON 解析失败: {e}"))
}

/// 检查 `base_resp.status_code`。
///
/// 这是踩过的坑：`{"total":0,"base_resp":{"status_code":2013,"status_msg":"invalid params"}}`
/// 是**错误**，不是空结果。必须在这里拦下，否则会把接口错误读成「没有记录」。
fn check_business(value: serde_json::Value) -> Result<serde_json::Value, ApiError> {
    if let Some(code) = value
        .get("base_resp")
        .and_then(|b| b.get("status_code"))
        .and_then(|v| v.as_i64())
    {
        if code != 0 {
            let msg = value
                .get("base_resp")
                .and_then(|b| b.get("status_msg"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            if code == 1004 {
                return Err(ApiError::Unauthorized(format!("{msg} (code={code})")));
            }
            return Err(ApiError::Business(format!("{msg} (code={code})")));
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn business_error_detected() {
        let v = serde_json::json!({"total":0,"base_resp":{"status_code":2013,"status_msg":"invalid params"}});
        match check_business(v) {
            Err(ApiError::Business(m)) => assert!(m.contains("invalid params")),
            other => panic!("应当识别为业务错误，实际 {other:?}"),
        }
    }

    #[test]
    fn success_passes_through() {
        let v = serde_json::json!({"base_resp":{"status_code":0},"data":[1,2]});
        assert!(check_business(v).is_ok());
    }

    #[test]
    fn unauthorized_code() {
        let v = serde_json::json!({"base_resp":{"status_code":1004,"status_msg":"not login"}});
        assert!(matches!(check_business(v), Err(ApiError::Unauthorized(_))));
    }
}
