use gateway::ipc::client::apply_route_update_event;
use gateway::ipc::protocol::{
    ResolvePlayerRequest, ResolvePlayerResponse, RevokeSessionRequest, RevokeSessionResponse,
    RouteAction, RouteUpdateEvent, RoutingSnapshotResponse, SessionEventType,
    SessionLifecycleEvent,
};
use gateway::ipc::GatewayIpcClient;
use gateway::routing::{AccessPolicy, RouteTable, RoutingModel, ServerInstanceStatus};
use prost::Message;

/// Acceptance Criterion: "Gateway reinicia e reconstrói rotas pelo snapshot inicial" (RF-GW-16, RF-MG-04).
#[test]
fn test_route_table_rebuild_from_snapshot() {
    let initial_events = vec![
        RouteUpdateEvent {
            action: RouteAction::Upsert as i32,
            server_id: "srv-survival".into(),
            subdomain: "survival.mine.lan".into(),
            target_ip_port: "10.0.1.10:25565".into(),
            status: "READY".into(),
            access_policy: "PUBLIC".into(),
            allowed_group_ids: vec![],
            allowed_user_ids: vec![],
            proxy_protocol: true,
            game_type: "MINECRAFT".into(),
            routing_model: "VirtualHost".into(),
            listen_port: 25565,
            auto_wake: true,
        },
        RouteUpdateEvent {
            action: RouteAction::Upsert as i32,
            server_id: "srv-bedrock".into(),
            subdomain: "bedrock.mine.lan".into(),
            target_ip_port: "10.0.1.11:19132".into(),
            status: "READY".into(),
            access_policy: "INDIVIDUAL".into(),
            allowed_group_ids: vec![],
            allowed_user_ids: vec!["usr-vip-1".into(), "usr-vip-2".into()],
            proxy_protocol: false,
            game_type: "MINECRAFT".into(),
            routing_model: "VirtualHost".into(),
            listen_port: 25565,
            auto_wake: true,
        },
        RouteUpdateEvent {
            action: RouteAction::Upsert as i32,
            server_id: "srv-terraria".into(),
            subdomain: "".into(),
            target_ip_port: "10.0.1.12:7777".into(),
            status: "READY".into(),
            access_policy: "GROUP".into(),
            allowed_group_ids: vec!["grp-gamers".into()],
            allowed_user_ids: vec![],
            proxy_protocol: false,
            game_type: "TERRARIA".into(),
            routing_model: "DedicatedPort".into(),
            listen_port: 7777,
            auto_wake: false,
        },
    ];

    let cached_routes: Vec<_> = initial_events.iter().map(|e| e.to_cached_route()).collect();

    // 1. Gateway inicializa tabela limpa e aplica snapshot
    let route_table = RouteTable::new();
    assert!(route_table.is_empty());

    route_table.rebuild_from_snapshot(cached_routes);
    assert_eq!(route_table.len(), 3);

    // 2. Valida rota VirtualHost Minecraft
    let survival = route_table.lookup_virtual_host(25565, "SURVIVAL.MINE.LAN");
    assert!(survival.is_some(), "Rota survival deve existir");
    let survival = survival.unwrap();
    assert_eq!(survival.server_id, "srv-survival");
    assert_eq!(survival.status, ServerInstanceStatus::Ready);
    assert_eq!(survival.access_policy, AccessPolicy::Public);
    assert!(survival.proxy_protocol_upstream);
    assert_eq!(
        survival.target_addr,
        Some("10.0.1.10:25565".parse().unwrap())
    );

    // 3. Valida rota com política individual
    let bedrock = route_table.lookup_virtual_host(25565, "bedrock.mine.lan");
    assert!(bedrock.is_some(), "Rota bedrock deve existir");
    let bedrock = bedrock.unwrap();
    assert_eq!(bedrock.access_policy, AccessPolicy::Individual);
    assert_eq!(bedrock.allowed_user_ids, vec!["usr-vip-1", "usr-vip-2"]);

    // 4. Valida rota dedicada Terraria
    let terraria = route_table.lookup_dedicated(7777);
    assert!(terraria.is_some(), "Rota terraria deve existir");
    let terraria = terraria.unwrap();
    assert_eq!(terraria.server_id, "srv-terraria");
    assert_eq!(terraria.routing_model, RoutingModel::DedicatedPort);
    assert_eq!(terraria.access_policy, AccessPolicy::Group);
    assert_eq!(terraria.game_type, "TERRARIA");
    assert_eq!(terraria.allowed_group_ids, vec!["grp-gamers"]);

    // 5. Simula reboot do Gateway: nova instância da RouteTable reconstrói o mesmo snapshot
    let rebooted_table = RouteTable::new();
    let reboot_routes: Vec<_> = initial_events.iter().map(|e| e.to_cached_route()).collect();
    rebooted_table.rebuild_from_snapshot(reboot_routes);
    assert_eq!(rebooted_table.len(), 3);
    assert!(rebooted_table
        .lookup_virtual_host(25565, "survival.mine.lan")
        .is_some());
    assert!(rebooted_table.lookup_dedicated(7777).is_some());
}

