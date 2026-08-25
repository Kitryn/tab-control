use std::env;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

pub fn socket_path() -> PathBuf {
    if let Some(path) = env::var_os("TAB_CONTROL_SOCKET") {
        return PathBuf::from(path);
    }

    let uid = user_id();
    let runtime = PathBuf::from(format!("/run/user/{uid}"));
    if usable_runtime_dir(&runtime, uid) {
        runtime.join("tab-control.sock")
    } else {
        PathBuf::from(format!("/tmp/tab-control-{uid}.sock"))
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

pub fn parse_json(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    serde_json::from_slice(bytes)
}

pub fn json_id(value: &Value) -> Option<&Value> {
    value.get("id")
}

pub fn set_json_id(value: &mut Value, id: impl Into<Value>) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    object.insert("id".to_string(), id.into());
    true
}

pub fn to_json_vec(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).expect("Value always serializes")
}

pub fn rpc_error(id: Value, code: i32, message: &str) -> Vec<u8> {
    to_json_vec(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    }))
}

fn usable_runtime_dir(path: &Path, uid: u32) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_dir() && metadata.uid() == uid)
}

fn user_id() -> u32 {
    unsafe { getuid() }
}

unsafe extern "C" {
    fn getuid() -> u32;
}
