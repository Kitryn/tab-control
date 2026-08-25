use tab_control as bridge;
use serde_json::Value;

use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
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
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run() -> io::Result<()> {
    let socket_path = bridge::socket_path();
    remove_stale_socket(&socket_path)?;

    let listener = UnixListener::bind(&socket_path)?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))?;
    let _socket = SocketGuard(socket_path.clone());

    eprintln!("Tab Control bridge listening on {}", socket_path.display());

    let pending = Arc::new(Mutex::new(HashMap::new()));
    let output = Arc::new(Mutex::new(io::stdout()));
    let next_id = Arc::new(AtomicU64::new(1));
    let listener_pending = Arc::clone(&pending);
    let listener_output = Arc::clone(&output);
    let listener_next_id = Arc::clone(&next_id);

    thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    let pending = Arc::clone(&listener_pending);
                    let output = Arc::clone(&listener_output);
                    let next_id = Arc::clone(&listener_next_id);
                    thread::spawn(move || {
                        if let Err(error) = handle_client(stream, pending, output, next_id) {
                            eprintln!("Unix socket error: {error}");
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

    let stdin = io::stdin();
    let mut input = stdin.lock();
    while let Some(response) = read_native_message(&mut input)? {
        let Ok(mut response) = bridge::parse_json(&response) else {
            continue;
        };
        let Some(correlation) = bridge::json_id(&response).and_then(Value::as_u64) else {
            continue;
        };
        let Some(waiter) = pending.lock().unwrap().remove(&correlation) else {
            continue;
        };
        if !bridge::set_json_id(&mut response, waiter.original_id) {
            continue;
        }
        let _ = waiter.sender.send(bridge::to_json_vec(&response));
    }

    Ok(())
}

fn handle_client(
    mut stream: UnixStream,
    pending: Pending,
    output: Arc<Mutex<io::Stdout>>,
    next_id: Arc<AtomicU64>,
) -> io::Result<()> {
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

    if let Err(error) = write_rpc_response(&mut stream, &dispatch(&request, pending, output, next_id))
    {
        return Err(error);
    }
    Ok(())
}

fn dispatch(
    request: &[u8],
    pending: Pending,
    output: Arc<Mutex<io::Stdout>>,
    next_id: Arc<AtomicU64>,
) -> Vec<u8> {
    let Ok(mut request) = bridge::parse_json(request) else {
        return bridge::rpc_error(Value::Null, -32600, "Invalid request");
    };
    let Some(original_id) = bridge::json_id(&request).cloned() else {
        return bridge::rpc_error(Value::Null, -32600, "Invalid request");
    };
    let correlation = next_id.fetch_add(1, Ordering::Relaxed);
    if !bridge::set_json_id(&mut request, correlation) {
        return bridge::rpc_error(original_id, -32600, "Invalid request");
    }
    let forwarded = bridge::to_json_vec(&request);

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
        return bridge::rpc_error(original_id, -32000, "The browser is unavailable");
    }

    match receiver.recv_timeout(bridge::request_timeout()) {
        Ok(response) => response,
        Err(RecvTimeoutError::Timeout) => {
            pending.lock().unwrap().remove(&correlation);
            bridge::rpc_error(original_id, -32000, "The browser is unavailable")
        }
        Err(RecvTimeoutError::Disconnected) => {
            pending.lock().unwrap().remove(&correlation);
            bridge::rpc_error(original_id, -32000, "The browser is unavailable")
        }
    }
}

fn write_rpc_response(stream: &mut UnixStream, body: &[u8]) -> io::Result<()> {
    stream.write_all(body)?;
    stream.write_all(b"\n")
}

fn read_native_message(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0_u8; 4];
    if input.read(&mut header[..1])? == 0 {
        return Ok(None);
    }
    input.read_exact(&mut header[1..])?;

    let mut body = vec![0; u32::from_ne_bytes(header) as usize];
    input.read_exact(&mut body)?;
    Ok(Some(body))
}

fn write_native_message(output: &mut impl Write, body: &[u8]) -> io::Result<()> {
    let length = u32::try_from(body.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Native message is too large"))?;
    output.write_all(&length.to_ne_bytes())?;
    output.write_all(body)?;
    output.flush()
}

fn remove_stale_socket(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_socket() => fs::remove_file(path),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("Refusing to replace non-socket path {}", path.display()),
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
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
