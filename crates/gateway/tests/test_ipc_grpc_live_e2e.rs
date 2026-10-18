use gateway::ipc::client::apply_route_update_event;
use gateway::ipc::GatewayIpcClient;
use gateway::routing::RouteTable;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

struct MockServerGuard {
    child: Child,
    port: u16,
}

impl MockServerGuard {
    fn start() -> Self {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let script_path = format!("{}/tests/fixtures/mock_grpc_server.js", manifest_dir);
        let node_modules = format!("{}/../../services/control-plane/node_modules", manifest_dir);

        let mut child = Command::new("node")
            .env("NODE_PATH", node_modules)
            .arg(script_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Falha ao iniciar processo node mock_grpc_server.js");

        let stdout = child.stdout.take().expect("Stdout não capturável");
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        let mut port = 0u16;
        for _ in 0..50 {
            line.clear();
            if reader.read_line(&mut line).is_ok() && line.starts_with("READY_PORT:") {
                let port_str = line.trim_start_matches("READY_PORT:").trim();
                port = port_str
                    .parse()
                    .expect("Porta inválida impressa pelo servidor mock");
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        assert!(port > 0, "Servidor mock não reportou porta pronta");
        Self { child, port }
    }
}

impl Drop for MockServerGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tokio::test]
async fn test_grpc_live_e2e_snapshot_identity_and_stream() {
    let guard = MockServerGuard::start();
    let endpoint = format!("http://127.0.0.1:{}", guard.port);

    // 1. Conectar GatewayIpcClient real contra o servidor gRPC
    let mut client = GatewayIpcClient::connect(endpoint)
        .await
        .expect("GatewayIpcClient deve conectar com sucesso ao servidor gRPC");

    // 2. Testar busca de snapshot e reconstrução da RouteTable
    let snapshot = client
        .fetch_routing_snapshot()
        .await
        .expect("fetch_routing_snapshot deve ter sucesso");
    assert_eq!(snapshot.len(), 1);

    let route_table = RouteTable::new();
    route_table.rebuild_from_snapshot(snapshot);
    assert_eq!(route_table.len(), 1);

    let found = route_table.lookup_virtual_host(25565, "e2e.mine.lan");
    assert!(
        found.is_some(),
        "Rota e2e.mine.lan deve ser encontrada na tabela reconstruída"
    );
    let route = found.unwrap();
    assert_eq!(route.server_id, "srv-e2e-live");
    assert!(route.proxy_protocol_upstream);

    // 3. Testar resolução de identidade (WhoIs -> Minecraft Nick)
    let identity = client
        .resolve_player_identity("user-e2e-123", "node-1", "100.64.0.1", "E2EPlayer")
        .await
        .expect("resolve_player_identity deve ter sucesso");
    assert!(identity.is_some(), "Identidade deve ser encontrada");
    let identity = identity.unwrap();
    assert_eq!(identity.user_id, "usr-e2e-real");
    assert_eq!(identity.minecraft_nick, "E2EPlayer");
    assert_eq!(identity.role, "ADMIN");
    assert_eq!(identity.group_ids, vec!["grp-e2e"]);
    assert!(identity.is_active);
    assert!(identity.is_mojang_verified);

    // Consulta para usuário inexistente deve retornar None
    let not_found = client
        .resolve_player_identity("unknown-user", "node-1", "100.64.0.2", "Unknown")
        .await
        .expect("resolve_player_identity para desconhecido deve ter sucesso");
    assert!(not_found.is_none());

    // 4. Testar recepção de stream de atualização de rotas
    let mut stream = client
        .subscribe_route_updates()
        .await
        .expect("subscribe_route_updates deve ter sucesso");

    let event = stream
        .message()
        .await
        .expect("Stream deve receber mensagem")
        .expect("Mensagem não deve ser nula");
    assert_eq!(event.server_id, "srv-dynamic-live");

    apply_route_update_event(&route_table, event);
    assert_eq!(route_table.len(), 2);
    let dynamic_route = route_table.lookup_virtual_host(25565, "dynamic.mine.lan");
    assert!(
        dynamic_route.is_some(),
        "Rota dinâmica deve estar na tabela"
    );
}
