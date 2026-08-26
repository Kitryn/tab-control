use std::env;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub instance_id: String,
    pub browser: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ResolveError {
    None,
    Ambiguous,
}

pub fn socket_dir() -> PathBuf {
    if let Some(path) = env::var_os("TAB_CONTROL_SOCKET_DIR") {
        return PathBuf::from(path);
    }

    let uid = user_id();
    let runtime = PathBuf::from(format!("/run/user/{uid}"));
    if fs::metadata(&runtime).is_ok_and(|metadata| metadata.is_dir() && metadata.uid() == uid) {
        runtime.join("tab-control")
    } else {
        PathBuf::from(format!("/tmp/tab-control-{uid}"))
    }
}

pub fn instance_socket_path(instance_id: &str) -> PathBuf {
    socket_dir().join(format!("{instance_id}.sock"))
}

pub fn discovery_name(browser: &str, instance_id: &str) -> String {
    let prefix: String = instance_id.chars().take(6).collect();
    format!("{browser} {prefix}")
}

pub fn parse_identity(value: &Value) -> Option<Identity> {
    let instance_id = value.get("instanceId")?.as_str()?;
    let browser = value.get("browser")?.as_str()?;
    if browser.is_empty()
        || Path::new(instance_id).file_name().and_then(|name| name.to_str()) != Some(instance_id)
    {
        return None;
    }
    Some(Identity {
        instance_id: instance_id.to_string(),
        browser: browser.to_string(),
    })
}

pub fn resolve_instance_id(prefix: &str, ids: &[String]) -> Result<String, ResolveError> {
    if prefix.is_empty() {
        return Err(ResolveError::None);
    }
    let mut found = None;
    for id in ids {
        if id.starts_with(prefix) {
            if found.is_some() {
                return Err(ResolveError::Ambiguous);
            }
            found = Some(id.clone());
        }
    }
    found.ok_or(ResolveError::None)
}

pub fn params_empty(request: &Value) -> bool {
    match request.get("params") {
        None => true,
        Some(Value::Object(object)) => object.is_empty(),
        Some(_) => false,
    }
}

pub fn request_timeout() -> Duration {
    let Ok(value) = env::var("TAB_CONTROL_TIMEOUT_MS") else {
        return DEFAULT_TIMEOUT;
    };
    let Ok(milliseconds) = value.parse::<u64>() else {
        return DEFAULT_TIMEOUT;
    };
    Duration::from_millis(milliseconds)
}

pub fn set_json_id(value: &mut Value, id: impl Into<Value>) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    object.insert("id".to_string(), id.into());
    true
}

pub fn user_id() -> u32 {
    unsafe { getuid() }
}

unsafe extern "C" {
    fn getuid() -> u32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_unique_prefix() {
        let ids = [
            "945f84ab-1234-4000-8000-000000000001".to_string(),
            "a1b2c3de-5678-4000-8000-000000000002".to_string(),
        ];
        assert_eq!(
            resolve_instance_id("945f84", &ids).unwrap(),
            ids[0]
        );
        assert_eq!(resolve_instance_id(&ids[1], &ids).unwrap(), ids[1]);
    }

    #[test]
    fn resolve_ambiguous_or_missing() {
        let ids = [
            "91aaaaaa-1234-4000-8000-000000000001".to_string(),
            "91bbbbbb-1234-4000-8000-000000000002".to_string(),
        ];
        assert_eq!(resolve_instance_id("91", &ids), Err(ResolveError::Ambiguous));
        assert_eq!(resolve_instance_id("zz", &ids), Err(ResolveError::None));
        assert_eq!(resolve_instance_id("", &ids), Err(ResolveError::None));
    }
}
