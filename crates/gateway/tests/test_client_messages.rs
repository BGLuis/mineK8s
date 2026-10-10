use gateway::identity::NicknameValidationError;
use gateway::ipc::client::apply_route_update_event;
use gateway::ipc::{RouteAction, RouteUpdateEvent};
use gateway::messages::{status_text, Language, Refusal, StatusKind};
use gateway::motd::build_synthetic_status;
use gateway::routing::{CachedServerRoute, RouteTable, ServerInstanceStatus};
use minecraft_protocol::packets::status::MotdDescription;

const LANGUAGES: [Language; 2] = [Language::PtBr, Language::En];

const STATUS_KINDS: [StatusKind; 10] = [
    StatusKind::Provisioning,
    StatusKind::Starting,
    StatusKind::Stopping,
    StatusKind::Stopped,
    StatusKind::Updating,
    StatusKind::Crashed,
    StatusKind::Failed,
    StatusKind::Ready,
    StatusKind::Maintenance,
    StatusKind::NotFound,
];

fn refusals() -> Vec<Refusal> {
    vec![
        Refusal::ServerNotFound,
        Refusal::NotPublic,
        Refusal::DeviceNotRegistered,
        Refusal::IdentityUnavailable,
        Refusal::NicknameNotYours,
        Refusal::AccountInactive,
        Refusal::Maintenance,
        Refusal::NotInGroup,
        Refusal::NotInvited,
        Refusal::NotAuthorized,
        Refusal::AsleepWithoutAutoWake,
        Refusal::ServerFailed,
        Refusal::StillStarting,
        Refusal::FailedToStart,
        Refusal::UpstreamNotFound,
        Refusal::UpstreamUnavailable,
        Refusal::InvalidNickname(NicknameValidationError::TooShort),
        Refusal::InvalidNickname(NicknameValidationError::InvalidCharacters),
    ]
}

/// A fonte padrão do Minecraft não desenha emoji (vira quadrado vazio). Só ASCII, Latin-1 (acentos,
/// `»`, `·`) e `►`, que a fonte tem.
fn is_drawn_by_minecraft(c: char) -> bool {
    c.is_ascii() || ('\u{a0}'..='\u{ff}').contains(&c) || c == '►'
}

fn all_texts() -> Vec<String> {
    let mut texts = Vec::new();
    for language in LANGUAGES {
        for kind in STATUS_KINDS {
            let text = status_text(kind, language, "Sekiro");
            texts.push(text.version);
            texts.push(text.motd);
            texts.extend(text.hint);
        }
        for refusal in refusals() {
            texts.push(refusal.text(language, "Sekiro"));
        }
    }
    texts
}

#[test]
fn test_no_message_uses_characters_the_minecraft_font_cannot_draw() {
    for text in all_texts() {
        let bad: Vec<char> = text
            .chars()
            .filter(|c| !is_drawn_by_minecraft(*c))
            .collect();
        assert!(bad.is_empty(), "{text:?} tem {bad:?}");
    }
}

#[test]
fn test_every_message_is_filled_in_for_both_languages() {
    for text in all_texts() {
        assert!(!text.trim().is_empty());
        assert!(!text.contains('{'), "placeholder sem trocar em {text:?}");
    }
}

#[test]
fn test_language_changes_the_text_and_defaults_to_portuguese() {
    let pt = Refusal::NotInvited.text(Language::PtBr, "Sekiro");
    let en = Refusal::NotInvited.text(Language::En, "Sekiro");

    assert_ne!(pt, en);
    assert!(pt.contains("convidados"));
    assert!(en.contains("guests"));
    assert_eq!(Language::from_tag(""), Language::PtBr);
    assert_eq!(Language::from_tag("pt-BR"), Language::PtBr);
    assert_eq!(Language::from_tag("de"), Language::PtBr);
    assert_eq!(Language::from_tag("en"), Language::En);
    assert_eq!(Language::from_tag("EN-us"), Language::En);
}

#[test]
fn test_world_name_appears_in_the_server_list_and_in_the_wake_up_notice() {
    let motd = status_text(StatusKind::Stopped, Language::PtBr, "Sekiro").motd;
    let waking = Refusal::StillStarting.text(Language::PtBr, "Sekiro");

    assert!(motd.contains("Sekiro"));
    assert!(waking.contains("Sekiro está acordando"));
    // Aviso de que o servidor está subindo é amarelo; as recusas são vermelhas.
    assert!(waking.starts_with("§e§l"));
    assert!(Refusal::NotInGroup
        .text(Language::PtBr, "")
        .starts_with("§c§l"));
}

fn stopped_route() -> CachedServerRoute {
    CachedServerRoute {
        name: "Sekiro".into(),
        status: ServerInstanceStatus::Stopped,
        max_players: 8,
        ..Default::default()
    }
}

/// Se o gateway devolvesse um protocolo fixo, todo cliente de outra versão veria o mundo
/// hibernando como "versão incompatível".
#[test]
fn test_status_echoes_the_protocol_the_client_declared() {
    for protocol in [765, 767, 777] {
        let response = build_synthetic_status(Some(&stopped_route()), protocol);

        assert_eq!(response.version.protocol, protocol);
    }
}

#[test]
fn test_status_shows_the_world_name_and_its_player_limit() {
    let response = build_synthetic_status(Some(&stopped_route()), 767);

    assert_eq!(response.players.max, 8);
    match response.description {
        MotdDescription::Plain(text) => assert!(text.contains("Sekiro"), "{text}"),
        other => panic!("esperado texto simples: {other:?}"),
    }
}

#[test]
fn test_status_follows_the_language_of_the_world() {
    let mut route = stopped_route();
    route.language = Language::En;

    let response = build_synthetic_status(Some(&route), 767);

    match response.description {
        MotdDescription::Plain(text) => assert!(text.contains("Sleeping"), "{text}"),
        other => panic!("esperado texto simples: {other:?}"),
    }
}

fn upsert(name: &str, max_players: i32, language: &str) -> RouteUpdateEvent {
    RouteUpdateEvent {
        action: RouteAction::Upsert as i32,
        server_id: "srv-sekiro".into(),
        subdomain: "sekiro.mine.internal".into(),
        status: "STOPPED".into(),
        access_policy: "PUBLIC".into(),
        name: name.into(),
        max_players,
        language: language.into(),
        ..Default::default()
    }
}

#[test]
fn test_route_event_carries_name_player_limit_and_language() {
    let table = RouteTable::new();

    apply_route_update_event(&table, upsert("Sekiro", 8, "en"));

    let route = table.get_by_server_id("srv-sekiro").expect("route");
    assert_eq!(route.name, "Sekiro");
    assert_eq!(route.max_players, 8);
    assert_eq!(route.language, Language::En);
}

/// Um gateway novo com um control plane antigo (sem os campos) segue funcionando.
#[test]
fn test_route_event_without_the_new_fields_keeps_working() {
    let table = RouteTable::new();

    apply_route_update_event(&table, upsert("", 0, ""));

    let route = table.get_by_server_id("srv-sekiro").expect("route");
    assert_eq!(route.name, "srv-sekiro");
    assert_eq!(route.max_players, 20);
    assert_eq!(route.language, Language::PtBr);
}
