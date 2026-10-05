import {
  AccessDecisionEngineService,
  ServerContext,
  UserContext,
} from './access-decision-engine.service';
import { validateNicknameFormat } from './nickname-validator';

describe('AccessDecisionEngine & NicknameValidator (TS §9.1, RF-TS-02, RF-ARQ-21)', () => {
  let engine: AccessDecisionEngineService;

  beforeEach(() => {
    engine = new AccessDecisionEngineService();
  });

  describe('Matriz de Testes TS §9.1 — NicknameValidator', () => {
    it('deve aprovar nickname Vanilla válido (ex.: Player_One)', () => {
      const result = validateNicknameFormat('Player_One');
      expect(result.valid).toBe(true);
    });

    it('deve rejeitar nickname com espaço ("User name")', () => {
      const result = validateNicknameFormat('User name');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('SPACES_NOT_ALLOWED');
    });

    it('deve rejeitar path traversal ("../../etc")', () => {
      const result = validateNicknameFormat('../../etc');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('PATH_TRAVERSAL_DETECTED');
    });

    it('deve rejeitar caracteres de controle e nulos ("\\0admin")', () => {
      const result = validateNicknameFormat('\0admin');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('CONTROL_CHARACTERS_NOT_ALLOWED');
    });

    it('deve rejeitar nickname com menos de 2 caracteres ("A")', () => {
      const result = validateNicknameFormat('A');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NICKNAME_TOO_SHORT');
    });

    it('deve rejeitar nickname com mais de 16 caracteres ("NickMaisLongoQue16Chars")', () => {
      const result = validateNicknameFormat('NickMaisLongoQue16Chars');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NICKNAME_TOO_LONG');
    });
  });

  describe('Matriz de Testes TS §9.1 — DecisionEngine', () => {
    const regularPlayer: UserContext = {
      userId: 'usr-regular',
      minecraftNick: 'RegularGuy',
      role: 'PLAYER',
      groupIds: ['grp-default'],
      isActive: true,
    };

    const adminUser: UserContext = {
      userId: 'usr-admin',
      minecraftNick: 'SuperAdmin',
      role: 'ADMIN',
      groupIds: [],
      isActive: true,
    };

    it('Cenário 1: Acesso ao Servidor Público (PUBLIC)', () => {
      const publicServer: ServerContext = {
        serverId: 'srv-public',
        policy: 'PUBLIC',
      };

      const decision = engine.evaluateAccess(regularPlayer, publicServer);
      expect(decision.allowed).toBe(true);
    });

    it('Cenário 2: Acesso Negado por Grupos Disjuntos (GROUP)', () => {
      const modpackPlayer: UserContext = {
        ...regularPlayer,
        groupIds: ['Modpack-A'],
      };

      const modpackServer: ServerContext = {
        serverId: 'srv-modpack-b',
        policy: 'GROUP',
        allowedGroupIds: ['Modpack-B'],
      };

      const decision = engine.evaluateAccess(modpackPlayer, modpackServer);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('INSUFFICIENT_GROUPS');
    });

    it('Cenário 2b: Acesso Concedido por Interseção de Grupos (GROUP)', () => {
      const modpackPlayer: UserContext = {
        ...regularPlayer,
        groupIds: ['Modpack-A', 'Modpack-B'],
      };

      const modpackServer: ServerContext = {
        serverId: 'srv-modpack-b',
        policy: 'GROUP',
        allowedGroupIds: ['Modpack-B'],
      };

      const decision = engine.evaluateAccess(modpackPlayer, modpackServer);
      expect(decision.allowed).toBe(true);
    });

    it('Cenário 3: Bypass de Administrador em Manutenção (ADMIN bypass)', () => {
      const maintServer: ServerContext = {
        serverId: 'srv-maint',
        policy: 'MAINTENANCE',
      };

      // Jogador comum é rejeitado
      const regularDecision = engine.evaluateAccess(regularPlayer, maintServer);
      expect(regularDecision.allowed).toBe(false);
      expect(regularDecision.reason).toBe('MAINTENANCE_MODE');

      // Administrador obtém bypass
      const adminDecision = engine.evaluateAccess(adminUser, maintServer);
      expect(adminDecision.allowed).toBe(true);
      expect(adminDecision.adminBypass).toBe(true);
    });

    it('Cenário 4: Política INDIVIDUAL concede acesso nominal e bloqueia outros', () => {
      const individualServer: ServerContext = {
        serverId: 'srv-duo',
        policy: 'INDIVIDUAL',
        allowedUserIds: ['usr-regular'],
      };

      const allowedDecision = engine.evaluateAccess(regularPlayer, individualServer);
      expect(allowedDecision.allowed).toBe(true);

      const otherPlayer: UserContext = {
        ...regularPlayer,
        userId: 'usr-other',
      };
      const deniedDecision = engine.evaluateAccess(otherPlayer, individualServer);
      expect(deniedDecision.allowed).toBe(false);
      expect(deniedDecision.reason).toBe('INDIVIDUAL_ACCESS_DENIED');
    });

    it('Cenário 5: Usuário inativo / revogado tem acesso sumariamente negado', () => {
      const inactiveUser: UserContext = {
        ...regularPlayer,
        isActive: false,
      };

      const publicServer: ServerContext = {
        serverId: 'srv-public',
        policy: 'PUBLIC',
      };

      const decision = engine.evaluateAccess(inactiveUser, publicServer);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('USER_INACTIVE');
    });
  });

  describe('Anti-Impersonation e Auto-Adoção (RF-ARQ-21)', () => {
    it('deve auto-adotar nickname no primeiro acesso de usuário sem nick cadastrado', () => {
      const result = engine.evaluateNickname('NovoJogador', undefined);
      expect(result.allowed).toBe(true);
      expect(result.autoAdopted).toBe(true);
    });

    it('deve aprovar login com nickname registrado (case-insensitive)', () => {
      const result = engine.evaluateNickname('STEVE_99', 'steve_99');
      expect(result.allowed).toBe(true);
      expect(result.autoAdopted).toBe(false);
    });

    it('deve rejeitar login com nickname de outro usuário (impersonação)', () => {
      const result = engine.evaluateNickname('Notch', 'HackerBoy');
      expect(result.allowed).toBe(false);
      expect(result.autoAdopted).toBe(false);
      expect(result.reason).toBe('IMPERSONATION_DETECTED');
    });

    it('deve rejeitar nickname malformado mesmo no primeiro acesso', () => {
      const result = engine.evaluateNickname('BadName!', undefined);
      expect(result.allowed).toBe(false);
      expect(result.autoAdopted).toBe(false);
      expect(result.reason).toBe('INVALID_CHARACTERS');
    });
  });
});
