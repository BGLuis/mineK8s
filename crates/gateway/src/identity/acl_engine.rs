use crate::identity::nickname_validator::{validate_minecraft_nickname, NicknameValidationError};
use crate::messages::Refusal;
use crate::routing::{AccessPolicy, CachedServerRoute};

/// Resultado da avaliação do motor de decisão de acesso (RF-TS-02).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessDecision {
    Allowed { admin_bypass: bool },
    Denied { reason: Refusal },
}

/// Resultado da validação de Anti-Impersonation (RF-ARQ-21).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NicknameDecision {
    Match,
    AutoAdopt,
    Invalid(NicknameValidationError),
    Impersonation { registered_nick: String },
}

/// Motor de Decisão de Acesso Zero-Trust no Gateway L7.
pub struct AccessDecisionEngine;

impl AccessDecisionEngine {
    /// Avalia se um jogador autenticado tem permissão para conectar ao servidor alvo (RF-TS-02).
    pub fn evaluate_access(
        user_id: &str,
        user_role: &str,
        user_groups: &[String],
        is_active: bool,
        route: &CachedServerRoute,
    ) -> AccessDecision {
        if !is_active {
            return AccessDecision::Denied {
                reason: Refusal::AccountInactive,
            };
        }

        // 1. Bypass irrestrito de Administrador (TS §9.1)
        if user_role.eq_ignore_ascii_case("ADMIN") {
            return AccessDecision::Allowed { admin_bypass: true };
        }

        // 2. Servidor em manutenção técnica (C-01)
        if route.access_policy == AccessPolicy::Maintenance {
            return AccessDecision::Denied {
                reason: Refusal::Maintenance,
            };
        }

        // 3. Servidor público (INTERNET é aberto a qualquer um, inclusive a quem entra pela tailnet)
        if matches!(
            route.access_policy,
            AccessPolicy::Public | AccessPolicy::Internet
        ) {
            return AccessDecision::Allowed {
                admin_bypass: false,
            };
        }

        // 4. Servidor restrito por grupo
        if route.access_policy == AccessPolicy::Group {
            let has_group = user_groups
                .iter()
                .any(|ug| route.allowed_group_ids.iter().any(|rg| rg == ug));
            if has_group {
                return AccessDecision::Allowed {
                    admin_bypass: false,
                };
            } else {
                return AccessDecision::Denied {
                    reason: Refusal::NotInGroup,
                };
            }
        }

        // 5. Servidor restrito nominalmente (Individual)
        if route.access_policy == AccessPolicy::Individual {
            if route.allowed_user_ids.iter().any(|id| id == user_id) {
                return AccessDecision::Allowed {
                    admin_bypass: false,
                };
            } else {
                return AccessDecision::Denied {
                    reason: Refusal::NotInvited,
                };
            }
        }

        AccessDecision::Denied {
            reason: Refusal::NotAuthorized,
        }
    }

