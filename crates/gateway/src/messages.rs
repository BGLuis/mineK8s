//! Everything the gateway says to a Minecraft client that is not the real server talking: the
//! server list entry while the JVM is not answering, and the reason shown when a login is refused.
//!
//! The client sends no language before it logs in (the handshake and Login Start carry none; the
//! locale arrives later, in the configuration phase), so the language is a per-world setting.
//!
//! The texts use colour and bold codes and only characters of Minecraft's default font. Emoji are
//! left out on purpose: the client draws them as empty boxes.

use serde::{Deserialize, Serialize};

use crate::identity::NicknameValidationError;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Language {
    #[default]
    PtBr,
    En,
}

impl Language {
    /// `en`, `en-US`... select English; anything else, including an empty tag, is Portuguese.
    pub fn from_tag(tag: &str) -> Self {
        if tag.trim().to_ascii_lowercase().starts_with("en") {
            Self::En
        } else {
            Self::PtBr
        }
    }
}

/// What the server list shows for a world the gateway answers for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatusKind {
    Provisioning,
    Starting,
    Stopping,
    Stopped,
    Updating,
    Crashed,
    Failed,
    Ready,
    Maintenance,
    NotFound,
}

pub struct StatusText {
    /// The version line, which the client shows on hover.
    pub version: String,
    /// The two lines under the server name.
    pub motd: String,
    /// A line in the player list tooltip, for the states where the click does something.
    pub hint: Option<String>,
}

pub fn status_text(kind: StatusKind, language: Language, world: &str) -> StatusText {
    use Language::{En, PtBr};
    use StatusKind::*;

    let (color, label, detail, hint): (&str, &str, &str, Option<&str>) = match (language, kind) {
        (PtBr, Provisioning) => ("§b", "Preparando", "Criando os recursos do servidor", None),
        (PtBr, Starting) => (
            "§e",
            "Iniciando",
            "Carregando o mundo, tente entrar em instantes",
            None,
        ),
        (PtBr, Stopping) => ("§6", "Desligando", "Salvando o mundo", None),
        (PtBr, Stopped) => (
            "§6",
            "Hibernando",
            "Entre para acordar o servidor",
            Some("§e► §7Entre e o mundo será ligado"),
        ),
        (PtBr, Updating) => (
            "§b",
            "Atualizando",
            "Instalando a nova versão do servidor",
            None,
        ),
        (PtBr, Crashed) => ("§c", "Parou", "O servidor encerrou inesperadamente", None),
        (PtBr, Failed) => (
            "§4",
            "Erro",
            "Falha de infraestrutura, avise o administrador",
            None,
        ),
        (PtBr, Ready) => ("§a", "Online", "Bom jogo!", None),
        (PtBr, Maintenance) => (
            "§c",
            "Manutenção",
            "Só administradores podem entrar agora",
            None,
        ),
        (En, Provisioning) => ("§b", "Preparing", "Creating the server's resources", None),
        (En, Starting) => (
            "§e",
            "Starting",
            "Loading the world, try joining in a moment",
            None,
        ),
        (En, Stopping) => ("§6", "Shutting down", "Saving the world", None),
        (En, Stopped) => (
            "§6",
            "Sleeping",
            "Join to wake the server up",
            Some("§e► §7Join and the world will start"),
        ),
        (En, Updating) => ("§b", "Updating", "Installing the new server version", None),
        (En, Crashed) => ("§c", "Stopped", "The server stopped unexpectedly", None),
        (En, Failed) => (
            "§4",
            "Error",
            "Infrastructure failure, tell the administrator",
            None,
        ),
        (En, Ready) => ("§a", "Online", "Have fun!", None),
        (En, Maintenance) => (
            "§c",
            "Maintenance",
            "Only administrators can join right now",
            None,
        ),
        (PtBr, NotFound) => {
            return StatusText {
                version: "§cMineKubernetes".to_string(),
                motd:
                    "§c§lServidor não encontrado\n§7Confira o endereço ou fale com o administrador"
                        .to_string(),
                hint: None,
            };
        }
        (En, NotFound) => {
            return StatusText {
                version: "§cMineKubernetes".to_string(),
                motd: "§c§lServer not found\n§7Check the address or ask the administrator"
                    .to_string(),
                hint: None,
            };
        }
    };

    StatusText {
        version: format!("{color}{label}"),
        motd: format!("{color}§l{world} §r§8» {color}{label}\n§7{detail}"),
        hint: hint.map(str::to_string),
    }
}

/// Why a login was refused, or what the player is told while the world wakes up.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    ServerNotFound,
    NotPublic,
    DeviceNotRegistered,
    IdentityUnavailable,
    NicknameNotYours,
    AccountInactive,
    Maintenance,
    NotInGroup,
    NotInvited,
    NotAuthorized,
    AsleepWithoutAutoWake,
    ServerFailed,
    /// The world was woken up but did not finish within the time the connection is held.
    StillStarting,
    FailedToStart,
    UpstreamNotFound,
    UpstreamUnavailable,
    InvalidNickname(NicknameValidationError),
}

