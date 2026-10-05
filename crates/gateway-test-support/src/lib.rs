use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use bytes::{BufMut, BytesMut};
use minecraft_protocol::frame::RawPacket;
use minecraft_protocol::packets::disconnect::DisconnectPacket;
use minecraft_protocol::packets::handshake::{HandshakeNextState, HandshakePacket};
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::types::varint::VarInt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UnixListener};

/// Control Plane simulado em Node (crates/gateway/tests/fixtures/mock_grpc_server.js).
/// Linhas `PREFIXO:...` do stdout viram eventos; comandos entram por stdin.
pub struct MockControlPlane {
    child: Child,
    stdin: ChildStdin,
    pub port: u16,
    lines: std_mpsc::Receiver<String>,
}

impl MockControlPlane {
    pub fn start() -> Self {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let mut child = Command::new("node")
            .env(
                "NODE_PATH",
                format!("{}/../../services/control-plane/node_modules", manifest_dir),
            )
            .arg(format!(
                "{}/../gateway/tests/fixtures/mock_grpc_server.js",
                manifest_dir
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Falha ao iniciar o servidor gRPC simulado");

        let stdout = child.stdout.take().expect("stdout não capturável");
        let stdin = child.stdin.take().expect("stdin não acessível");
        let (tx, lines) = std_mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        let port = loop {
            let line = lines
                .recv_timeout(Duration::from_secs(10))
                .expect("Servidor simulado não reportou a porta");
            if let Some(port) = line.strip_prefix("READY_PORT:") {
                break port.trim().parse().unwrap();
            }
        };
        Self {
            child,
            stdin,
            port,
            lines,
        }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Próxima linha com o prefixo dado, sem ele.
    pub fn next_line(&self, prefix: &str) -> String {
        loop {
            let line = self
                .lines
                .recv_timeout(Duration::from_secs(10))
                .unwrap_or_else(|_| panic!("Linha {prefix} não chegou do Control Plane simulado"));
            if let Some(rest) = line.strip_prefix(prefix) {
                return rest.to_string();
            }
        }
    }

    pub fn send_line(&mut self, line: &str) {
        writeln!(self.stdin, "{line}").expect("stdin do Control Plane simulado");
        self.stdin.flush().unwrap();
    }
}

impl Drop for MockControlPlane {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// `tailscaled` falso: responde ao WhoIs da LocalAPI com a identidade dada, para qualquer IP.
pub struct FakeTailscaled {
    pub socket_path: PathBuf,
}

impl FakeTailscaled {
    pub fn start(user_id: &str, display_name: &str, tags: &[&str]) -> Self {
        let socket_path = PathBuf::from(format!(
            "/tmp/test-gw-fake-tailscaled-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path).unwrap();

        let tags_json = tags
            .iter()
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(",");
        let payload = format!(
            r#"{{"Node":{{"ID":100,"StableID":"node-100","Name":"client","User":1,"Addresses":["127.0.0.1"],"Tags":[{tags_json}]}},"UserProfile":{{"ID":{user_id},"LoginName":"{display_name}","DisplayName":"{display_name}"}}}}"#
        );

        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let payload = payload.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    let _ = stream.read(&mut buf).await;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        payload.len(),
                        payload
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                });
            }
        });

        Self { socket_path }
    }
}

impl Drop for FakeTailscaled {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Caminho de socket em que ninguém escuta: o `tailscaled` está fora do ar.
pub fn dead_socket_path() -> PathBuf {
    PathBuf::from("/tmp/test-gw-no-tailscaled-here.sock")
}

#[derive(Debug, PartialEq, Eq)]
pub enum LoginOutcome {
    Disconnected(String),
    Proxied,
}

fn encode_packet(packet_id: VarInt, payload: &[u8]) -> BytesMut {
    let total_len = packet_id.encoded_len() + payload.len();
    let mut buf = BytesMut::new();
    VarInt(total_len as i32).encode(&mut buf);
    packet_id.encode(&mut buf);
    buf.put_slice(payload);
    buf
}

/// Escuta um upstream que só aceita conexões e as mantém abertas; avisa cada accept pelo canal.
pub async fn hold_upstream() -> (
    std::net::SocketAddr,
    tokio::sync::mpsc::UnboundedReceiver<()>,
) {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = upstream.local_addr().unwrap();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((stream, _)) = upstream.accept().await {
            let _ = tx.send(());
            held.push(stream);
        }
    });
    (addr, rx)
}

pub async fn open_login(gateway_addr: std::net::SocketAddr, host: &str, nick: &str) -> TcpStream {
    let mut client = TcpStream::connect(gateway_addr).await.unwrap();
    let handshake = HandshakePacket {
        protocol_version: VarInt(765),
        server_address: host.into(),
        server_port: gateway_addr.port(),
        next_state: HandshakeNextState::Login,
    };
    let mut payload = BytesMut::new();
    handshake.encode(&mut payload);
    client
        .write_all(&encode_packet(VarInt(0x00), &payload))
        .await
        .unwrap();

    let mut login = BytesMut::new();
    LoginStartPacket::new(nick).unwrap().encode(&mut login);
    client
        .write_all(&encode_packet(VarInt(0x00), &login))
        .await
        .unwrap();
    client
}

/// Faz o login e diz se o Gateway recusou (com o motivo) ou levou a conexão até o upstream.
pub async fn login_outcome(
    gateway_addr: std::net::SocketAddr,
    host: &str,
    nick: &str,
    upstream_accepts: &mut tokio::sync::mpsc::UnboundedReceiver<()>,
) -> LoginOutcome {
    let mut client = open_login(gateway_addr, host, nick).await;
    let mut buf = [0u8; 1024];
    tokio::select! {
        _ = upstream_accepts.recv() => LoginOutcome::Proxied,
        read = client.read(&mut buf) => {
            let n = read.unwrap();
            let mut cursor = &buf[..n];
            let raw = RawPacket::decode_prelogin(&mut cursor).expect("pacote de Disconnect");
            let mut payload = &raw.payload[..];
            LoginOutcome::Disconnected(DisconnectPacket::decode(&mut payload).unwrap().reason_json)
        }
        _ = tokio::time::sleep(Duration::from_secs(5)) => panic!("o Gateway não respondeu ao login"),
    }
}
