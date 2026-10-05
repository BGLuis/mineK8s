import { LoggerRuleEngine } from './logger-rule-engine';

describe('LoggerRuleEngine', () => {
  it('should use default info level when no rules provided', () => {
    const engine = new LoggerRuleEngine();
    expect(engine.shouldLog('info')).toBe(true);
    expect(engine.shouldLog('warn')).toBe(true);
    expect(engine.shouldLog('error')).toBe(true);
    expect(engine.shouldLog('debug')).toBe(false);
    expect(engine.shouldLog('trace')).toBe(false);
  });

  it('should respect a single global log level', () => {
    const engine = new LoggerRuleEngine('debug');
    expect(engine.shouldLog('debug')).toBe(true);
    expect(engine.shouldLog('info')).toBe(true);
    expect(engine.shouldLog('trace')).toBe(false);
  });

  it('should apply context-specific log levels', () => {
    const engine = new LoggerRuleEngine(
      'context=*;level=info/context=KubernetesService;level=debug/context=AuthService;level=error',
    );

    // Global default
    expect(engine.shouldLog('debug', 'RandomService')).toBe(false);
    expect(engine.shouldLog('info', 'RandomService')).toBe(true);

    // KubernetesService (debug)
    expect(engine.shouldLog('debug', 'KubernetesService')).toBe(true);
    expect(engine.shouldLog('info', 'KubernetesService')).toBe(true);

    // AuthService (error only)
    expect(engine.shouldLog('warn', 'AuthService')).toBe(false);
    expect(engine.shouldLog('error', 'AuthService')).toBe(true);
  });

  it('should handle multi-context rules', () => {
    const engine = new LoggerRuleEngine('context=ServerA,ServerB;level=warn/context=*;level=info');
    expect(engine.shouldLog('info', 'ServerA')).toBe(false);
    expect(engine.shouldLog('warn', 'ServerA')).toBe(true);
    expect(engine.shouldLog('info', 'ServerB')).toBe(false);
    expect(engine.shouldLog('warn', 'ServerB')).toBe(true);
    expect(engine.shouldLog('info', 'ServerC')).toBe(true);
  });
});