impl Refusal {
    pub fn text(self, language: Language, world: &str) -> String {
        use Language::{En, PtBr};
        use Refusal::*;

        let (title, body): (String, String) = match (language, self) {
            (PtBr, ServerNotFound) => ("Servidor não encontrado".into(), "Confira o endereço digitado.".into()),
            (PtBr, NotPublic) => ("Acesso restrito".into(), "Este servidor não aceita conexões públicas.".into()),
            (PtBr, DeviceNotRegistered) => (
                "Dispositivo não registrado".into(),
                "Peça ao administrador para cadastrar este dispositivo na rede.".into(),
            ),
            (PtBr, IdentityUnavailable) => (
                "Não foi possível verificar você".into(),
                "Tente novamente em instantes.".into(),
            ),
            (PtBr, NicknameNotYours) => (
                "Nickname não permitido".into(),
                "Este nickname não pertence a este dispositivo/conta.".into(),
            ),
            (PtBr, AccountInactive) => ("Conta desativada".into(), "Sua conta está inativa ou foi revogada.".into()),
            (PtBr, Maintenance) => (
                format!("{world} em manutenção"),
                "Só administradores podem entrar agora.".into(),
            ),
            (PtBr, NotInGroup) => (
                "Sem permissão".into(),
                "Você não faz parte dos grupos que podem entrar neste mundo.".into(),
            ),
            (PtBr, NotInvited) => ("Sem permissão".into(), "Este mundo é restrito a convidados específicos.".into()),
            (PtBr, NotAuthorized) => ("Acesso não autorizado".into(), String::new()),
            (PtBr, AsleepWithoutAutoWake) => (
                format!("{world} está dormindo"),
                "O servidor está desligado e o despertar automático está desativado.\n§7Peça ao administrador para ligá-lo.".into(),
            ),
            (PtBr, ServerFailed) => (
                format!("{world} fora do ar"),
                "O servidor está em estado de falha. Avise o administrador.".into(),
            ),
            (PtBr, StillStarting) => (
                format!("{world} está acordando"),
                "O servidor estava hibernando e já foi ligado.\n§7Aguarde cerca de 1 minuto e entre de novo.".into(),
            ),
            (PtBr, FailedToStart) => (
                format!("{world} não conseguiu iniciar"),
                "O servidor encerrou com falha ao ligar. Avise o administrador.".into(),
            ),
            (PtBr, UpstreamNotFound) => (
                "Servidor inacessível".into(),
                "Não foi possível localizar o servidor de destino.".into(),
            ),
            (PtBr, UpstreamUnavailable) => ("Servidor indisponível".into(), "Tente novamente em instantes.".into()),
            (PtBr, InvalidNickname(error)) => ("Nickname inválido".into(), error.detail(PtBr).into()),

            (En, ServerNotFound) => ("Server not found".into(), "Check the address you typed.".into()),
            (En, NotPublic) => ("Restricted access".into(), "This server does not accept public connections.".into()),
            (En, DeviceNotRegistered) => (
                "Device not registered".into(),
                "Ask the administrator to register this device on the network.".into(),
            ),
            (En, IdentityUnavailable) => ("Could not verify you".into(), "Try again in a moment.".into()),
            (En, NicknameNotYours) => (
                "Nickname not allowed".into(),
                "This nickname does not belong to this device/account.".into(),
            ),
            (En, AccountInactive) => ("Account disabled".into(), "Your account is inactive or was revoked.".into()),
            (En, Maintenance) => (
                format!("{world} is under maintenance"),
                "Only administrators can join right now.".into(),
            ),
            (En, NotInGroup) => (
                "No permission".into(),
                "You are not in any of the groups allowed in this world.".into(),
            ),
            (En, NotInvited) => ("No permission".into(), "This world is limited to specific guests.".into()),
            (En, NotAuthorized) => ("Access not authorized".into(), String::new()),
            (En, AsleepWithoutAutoWake) => (
                format!("{world} is asleep"),
                "The server is off and automatic wake-up is disabled.\n§7Ask the administrator to start it.".into(),
            ),
            (En, ServerFailed) => (
                format!("{world} is down"),
                "The server is in a failed state. Tell the administrator.".into(),
            ),
            (En, StillStarting) => (
                format!("{world} is waking up"),
                "The server was sleeping and has just been started.\n§7Wait about a minute and join again.".into(),
            ),
            (En, FailedToStart) => (
                format!("{world} could not start"),
                "The server crashed while starting. Tell the administrator.".into(),
            ),
            (En, UpstreamNotFound) => ("Server unreachable".into(), "Could not locate the destination server.".into()),
            (En, UpstreamUnavailable) => ("Server unavailable".into(), "Try again in a moment.".into()),
            (En, InvalidNickname(error)) => ("Invalid nickname".into(), error.detail(En).into()),
        };

        let color = match self {
            Refusal::StillStarting => "§e",
            _ => "§c",
        };
        if body.is_empty() {
            format!("{color}§l{title}")
        } else {
            format!("{color}§l{title}\n\n§7{body}")
        }
    }
}

impl NicknameValidationError {
    pub fn detail(&self, language: Language) -> &'static str {
        use Language::{En, PtBr};
        match (language, self) {
            (PtBr, Self::Empty) => "O nickname não pode ser vazio.",
            (PtBr, Self::TooShort) => "O nickname deve ter no mínimo 2 caracteres.",
            (PtBr, Self::TooLong) => "O nickname deve ter no máximo 16 caracteres.",
            (PtBr, Self::InvalidCharacters) => {
                "O nickname tem caracteres inválidos. Use só letras, números e _."
            }
            (PtBr, Self::SpacesNotAllowed) => "O nickname não pode ter espaços.",
            (PtBr, Self::ControlCharacters) => "O nickname tem caracteres de controle.",
            (PtBr, Self::PathTraversal) => "O nickname tem uma sequência não permitida.",
            (En, Self::Empty) => "The nickname cannot be empty.",
            (En, Self::TooShort) => "The nickname must have at least 2 characters.",
            (En, Self::TooLong) => "The nickname must have at most 16 characters.",
            (En, Self::InvalidCharacters) => {
                "The nickname has invalid characters. Use only letters, numbers and _."
            }
            (En, Self::SpacesNotAllowed) => "The nickname cannot contain spaces.",
            (En, Self::ControlCharacters) => "The nickname has control characters.",
            (En, Self::PathTraversal) => "The nickname has a sequence that is not allowed.",
        }
    }
}
