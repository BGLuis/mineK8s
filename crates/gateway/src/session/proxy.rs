use std::net::{IpAddr, SocketAddr};
use bytes::BytesMut;
use tokio::io::{copy, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tracing::{debug, info};

use minecraft_protocol::packets::handshake::HandshakePacket;
use minecraft_protocol::packets::login::LoginStartPacket;
use minecraft_protocol::proxy_protocol::header::ProxyHeader;

use crate::connection::ClientConnection;
use crate::error::{GatewayError, Result};
use crate::routing::CachedServerRoute;
use crate::session::manager::SessionManager;

/// Conecta à JVM interna, reinjeta Handshake e Login Start, e opcionalmente insere cabeçalho PROXY v2 (RF-GW-11).
pub async fn establish_and_replay_upstream(
    target_addr: SocketAddr,
    client_ip: IpAddr,
    client_port: u16,
    inject_proxy_v2: bool,
    original_handshake: &[u8],
    original_login_start: &[u8],
) -> Result<TcpStream> {
    let mut upstream = TcpStream::connect(target_addr).await?;

    // Injeção opcional do cabeçalho binário PROXY Protocol v2 (GW:384-398)
    if inject_proxy_v2 {
        let mut proxy_wire = BytesMut::new();
        match client_ip {
            IpAddr::V4(v4) => {
                let dst_v4 = match target_addr.ip() {
                    IpAddr::V4(d) => d,
                    IpAddr::V6(_) => "127.0.0.1".parse().unwrap(),
                };
                let header = ProxyHeader::new_ipv4_proxy(v4, client_port, dst_v4, target_addr.port());
                header.encode(&mut proxy_wire);
            }
            IpAddr::V6(v6) => {
                let dst_v6 = match target_addr.ip() {
                    IpAddr::V6(d) => d,
                    IpAddr::V4(_) => "::1".parse().unwrap(),
                };
                let header = ProxyHeader::new_ipv6_proxy(v6, client_port, dst_v6, target_addr.port());
                header.encode(&mut proxy_wire);
            }
        }
        upstream.write_all(&proxy_wire).await?;
    }

    // Reinjetar pacote de Handshake original gravado
    upstream.write_all(original_handshake).await?;

    // Reinjetar pacote de Login Start original gravado
    upstream.write_all(original_login_start).await?;

    Ok(upstream)
}

/// Executa o encaminhamento transparente bidirecional entre o cliente e o upstream JVM.
/// Garante destruição mútua imediata (Regra de Ouro, GW:160) e suporte a interrupção assíncrona.
pub async fn run_duplex_proxy(
    mut client_stream: TcpStream,
    mut upstream_stream: TcpStream,
    mut abort_rx: oneshot::Receiver<()>,
) -> std::io::Result<()> {
    let (mut client_read, mut client_write) = client_stream.split();
    let (mut upstream_read, mut upstream_write) = upstream_stream.split();

    let client_to_upstream = copy(&mut client_read, &mut upstream_write);
    let upstream_to_client = copy(&mut upstream_read, &mut client_write);

    // Regra de Ouro (GW:160 / Critério de Aceite da Issue #53):
    // Se QUALQUER um dos lados fechar (EOF) ou falhar, o select! encerra imediatamente,
    // destruindo e fechando forçosamente ambos os sockets sem permitir estados meio-abertos.
    tokio::select! {
        _ = client_to_upstream => {
            debug!("Direção Cliente -> Upstream encerrada (EOF do cliente)");
        }
        _ = upstream_to_client => {
            debug!("Direção Upstream -> Cliente encerrada (EOF do upstream)");
        }
        _ = &mut abort_rx => {
            debug!("Canal abort disparado: encerrando sockets do proxy imediatamente");
        }
    }

    let _ = client_stream.shutdown().await;
    let _ = upstream_stream.shutdown().await;

    Ok(())
}

/// Orquestra a conexão completa de Login e o ciclo de vida da sessão ativa no Gateway.
pub async fn handle_login_proxy(
    conn: ClientConnection,
    route: Option<CachedServerRoute>,
    handshake: HandshakePacket,
    login_start: LoginStartPacket,
    original_handshake: bytes::Bytes,
    original_login_start: bytes::Bytes,
    session_manager: &SessionManager,
) -> Result<()> {
    let route = match route {
        Some(r) => r,
        None => {
            return Err(GatewayError::InvalidState(format!(
                "Servidor não encontrado para rota: {}",
                handshake.server_address
            )));
        }
    };

    let target_addr = match route.target_addr {
        Some(addr) => addr,
        None => {
            return Err(GatewayError::InvalidState(format!(
                "Servidor {} não possui endereço de upstream ativo",
                route.server_id
            )));
        }
    };

    let client_ip = conn.client_ip;
    let client_port = conn.peer_addr.port();
    let (session_id, abort_rx) = session_manager.register_session(
        client_ip,
        route.subdomain.clone(),
        route.server_id.clone(),
        login_start.username.clone(),
    );

    info!(
        session_id = %session_id,
        user = %login_start.username,
        server = %route.name,
        target = %target_addr,
        "Estabelecendo conexão upstream e iniciando proxy duplex"
    );

    let upstream = establish_and_replay_upstream(
        target_addr,
        client_ip,
        client_port,
        route.proxy_protocol_upstream,
        &original_handshake,
        &original_login_start,
    )
    .await?;

    // Executar proxy bidirecional com destruição mútua imediata
    let proxy_res = run_duplex_proxy(conn.stream, upstream, abort_rx).await;

    // Critério de aceite: Ao finalizar o pipe (qualquer lado fechado), remove a sessão do mapa
    session_manager.remove_session(&session_id);
    info!(session_id = %session_id, "Sessão removida do mapa de sessões ativas");

    if let Err(err) = proxy_res {
        debug!(session_id = %session_id, error = %err, "Pipe de proxy duplex finalizado");
    }

    Ok(())
}
