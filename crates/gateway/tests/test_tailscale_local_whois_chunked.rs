use gateway::identity::{TailscaleLocalWhoIs, WhoIsIdentity};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixListener;

/// Resposta real do tailscaled 1.102.x ao WhoIs (sanitizada): JSON indentado com tabs.
const WHOIS_BODY: &str = include_str!("fixtures/tailscaled_whois_response.json");

/// Cabeçalhos como o tailscaled os envia: sem `Content-Length`, com `Transfer-Encoding: chunked`.
const CHUNKED_HEAD: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTailscale-Version: 1.102.4\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n";

fn chunk(data: &[u8], extension: &str) -> Vec<u8> {
    let mut out = format!("{:x}{extension}\r\n", data.len()).into_bytes();
    out.extend_from_slice(data);
    out.extend_from_slice(b"\r\n");
    out
}

/// Sobe um tailscaled falso que escreve cada fatia de `pieces` em um `write` separado.
async fn serve_pieces(pieces: Vec<Vec<u8>>) -> (PathBuf, tokio::task::JoinHandle<()>) {
    let socket_path = PathBuf::from(format!(
        "/tmp/test-gw-chunked-tailscaled-{}-{}.sock",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path).expect("Falha ao criar UnixListener");

    let task = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let pieces = pieces.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf).await;
                for piece in pieces {
                    let _ = stream.write_all(&piece).await;
                    let _ = stream.flush().await;
                    tokio::time::sleep(Duration::from_millis(2)).await;
                }
            });
        }
    });
    (socket_path, task)
}

fn expected_identity(client_ip: &str) -> WhoIsIdentity {
    WhoIsIdentity {
        user_id: "2200000000000002".into(),
        login_name: "alex@example.com".into(),
        display_name: "Alex Example".into(),
        node_id: "nExAmPlE1CNTRL".into(),
        tags: vec![],
        client_ip: client_ip.into(),
    }
}

/// O tailscaled real responde em chunks: o corpo bruto começa com o tamanho do chunk em hex e
/// não é JSON. Sem decodificar o chunked o WhoIs local sempre falha (anti-impersonation inativo).
#[tokio::test]
async fn test_whois_decodes_multi_chunk_response_like_real_tailscaled() {
    let body = WHOIS_BODY.as_bytes();
    let (first, rest) = body.split_at(body.len() / 2);
    let (second, third) = rest.split_at(rest.len() / 2);

    let mut pieces = vec![CHUNKED_HEAD.as_bytes().to_vec()];
    pieces.push(chunk(first, ""));
    pieces.push(chunk(second, ""));
    pieces.push(chunk(third, ""));
    pieces.push(b"0\r\n\r\n".to_vec());
    let (socket_path, server) = serve_pieces(pieces).await;

    let driver = TailscaleLocalWhoIs::new(&socket_path);
    let identity = driver
        .query_whois("100.64.0.77")
        .await
        .expect("WhoIs chunked deve ser decodificado")
        .expect("Identidade deve ser encontrada");

    assert_eq!(identity, expected_identity("100.64.0.77"));

    server.abort();
    let _ = std::fs::remove_file(&socket_path);
}

/// Bordas do protocolo: chunk cortado no meio de um valor, extensão de chunk, trailer após o chunk final e chunk dividido entre vários `write` do socket.
#[tokio::test]
async fn test_whois_decodes_chunk_split_mid_field_with_extension_and_trailer() {
    let body = WHOIS_BODY.as_bytes();
    let marker = b"alex@example.com";
    let login_at = body
        .windows(marker.len())
        .position(|w| w == marker)
        .expect("fixture deve conter o login");
    let cut = login_at + 6;
    let (first, second) = body.split_at(cut);

    let second_chunk = chunk(second, "");

    let (head_of_second, tail_of_second) = second_chunk.split_at(second_chunk.len() / 3);
    let pieces = vec![
        CHUNKED_HEAD.as_bytes().to_vec(),
        chunk(first, ";signature=abc"),
        head_of_second.to_vec(),
        tail_of_second.to_vec(),
        b"0\r\nX-Trailer: ok\r\n\r\n".to_vec(),
    ];
    let (socket_path, server) = serve_pieces(pieces).await;

    let driver = TailscaleLocalWhoIs::new(&socket_path);
    let identity = driver
        .query_whois("100.64.0.77")
        .await
        .expect("WhoIs chunked deve ser decodificado")
        .expect("Identidade deve ser encontrada");

    assert_eq!(identity, expected_identity("100.64.0.77"));

    server.abort();
    let _ = std::fs::remove_file(&socket_path);
}

/// Sem `Content-Length` nem `chunked`, o corpo vai até o EOF (`Connection: close`).
#[tokio::test]
async fn test_whois_reads_body_until_eof_without_length() {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n";
    let pieces = vec![head.as_bytes().to_vec(), WHOIS_BODY.as_bytes().to_vec()];
    let (socket_path, server) = serve_pieces(pieces).await;

    let driver = TailscaleLocalWhoIs::new(&socket_path);
    let identity = driver
        .query_whois("100.64.0.77")
        .await
        .expect("Corpo até EOF deve ser aceito")
        .expect("Identidade deve ser encontrada");

    assert_eq!(identity, expected_identity("100.64.0.77"));

    server.abort();
    let _ = std::fs::remove_file(&socket_path);
}

/// Corpo chunked truncado (daemon caiu no meio da resposta) é erro, não identidade parcial.
#[tokio::test]
async fn test_whois_rejects_truncated_chunked_body() {
    let body = WHOIS_BODY.as_bytes();
    let mut truncated = format!("{:x}\r\n", body.len()).into_bytes();
    truncated.extend_from_slice(&body[..body.len() / 2]);
    let pieces = vec![CHUNKED_HEAD.as_bytes().to_vec(), truncated];
    let (socket_path, server) = serve_pieces(pieces).await;

    let driver = TailscaleLocalWhoIs::new(&socket_path);
    let result = driver.query_whois("100.64.0.77").await;

    let err = result.expect_err("Chunk truncado deve falhar");
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);

    server.abort();
    let _ = std::fs::remove_file(&socket_path);
}
