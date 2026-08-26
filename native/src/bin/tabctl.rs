use tab_control as bridge;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::FileTypeExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process;
use std::time::Duration;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut arguments = std::env::args().skip(1);
    match arguments.next().as_deref() {
        Some("instances") if arguments.next().is_none() => {
            writeln!(io::stdout(), "{}", instance_list(&live_instances()))?;
            Ok(())
        }
        Some("rpc") => {
            let instance = match arguments.next().as_deref() {
                None => None,
                Some("--instance") => {
                    let Some(id) = arguments.next() else {
                        eprintln!("Usage: tabctl instances | tabctl rpc [--instance <id>]");
                        process::exit(2);
                    };
                    if arguments.next().is_some() {
                        eprintln!("Usage: tabctl instances | tabctl rpc [--instance <id>]");
                        process::exit(2);
                    }
                    Some(id)
                }
                _ => {
                    eprintln!("Usage: tabctl instances | tabctl rpc [--instance <id>]");
                    process::exit(2);
                }
            };
            rpc(instance)
        }
        _ => {
            eprintln!("Usage: tabctl instances | tabctl rpc [--instance <id>]");
            process::exit(2);
        }
    }
}

fn rpc(instance: Option<String>) -> Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let input = input.trim();
    if input.is_empty() {
        eprintln!("JSON input parse error: standard input is empty");
        process::exit(2);
    }
    if input.contains('\n') || input.contains('\r') {
        eprintln!("JSON input parse error: request must be a single line");
        process::exit(2);
    }
    if let Err(error) = serde_json::from_slice::<Value>(input.as_bytes()) {
        eprintln!("JSON input parse error: {error}");
        process::exit(2);
    }

    let instances = live_instances();
    let path = match instance.as_deref() {
        Some(prefix) => {
            let ids: Vec<String> = instances
                .iter()
                .map(|entry| entry.0.instance_id.clone())
                .collect();
            match bridge::resolve_instance_id(prefix, &ids) {
                Ok(id) => instances
                    .into_iter()
                    .find(|(identity, _)| identity.instance_id == id)
                    .map(|(_, path)| path)
                    .context("Tab Control instance is not live")?,
                Err(bridge::ResolveError::None) => {
                    bail!("Tab Control instance {prefix} is not live")
                }
                Err(bridge::ResolveError::Ambiguous) => {
                    bail!("Tab Control instance {prefix} is ambiguous")
                }
            }
        }
        None if instances.is_empty() => bail!("No Tab Control instance is live"),
        None if instances.len() == 1 => instances.into_iter().next().unwrap().1,
        None => {
            writeln!(io::stderr(), "{}", instance_list(&instances))?;
            bail!("Pass --instance; more than one Tab Control instance is live")
        }
    };

    let timeout = bridge::request_timeout();
    let mut stream = UnixStream::connect(&path)
        .with_context(|| format!("Tab Control socket {} error", path.display()))?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(input.as_bytes())?;
    stream.write_all(b"\n")?;

    let mut response = Vec::new();
    read_line(&mut stream, &mut response, timeout, &path)?;
    if response.last() == Some(&b'\n') {
        response.pop();
    }
    if response.last() == Some(&b'\r') {
        response.pop();
    }
    if response.is_empty() {
        bail!("The Tab Control bridge response is missing");
    }

    io::stdout().write_all(&response)?;
    io::stdout().write_all(b"\n")?;
    Ok(())
}

fn live_instances() -> Vec<(bridge::Identity, PathBuf)> {
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(bridge::socket_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|extension| extension == "sock")
                && fs::symlink_metadata(&path)
                    .is_ok_and(|metadata| metadata.file_type().is_socket())
            {
                paths.push(path);
            }
        }
    }

    let mut instances = Vec::new();
    for path in paths {
        match UnixStream::connect(&path) {
            Ok(mut stream) => {
                if let Ok(identity) = describe(&path, &mut stream) {
                    instances.push((identity, path));
                }
            }
            Err(_) => {
                if fs::symlink_metadata(&path)
                    .is_ok_and(|metadata| metadata.file_type().is_socket())
                {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
    instances.sort_by(|left, right| left.0.instance_id.cmp(&right.0.instance_id));
    instances
}

fn describe(path: &Path, stream: &mut UnixStream) -> Result<bridge::Identity> {
    let timeout = Duration::from_millis(250);
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(br#"{"jsonrpc":"2.0","id":1,"method":"describe","params":{}}"#)?;
    stream.write_all(b"\n")?;
    let mut response = Vec::new();
    read_line(stream, &mut response, timeout, path)?;
    if response.last() == Some(&b'\n') {
        response.pop();
    }
    if response.last() == Some(&b'\r') {
        response.pop();
    }
    let value: Value = serde_json::from_slice(&response)?;
    bridge::parse_identity(value.get("result").unwrap_or(&Value::Null))
        .context("Invalid describe result")
}

fn instance_list(instances: &[(bridge::Identity, PathBuf)]) -> Value {
    Value::Array(
        instances
            .iter()
            .map(|(identity, _)| {
                json!({
                    "id": identity.instance_id,
                    "name": bridge::discovery_name(&identity.browser, &identity.instance_id)
                })
            })
            .collect(),
    )
}

fn read_line(
    stream: &mut UnixStream,
    buffer: &mut Vec<u8>,
    timeout: Duration,
    path: &Path,
) -> Result<()> {
    let mut byte = [0_u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) => {
                if buffer.is_empty() {
                    bail!("The Tab Control bridge response is missing");
                }
                return Ok(());
            }
            Ok(_) => {
                buffer.push(byte[0]);
                if byte[0] == b'\n' {
                    return Ok(());
                }
            }
            Err(error)
                if error.kind() == io::ErrorKind::TimedOut
                    || error.kind() == io::ErrorKind::WouldBlock =>
            {
                bail!(
                    "Tab Control socket {} error: timed out after {}ms",
                    path.display(),
                    timeout.as_millis()
                );
            }
            Err(error) => return Err(error.into()),
        }
    }
}