/// Acceptance Criterion: "Mutação no Control Plane reflete na tabela do Gateway via IPC streaming sem restart" (RF-GW-16).
#[test]
fn test_live_route_update_stream_mutations() {
    let route_table = RouteTable::new();

    // 1. Inserir rota inicial via UPSERT
    let upsert_lobby = RouteUpdateEvent {
        action: RouteAction::Upsert as i32,
        server_id: "srv-lobby".into(),
        subdomain: "lobby.mine.lan".into(),
        target_ip_port: "127.0.0.1:25565".into(),
        status: "READY".into(),
        access_policy: "PUBLIC".into(),
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        proxy_protocol: false,
        game_type: "MINECRAFT".into(),
        routing_model: "VirtualHost".into(),
        listen_port: 25565,
        auto_wake: true,
    };
    apply_route_update_event(&route_table, upsert_lobby);
    assert_eq!(route_table.len(), 1);

    // 2. Stream recebe novo servidor dinamicamente (UPSERT)
    let upsert_creative = RouteUpdateEvent {
        action: RouteAction::Upsert as i32,
        server_id: "srv-creative".into(),
        subdomain: "creative.mine.lan".into(),
        target_ip_port: "127.0.0.1:25568".into(),
        status: "READY".into(),
        access_policy: "PUBLIC".into(),
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        proxy_protocol: false,
        game_type: "MINECRAFT".into(),
        routing_model: "VirtualHost".into(),
        listen_port: 25565,
        auto_wake: true,
    };
    apply_route_update_event(&route_table, upsert_creative);
    assert_eq!(route_table.len(), 2);
    let found = route_table.lookup_virtual_host(25565, "creative.mine.lan");
    assert!(
        found.is_some(),
        "Novo servidor deve estar acessível sem restart"
    );
    assert_eq!(found.unwrap().server_id, "srv-creative");

    // 3. Control Plane altera status para MAINTENANCE dinamicamente (STATUS_CHANGE)
    let status_change = RouteUpdateEvent {
        action: RouteAction::StatusChange as i32,
        server_id: "srv-creative".into(),
        subdomain: "creative.mine.lan".into(),
        target_ip_port: "".into(),
        status: "STOPPING".into(),
        access_policy: "PUBLIC".into(),
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        proxy_protocol: false,
        game_type: "MINECRAFT".into(),
        routing_model: "VirtualHost".into(),
        listen_port: 25565,
        auto_wake: true,
    };
    apply_route_update_event(&route_table, status_change);
    let updated = route_table
        .lookup_virtual_host(25565, "creative.mine.lan")
        .unwrap();
    assert_eq!(updated.status, ServerInstanceStatus::Stopping);

    // 4. Servidor deletado dinamicamente no Control Plane (DELETE)
    let delete_event = RouteUpdateEvent {
        action: RouteAction::Delete as i32,
        server_id: "srv-creative".into(),
        subdomain: "".into(),
        target_ip_port: "".into(),
        status: "".into(),
        access_policy: "".into(),
        allowed_group_ids: vec![],
        allowed_user_ids: vec![],
        proxy_protocol: false,
        game_type: "".into(),
        routing_model: "".into(),
        listen_port: 0,
        auto_wake: false,
    };
    apply_route_update_event(&route_table, delete_event);
    assert_eq!(route_table.len(), 1);
    assert!(route_table
        .lookup_virtual_host(25565, "creative.mine.lan")
        .is_none());
}

