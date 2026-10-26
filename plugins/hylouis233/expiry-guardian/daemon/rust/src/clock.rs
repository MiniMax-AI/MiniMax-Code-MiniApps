//! 时钟与信号处理。
//!
//! # 为什么没有 HTTP 客户端了
//!
//! 社区插件不能读取 MiniMax Code 的登录凭据（2026-10-20 管理员 review 要求），
//! 所以本插件**不再**自己调账号接口。
//! ⇒ 额度/积分/重置卡的信息改由**本地账本**提供（见 `ledger.rs`）。
//! ⇒ 这个模块只剩下「现在几点」与「该不该退出」两件事。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::raw::c_int;
#[cfg(unix)]
unsafe extern "C" {
    fn signal(signum: c_int, handler: usize) -> usize;
}
const SIGINT: c_int = 2;
const SIGTERM: c_int = 15;

/// 收到终止信号后置位（守护进程在下一轮开头检查它）。
pub static STOPPED: AtomicBool = AtomicBool::new(false);

/// 现在是 Unix 毫秒时间戳。
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 是否已经收到终止信号。
pub fn should_stop() -> bool {
    STOPPED.load(Ordering::SeqCst)
}

/// 置位「该退出了」。
pub fn request_stop() {
    STOPPED.store(true, Ordering::SeqCst);
}

/// 装上 SIGINT / SIGTERM 处理器。
///
/// `launchctl` 停守护进程时发的是这两个信号 ⇒ 收到就置位，
/// 让主循环在当前这轮结束后**干净退出**（而不是被硬杀）。
///
/// ⚠️ 连着收两次（比如 SIGINT 之后又 SIGTERM）⇒ 直接退出，
/// 免得「置位了但这一轮还在读文件」时卡住。
pub fn install_signal_handlers() {
    unsafe extern "C" fn handler(_sig: i32) {
        if should_stop() {
            std::process::exit(130);
        }
        request_stop();
    }
    unsafe {
        signal(SIGINT, handler as usize);
        signal(SIGTERM, handler as usize);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_ms_is_a_plausible_timestamp() {
        let n = now_ms();
        // 2020-01-01 之后、2100 年之前。
        assert!(n > 1_577_836_800_000, "时间戳不对：{n}");
        assert!(n < 4_102_444_800_000, "时间戳不对：{n}");
    }
}
