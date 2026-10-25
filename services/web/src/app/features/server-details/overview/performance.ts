import { ServerStatSample } from '../../../core/api/models';

export const TPS_TARGET = 20;

export type TpsLevel = 'success' | 'warning' | 'danger';

/** 18+ is a healthy tick rate, below 15 players feel the lag. */
export function tpsLevel(tps: number): TpsLevel {
  if (tps >= 18) {
    return 'success';
  }
  return tps >= 15 ? 'warning' : 'danger';
}

export function formatMemory(usedMb: number | null, limitMb: number | null): string {
  if (usedMb === null) {
    return '—';
  }
  const gib = (megabytes: number): string =>
    (megabytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return limitMb === null ? `${gib(usedMb)} GiB` : `${gib(usedMb)} / ${gib(limitMb)} GiB`;
}

/** TPS readings of the series, skipping samples where the server did not answer. */
export function tpsSeries(history: ServerStatSample[]): number[] {
  return history.flatMap((sample) => (sample.tps === null ? [] : [sample.tps]));
}

export const TICK_BUDGET_MS = 50;

export interface MetricVerdict {
  level: TpsLevel;
  text: string;
}

/** What each figure measures, shown under it in the panel. */
export const METRIC_HELP = {
  tps: 'Ticks por segundo: quantas vezes por segundo o mundo é atualizado (mobs, plantações, redstone). O normal é 20; abaixo disso tudo fica em câmera lenta.',
  mspt: 'Milissegundos que cada tick leva. Para manter 20 TPS, cada tick tem 50 ms; a folga mostra quanto o servidor aguenta antes de o TPS cair.',
  memory:
    'Memória do processo inteiro: o heap da JVM, que ela reserva e quase não devolve, mais o que usa fora dele. Ficar alto é normal; o risco é encostar no limite do container.',
} as const;

const percent = (value: number): string =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const decimal = (value: number): string =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function tpsVerdict(tps: number): MetricVerdict {
  const level = tpsLevel(tps);
  if (tps >= TPS_TARGET - 0.5) {
    return { level, text: `No alvo de ${TPS_TARGET}.` };
  }
  if (level === 'success') {
    return { level, text: 'Um pouco abaixo de 20, ainda imperceptível para quem joga.' };
  }
  if (level === 'warning') {
    return { level, text: 'Abaixo de 18 os jogadores já notam atraso.' };
  }
  return {
    level,
    text: `O jogo roda a ${percent((tps / TPS_TARGET) * 100)}% da velocidade normal.`,
  };
}

/** Above 60% of the budget a single spike is enough to drop TPS. */
export function msptVerdict(mspt: number | null, p99: number | null): MetricVerdict | null {
  if (mspt === null) {
    return null;
  }
  const used = (mspt / TICK_BUDGET_MS) * 100;
  if (mspt > TICK_BUDGET_MS) {
    return {
      level: 'danger',
      text: `Cada tick leva mais que ${TICK_BUDGET_MS} ms: o servidor não consegue manter ${TPS_TARGET} TPS.`,
    };
  }
  if (p99 !== null && p99 > TICK_BUDGET_MS) {
    return {
      level: 'warning',
      text: `A média está boa, mas 1% dos ticks passa de ${decimal(p99)} ms: são engasgos curtos, comuns na coleta de lixo da JVM, no salvamento do mundo ou na geração de chunks.`,
    };
  }
  if (used > 60) {
    return {
      level: 'warning',
      text: `Cada tick usa ${percent(used)}% dos ${TICK_BUDGET_MS} ms disponíveis: pouca folga, um pico já derruba o TPS.`,
    };
  }
  return {
    level: 'success',
    text: `Cada tick usa ${percent(used)}% dos ${TICK_BUDGET_MS} ms disponíveis: sobra folga.`,
  };
}

/**
 * The runner starts the JVM with -Xms equal to -Xmx and AlwaysPreTouch (modpacks bring their own flags, but
 * the JVM still keeps what it took), so high usage says little; the distance to the limit, where Kubernetes
 * kills the pod, is what matters.
 */
export function memoryVerdict(
  usedMb: number | null,
  limitMb: number | null,
  heapMb: number,
): MetricVerdict | null {
  if (usedMb === null || limitMb === null) {
    return null;
  }
  const used = usedMb / limitMb;
  const gib = (megabytes: number) => decimal(megabytes / 1024);
  if (used >= 0.95) {
    return {
      level: 'danger',
      text: `Em ${percent(used * 100)}% do limite: o Kubernetes encerra o servidor se passar (OOMKill). Aumente a memória ou reduza mods e plugins.`,
    };
  }
  if (used >= 0.9) {
    return {
      level: 'warning',
      text: `Em ${percent(used * 100)}% do limite: pouca margem para a JVM fora do heap (threads, buffers de rede, mods nativos).`,
    };
  }
  return {
    level: 'success',
    text: `Dentro do limite. Inclui o heap de ${gib(heapMb)} GiB, que a JVM reserva e quase não devolve; por isso o número não mostra quanto do heap está em uso.`,
  };
}