/// Valida serialização e desserialização binária dos payloads protobuf entre Gateway e Control Plane.
#[test]
fn test_protobuf_codec_roundtrips() {
    // 1. RouteUpdateEvent
    let route = RouteUpdateEvent {
        action: RouteAction::Upsert as i32,
        server_id: "srv-test-1".into(),
        subdomain: "test.lan".into(),
        target_ip_port: "127.0.0.1:25565".into(),
        status: "READY".into(),
        access_policy: "GROUP".into(),
        allowed_group_ids: vec!["grp-1".into(), "grp-2".into()],
        allowed_user_ids: vec![],
        proxy_protocol: true,
        game_type: "MINECRAFT".into(),
        routing_model: "VirtualHost".into(),
        listen_port: 25565,
        auto_wake: true,
    };

    let mut buf = Vec::new();
    route
        .encode(&mut buf)
        .expect("Serialização protobuf falhou");
    let decoded = RouteUpdateEvent::decode(&buf[..]).expect("Desserialização protobuf falhou");
    assert_eq!(route, decoded);

    // 2. RoutingSnapshotResponse
    let snapshot = RoutingSnapshotResponse {
        routes: vec![route.clone()],
    };
    buf.clear();
    snapshot.encode(&mut buf).unwrap();
    let decoded_snapshot = RoutingSnapshotResponse::decode(&buf[..]).unwrap();
    assert_eq!(decoded_snapshot.routes.len(), 1);
    assert_eq!(decoded_snapshot.routes[0].server_id, "srv-test-1");

    // 3. SessionLifecycleEvent
    let session_event = SessionLifecycleEvent {
        event_type: SessionEventType::Connected as i32,
        session_id: "sess-abc-123".into(),
        server_id: "srv-test-1".into(),
        client_ip: "100.64.0.5".into(),
        minecraft_nick: "Steve".into(),
        timestamp_epoch_ms: 1727632800000,
        reason: "".into(),
    };
    buf.clear();
    session_event.encode(&mut buf).unwrap();
    let decoded_session = SessionLifecycleEvent::decode(&buf[..]).unwrap();
    assert_eq!(session_event, decoded_session);

    // 4. RevokeSessionRequest & Response
    let revoke_req = RevokeSessionRequest {
        server_id: "srv-test-1".into(),
        client_ip: "100.64.0.5".into(),
        minecraft_nick: "Steve".into(),
        reason_message: "Kick manual pelo admin".into(),
    };
    buf.clear();
    revoke_req.encode(&mut buf).unwrap();
    let decoded_req = RevokeSessionRequest::decode(&buf[..]).unwrap();
    assert_eq!(revoke_req, decoded_req);

    let revoke_resp = RevokeSessionResponse {
        session_found: true,
        terminated_connections_count: 1,
    };
    buf.clear();
    revoke_resp.encode(&mut buf).unwrap();
    let decoded_resp = RevokeSessionResponse::decode(&buf[..]).unwrap();
    assert_eq!(revoke_resp, decoded_resp);

    // 5. ResolvePlayerRequest & Response
    let resolve_req = ResolvePlayerRequest {
        tailscale_user_id: "user-ts-123".into(),
        node_id: "node-456".into(),
        client_ip: "100.64.0.10".into(),
    };
    buf.clear();
    resolve_req.encode(&mut buf).unwrap();
    let decoded_res_req = ResolvePlayerRequest::decode(&buf[..]).unwrap();
    assert_eq!(resolve_req, decoded_res_req);

    let resolve_resp = ResolvePlayerResponse {
        found: true,
        user_id: "usr-mine-001".into(),
        minecraft_nick: "Alex".into(),
        role: "ADMIN".into(),
        group_ids: vec!["grp-admins".into()],
        is_active: true,
        is_mojang_verified: true,
    };
    buf.clear();
    resolve_resp.encode(&mut buf).unwrap();
    let decoded_res_resp = ResolvePlayerResponse::decode(&buf[..]).unwrap();
    assert_eq!(resolve_resp, decoded_res_resp);
}

/// Valida que o GatewayIpcClient rejeita conexões inválidas com tratamento de erro adequado.
#[tokio::test]
async fn test_ipc_client_unreachable_endpoint() {
    let client = GatewayIpcClient::connect("http://127.0.0.1:59998").await;
    // O endpoint não tem nenhum servidor escutando, a conexão deve falhar ordenadamente
    assert!(
        client.is_err(),
        "Conexão a porta fechada deve retornar erro"
    );
}
