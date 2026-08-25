use tab_control as bridge;

use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::process;
use std::time::Duration;

fn main() {
    if let Err(error) = run() {
        fail(&error.to_string(), 1);
    }
}

fn run() -> io::Result<()> {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() != Some("rpc") || arguments.next().is_some() {
        fail("Usage: tabctl rpc", 2);
    }

    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let input = input.trim();
    if input.is_empty() {
        fail("JSON input parse error: standard input is empty", 2);
    }
    if input.contains('\n') || input.contains('\r') {
        fail("JSON input parse error: request must be a single line", 2);
    }
    if let Err(error) = bridge::parse_json(input.as_bytes()) {
        fail(&format!("JSON input parse error: {error}"), 2);
    }

    let path = bridge::socket_path();
    let mut stream = UnixStream::connect(&path).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!("Tab Control socket {} error: {error}", path.display()),
        )
    })?;
    let timeout = bridge::request_timeout();
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(input.as_bytes())?;
    stream.write_all(b"\n")?;

    let mut response = Vec::new();
    read_line(&mut stream, &mut response, timeout)?;
    if response.last() == Some(&b'\n') {
        response.pop();
    }
    if response.last() == Some(&b'\r') {
        response.pop();
    }
    if response.is_empty() {
        fail("The Tab Control bridge response is missing", 1);
    }

    io::stdout().write_all(&response)?;
    io::stdout().write_all(b"\n")?;
    Ok(())
}

fn read_line(stream: &mut UnixStream, buffer: &mut Vec<u8>, timeout: Duration) -> io::Result<()> {
    let mut byte = [0_u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) => {
                if buffer.is_empty() {
                    fail("The Tab Control bridge response is missing", 1);
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
                return Err(io::Error::new(
                    error.kind(),
                    format!(
                        "Tab Control socket {} error: timed out after {}ms",
                        bridge::socket_path().display(),
                        timeout.as_millis()
                    ),
                ));
            }
            Err(error) => return Err(error),
        }
    }
}

fn fail(message: &str, code: i32) -> ! {
    let _ = writeln!(io::stderr(), "{message}");
    process::exit(code);
}