    /// Valida o nickname declarado contra a identidade do dispositivo/usuário (Anti-Impersonation, RF-ARQ-21).
    pub fn evaluate_nickname(declared_nick: &str, registered_nick: &str) -> NicknameDecision {
        // Validação estrita de formato
        if let Err(err) = validate_minecraft_nickname(declared_nick) {
            return NicknameDecision::Invalid(err);
        }

        // Auto-adoção no primeiro acesso
        if registered_nick.is_empty() {
            return NicknameDecision::AutoAdopt;
        }

        // Coincide com o registrado (case-insensitive)
        if declared_nick.eq_ignore_ascii_case(registered_nick) {
            return NicknameDecision::Match;
        }

        // Tentativa de impersonação
        NicknameDecision::Impersonation {
            registered_nick: registered_nick.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routing::{RoutingModel, ServerInstanceStatus};

    fn make_test_route(policy: AccessPolicy) -> CachedServerRoute {
        CachedServerRoute {
            server_id: "srv-test".into(),
            name: "Test Server".into(),
            subdomain: "test.mine.lan".into(),
            listener_port: 25565,
            routing_model: RoutingModel::VirtualHost,
            target_addr: Some("127.0.0.1:25566".parse().unwrap()),
            status: ServerInstanceStatus::Ready,
            proxy_protocol_upstream: false,
            max_players: 20,
            protocol_version: 765,
            access_policy: policy,
            allowed_group_ids: vec!["grp-modpack-b".into()],
            allowed_user_ids: vec!["usr-alice".into()],
            game_type: "MINECRAFT".into(),
            auto_wake: true,
            favicon: None,
            language: Default::default(),
        }
    }

    #[test]
    fn test_public_access() {
        let route = make_test_route(AccessPolicy::Public);
        let decision =
            AccessDecisionEngine::evaluate_access("usr-bob", "PLAYER", &[], true, &route);
        assert_eq!(
            decision,
            AccessDecision::Allowed {
                admin_bypass: false
            }
        );
    }

    #[test]
    fn test_internet_route_is_open_to_tailnet_players() {
        let route = make_test_route(AccessPolicy::Internet);
        let decision =
            AccessDecisionEngine::evaluate_access("usr-bob", "PLAYER", &[], true, &route);
        assert_eq!(
            decision,
            AccessDecision::Allowed {
                admin_bypass: false
            }
        );
    }

    #[test]
    fn test_admin_bypass_on_maintenance() {
        let route = make_test_route(AccessPolicy::Maintenance);

        // Player regular é negado
        let player_dec =
            AccessDecisionEngine::evaluate_access("usr-bob", "PLAYER", &[], true, &route);
        assert_eq!(
            player_dec,
            AccessDecision::Denied {
                reason: Refusal::Maintenance,
            }
        );

        // Admin obtém bypass
        let admin_dec =
            AccessDecisionEngine::evaluate_access("usr-admin", "ADMIN", &[], true, &route);
        assert_eq!(admin_dec, AccessDecision::Allowed { admin_bypass: true });
    }

    #[test]
    fn test_group_access() {
        let route = make_test_route(AccessPolicy::Group);

        // Grupos disjuntos: negado
        let denied = AccessDecisionEngine::evaluate_access(
            "usr-bob",
            "PLAYER",
            &["grp-modpack-a".into()],
            true,
            &route,
        );
        assert_eq!(
            denied,
            AccessDecision::Denied {
                reason: Refusal::NotInGroup,
            }
        );

        // Interseção de grupos: permitido
        let allowed = AccessDecisionEngine::evaluate_access(
            "usr-bob",
            "PLAYER",
            &["grp-modpack-b".into()],
            true,
            &route,
        );
        assert_eq!(
            allowed,
            AccessDecision::Allowed {
                admin_bypass: false
            }
        );
    }

    #[test]
    fn test_individual_access() {
        let route = make_test_route(AccessPolicy::Individual);

        // Usuário autorizado nominalmente
        let allowed =
            AccessDecisionEngine::evaluate_access("usr-alice", "PLAYER", &[], true, &route);
        assert_eq!(
            allowed,
            AccessDecision::Allowed {
                admin_bypass: false
            }
        );

        // Outro usuário: negado
        let denied = AccessDecisionEngine::evaluate_access("usr-bob", "PLAYER", &[], true, &route);
        assert_eq!(
            denied,
            AccessDecision::Denied {
                reason: Refusal::NotInvited,
            }
        );
    }

    #[test]
    fn test_anti_impersonation() {
        // Auto-adoção
        let auto = AccessDecisionEngine::evaluate_nickname("PlayerNew", "");
        assert_eq!(auto, NicknameDecision::AutoAdopt);

        // Coincidência
        let matched = AccessDecisionEngine::evaluate_nickname("PlayerNew", "playernew");
        assert_eq!(matched, NicknameDecision::Match);

        // Tentativa de impersonação
        let impersonation = AccessDecisionEngine::evaluate_nickname("PlayerOther", "PlayerNew");
        assert_eq!(
            impersonation,
            NicknameDecision::Impersonation {
                registered_nick: "PlayerNew".into()
            }
        );
    }
}
