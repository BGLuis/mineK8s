use gateway::ipc::client::apply_route_update_event;
use gateway::ipc::{RouteAction, RouteUpdateEvent};
use gateway::motd::build_synthetic_status;
use gateway::routing::{CachedServerRoute, RouteTable, ServerInstanceStatus};

const ICON: &str = "data:image/png;base64,iVBORw0KGgo=";

fn upsert(favicon: &str) -> RouteUpdateEvent {
    RouteUpdateEvent {
        action: RouteAction::Upsert as i32,
        server_id: "srv-sekiro".into(),
        subdomain: "sekiro.mine.internal".into(),
        status: "STOPPED".into(),
        access_policy: "PUBLIC".into(),
        game_type: "MINECRAFT".into(),
        routing_model: "VirtualHost".into(),
        listen_port: 25565,
        favicon: favicon.into(),
        ..Default::default()
    }
}

fn stored_icon(table: &RouteTable) -> Option<String> {
    table.get_by_server_id("srv-sekiro").expect("route").favicon
}

/// O ícone do servidor sai na resposta sintética (JVM dormindo, subindo, parando...) para o cliente
/// listar o mundo com a imagem que o administrador escolheu.
#[test]
fn test_synthetic_status_carries_the_server_icon_in_every_state() {
    let states = [
        ServerInstanceStatus::Provisioning,
        ServerInstanceStatus::Starting,
        ServerInstanceStatus::Stopping,
        ServerInstanceStatus::Stopped,
        ServerInstanceStatus::Updating,
        ServerInstanceStatus::Crashed,
        ServerInstanceStatus::Failed,
        ServerInstanceStatus::Ready,
    ];
    for status in states {
        let route = CachedServerRoute {
            name: "Sekiro".into(),
            status,
            favicon: Some(ICON.into()),
            ..Default::default()
        };

        let response = build_synthetic_status(Some(&route), 765);

        assert_eq!(response.favicon.as_deref(), Some(ICON), "estado {status:?}");
    }
}

#[test]
fn test_synthetic_status_without_an_icon_has_no_favicon() {
    let route = CachedServerRoute {
        status: ServerInstanceStatus::Stopped,
        ..Default::default()
    };

    assert!(build_synthetic_status(Some(&route), 765).favicon.is_none());
    assert!(build_synthetic_status(None, 765).favicon.is_none());
}

#[test]
fn test_route_event_icon_reaches_the_route_table() {
    let table = RouteTable::new();

    apply_route_update_event(&table, upsert(ICON));

    assert_eq!(stored_icon(&table).as_deref(), Some(ICON));
}

/// Um UPSERT sem ícone (o administrador o removeu) apaga o que estava guardado.
#[test]
fn test_upsert_without_icon_clears_it() {
    let table = RouteTable::new();
    apply_route_update_event(&table, upsert(ICON));

    apply_route_update_event(&table, upsert(""));

    assert_eq!(stored_icon(&table), None);
}

/// A mudança de estado não carrega o ícone: ele precisa sobreviver a ela.
#[test]
fn test_status_change_keeps_the_icon() {
    let table = RouteTable::new();
    apply_route_update_event(&table, upsert(ICON));

    apply_route_update_event(
        &table,
        RouteUpdateEvent {
            action: RouteAction::StatusChange as i32,
            server_id: "srv-sekiro".into(),
            status: "STARTING".into(),
            ..Default::default()
        },
    );

    assert_eq!(stored_icon(&table).as_deref(), Some(ICON));
}
