/// Validação estrita de formato de nickname do Minecraft Vanilla (RF-ARQ-21, GW:430-432).
/// Regra: 2 a 16 caracteres alfanuméricos ASCII ou sublinhado (`^[a-zA-Z0-9_]{2,16}$`).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NicknameValidationError {
    Empty,
    TooShort,
    TooLong,
    InvalidCharacters,
    SpacesNotAllowed,
    ControlCharacters,
    PathTraversal,
}

impl NicknameValidationError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Empty => "§cNickname não pode ser vazio.",
            Self::TooShort => "§cNickname deve ter no mínimo 2 caracteres.",
            Self::TooLong => "§cNickname deve ter no máximo 16 caracteres.",
            Self::InvalidCharacters => {
                "§cNickname contém caracteres inválidos. Apenas [a-zA-Z0-9_] são permitidos."
            }
            Self::SpacesNotAllowed => "§cNickname não pode conter espaços.",
            Self::ControlCharacters => "§cCaracteres de controle não permitidos.",
            Self::PathTraversal => "§cTentativa de path traversal detectada.",
        }
    }
}

pub fn validate_minecraft_nickname(nick: &str) -> Result<(), NicknameValidationError> {
    if nick.is_empty() {
        return Err(NicknameValidationError::Empty);
    }

    if nick.contains('\0') || nick.contains('\r') || nick.contains('\n') {
        return Err(NicknameValidationError::ControlCharacters);
    }

    if nick.contains('/') || nick.contains('\\') || nick.contains("..") {
        return Err(NicknameValidationError::PathTraversal);
    }

    if nick.contains(' ') {
        return Err(NicknameValidationError::SpacesNotAllowed);
    }

    let len = nick.len();
    if len < 2 {
        return Err(NicknameValidationError::TooShort);
    }
    if len > 16 {
        return Err(NicknameValidationError::TooLong);
    }

    for b in nick.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' => {}
            _ => return Err(NicknameValidationError::InvalidCharacters),
        }
    }

    Ok(())
}

pub fn is_valid_minecraft_nickname(nick: &str) -> bool {
    validate_minecraft_nickname(nick).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_nicknames() {
        assert!(is_valid_minecraft_nickname("Steve"));
        assert!(is_valid_minecraft_nickname("Player_One"));
        assert!(is_valid_minecraft_nickname("alex_99"));
        assert!(is_valid_minecraft_nickname("ab"));
        assert!(is_valid_minecraft_nickname("1234567890123456"));
    }

    #[test]
    fn test_invalid_nicknames() {
        assert_eq!(
            validate_minecraft_nickname(""),
            Err(NicknameValidationError::Empty)
        );
        assert_eq!(
            validate_minecraft_nickname("A"),
            Err(NicknameValidationError::TooShort)
        );
        assert_eq!(
            validate_minecraft_nickname("NickMaisLongoQue16Chars"),
            Err(NicknameValidationError::TooLong)
        );
        assert_eq!(
            validate_minecraft_nickname("User name"),
            Err(NicknameValidationError::SpacesNotAllowed)
        );
        assert_eq!(
            validate_minecraft_nickname("../../etc"),
            Err(NicknameValidationError::PathTraversal)
        );
        assert_eq!(
            validate_minecraft_nickname("Player!"),
            Err(NicknameValidationError::InvalidCharacters)
        );
        assert_eq!(
            validate_minecraft_nickname("\0Admin"),
            Err(NicknameValidationError::ControlCharacters)
        );
    }
}
