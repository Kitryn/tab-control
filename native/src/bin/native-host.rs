use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tab_control as bridge;

use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;

struct Waiter {
    original_id: Value,
    sender: SyncSender<Vec<u8>>,
}

type Pending = Arc<Mutex<HashMap<u64, Waiter>>>;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let output = Arc::new(Mutex::new(io::stdout()));
    let next_id = Arc::new(AtomicU64::new(1));

    let stdin = io::stdin();
    let mut input = stdin.lock();
    let Some(message) = read_native_message(&mut input)? else {
        bail!("Tab Control identity is missing");
    };
    let value: Value =
        serde_json::from_slice(&message).context("Tab Control identity is invalid")?;
    let Some(identity) = bridge::parse_identity(&value) else {
        bail!("Tab Control identity is invalid");
    };

    let socket_path = bridge::instance_socket_path(&identity.instance_id);
    let listener = bind_instance_socket(&socket_path)?;
    let _socket = SocketGuard(socket_path.clone());
    spawn_listener(
        listener,
        Arc::clone(&pending),
        Arc::clone(&output),
        Arc::clone(&next_id),
        Arc::new(identity),
    );
    eprintln!("Tab Control bridge listening on {}", socket_path.display());

    while let Some(message) = read_native_message(&mut input)? {
        let Ok(mut response) = serde_json::from_slice::<Value>(&message) else {
            continue;
        };
        let Some(correlation) = response.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let Some(waiter) = pending.lock().unwrap().remove(&correlation) else {
            continue;
        };
        if !bridge::set_json_id(&mut response, waiter.original_id) {
            continue;
        }
        let _ = waiter.sender.send(response.to_string().into_bytes());
    }

    Ok(())
}

fn spawn_listener(
    listener: UnixListener,
    pending: Pending,
    output: Arc<Mutex<io::Stdout>>,
    next_id: Arc<AtomicU64>,
    identity: Arc<bridge::Identity>,
) {
    thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    let pending = Arc::clone(&pending);
                    let output = Arc::clone(&output);
                    let next_id = Arc::clone(&next_id);
                    let identity = Arc::clone(&identity);
                    thread::spawn(move || {
                        if let Err(error) =
                            handle_client(stream, pending, output, next_id, identity)
                        {
                            eprintln!("Unix socket error: {error:#}");
                        }
                    });
                }
                Err(error) => {
                    eprintln!("Unix socket accept error: {error}");
                    break;
                }
            }
        }
    });
}

fn handle_client(
    mut stream: UnixStream,
    pending: Pending,
    output: Arc<Mutex<io::Stdout>>,
    next_id: Arc<AtomicU64>,
    identity: Arc<bridge::Identity>,
) -> Result<()> {
    let mut request = Vec::new();
    BufReader::new(stream.try_clone()?).read_until(b'\n', &mut request)?;
    if request.is_empty() {
        return Ok(());
    }
    if request.last() == Some(&b'\n') {
        request.pop();
    }
    if request.last() == Some(&b'\r') {
        request.pop();
    }

    write_rpc_response(
        &mut stream,
        &dispatch(&request, pending, output, next_id, identity),
    )
}

fn dispatch(
    request: &[u8],
    pending: Pending,
    output: Arc<Mutex<io::Stdout>>,
    next_id: Arc<AtomicU64>,
    identity: Arc<bridge::Identity>,
) -> Vec<u8> {
    let Ok(mut request) = serde_json::from_slice::<Value>(request) else {
        return rpc_error(Value::Null, -32600, "Invalid request");
    };
    let Some(original_id) = request.get("id").cloned() else {
        return rpc_error(Value::Null, -32600, "Invalid request");
    };

    if request.get("method").and_then(Value::as_str) == Some("describe") {
        if !bridge::params_empty(&request) {
            return rpc_error(original_id, -32602, "Invalid parameters");
        }
        return json!({
            "jsonrpc": "2.0",
            "id": original_id,
            "result": {
                "instanceId": identity.instance_id,
                "browser": identity.browser,
                "name": identity.name
            }
        })
        .to_string()
        .into_bytes();
    }

    let correlation = next_id.fetch_add(1, Ordering::Relaxed);
    if !bridge::set_json_id(&mut request, correlation) {
        return rpc_error(original_id, -32600, "Invalid request");
    }
    let forwarded = request.to_string().into_bytes();

    let (sender, receiver) = mpsc::sync_channel(1);
    pending.lock().unwrap().insert(
        correlation,
        Waiter {
            original_id: original_id.clone(),
            sender,
        },
    );

    if write_native_message(&mut *output.lock().unwrap(), &forwarded).is_err() {
        pending.lock().unwrap().remove(&correlation);
        return rpc_error(original_id, -32000, "The browser is unavailable");
    }

    match receiver.recv_timeout(bridge::request_timeout()) {
        Ok(response) => response,
        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
            pending.lock().unwrap().remove(&correlation);
            rpc_error(original_id, -32000, "The browser is unavailable")
        }
    }
}

fn rpc_error(id: impl Into<Value>, code: i64, message: &str) -> Vec<u8> {
    json!({
        "jsonrpc": "2.0",
        "id": id.into(),
        "error": { "code": code, "message": message }
    })
    .to_string()
    .into_bytes()
}

fn write_rpc_response(stream: &mut UnixStream, body: &[u8]) -> Result<()> {
    stream.write_all(body)?;
    stream.write_all(b"\n")?;
    Ok(())
}

fn read_native_message(input: &mut impl Read) -> Result<Option<Vec<u8>>> {
    let mut header = [0_u8; 4];
    if input.read(&mut header[..1])? == 0 {
        return Ok(None);
    }
    input.read_exact(&mut header[1..])?;

    let mut body = vec![0; u32::from_ne_bytes(header) as usize];
    input.read_exact(&mut body)?;
    Ok(Some(body))
}

fn write_native_message(output: &mut impl Write, body: &[u8]) -> Result<()> {
    let length = u32::try_from(body.len()).context("Native message is too large")?;
    output.write_all(&length.to_ne_bytes())?;
    output.write_all(body)?;
    output.flush()?;
    Ok(())
}

fn bind_instance_socket(path: &Path) -> Result<UnixListener> {
    if let Some(parent) = path.parent() {
        match fs::create_dir(parent) {
            Ok(()) => fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let metadata = fs::metadata(parent)?;
                if !metadata.is_dir() || metadata.uid() != bridge::user_id() {
                    bail!(
                        "Tab Control socket directory {} is not usable",
                        parent.display()
                    );
                }
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
            }
            Err(error) => return Err(error.into()),
        }
    }

    if path.exists() {
        match UnixStream::connect(path) {
            Ok(_) => bail!("Tab Control socket {} is already in use", path.display()),
            Err(_) => remove_stale_socket(path)?,
        }
    }

    let listener = UnixListener::bind(path)
        .with_context(|| format!("Tab Control socket {} error", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

fn remove_stale_socket(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_socket() => {
            fs::remove_file(path)?;
            Ok(())
        }
        Ok(_) => bail!("Refusing to replace non-socket path {}", path.display()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

struct SocketGuard(PathBuf);

impl Drop for SocketGuard {
    fn drop(&mut self) {
        if fs::symlink_metadata(&self.0).is_ok_and(|metadata| metadata.file_type().is_socket()) {
            let _ = fs::remove_file(&self.0);
        }
    }
}
