//! 去重记录的持久化。
//!
//! 落盘而非只放内存：后台进程会被 launchd 重启，只靠内存的话
//! 重启后会把同一张卡再扣一遍。先写盘再请求，崩溃也不重复。

use std::collections::BTreeSet;
use std::path::PathBuf;

fn state_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join(".config/mcode-reset-card");
    Some(dir)
}

fn state_file() -> Option<PathBuf> {
    Some(state_dir()?.join("bg-state.json"))
}

fn read_set() -> BTreeSet<String> {
    let Some(path) = state_file() else {
        return BTreeSet::new();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return BTreeSet::new();
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("spent").cloned())
        .and_then(|s| serde_json::from_value::<Vec<String>>(s).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}

fn write_set(set: &BTreeSet<String>) {
    let Some(dir) = state_dir() else { return };
    let Some(path) = state_file() else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let json = serde_json::json!({
        "spent": set.iter().collect::<Vec<_>>(),
        "updatedAtMs": crate::api::now_ms(),
    });
    // 原子替换：先写临时文件再 rename，避免半截文件
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_string_pretty(&json).unwrap_or_default()).is_err() {
        return;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

pub fn was_spent(fingerprint: &str) -> bool {
    read_set().contains(fingerprint)
}

pub fn mark_spent(fingerprint: &str, card_id: &str, source_type: &str) {
    let mut set = read_set();
    if set.insert(fingerprint.to_string()) {
        write_set(&set);
    }
    crate::log(&format!("已记账：{card_id} ({source_type})"));
}

pub fn clear_spent() {
    if let Some(path) = state_file() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_roundtrip() {
        let mut s = BTreeSet::new();
        s.insert("a:1".to_string());
        s.insert("b:2".to_string());
        assert!(s.contains("a:1"));
        assert!(!s.contains("c:3"));
    }
}
