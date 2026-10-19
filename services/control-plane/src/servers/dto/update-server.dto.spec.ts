import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateServerDto } from './update-server.dto';

const invalidFields = async (body: object) =>
  (await validate(plainToInstance(UpdateServerDto, body))).map((e) => e.property);

describe('UpdateServerDto', () => {
  it('aceita atualização parcial dentro dos limites da criação', async () => {
    expect(
      await invalidFields({
        sleep_timeout_minutes: 1440,
        auto_wake: false,
        access_policy: 'PUBLIC',
      }),
    ).toEqual([]);
  });

  it('recusa timeout fora de 0 a 1440 minutos', async () => {
    expect(await invalidFields({ sleep_timeout_minutes: 1441 })).toEqual(['sleep_timeout_minutes']);
    expect(await invalidFields({ sleep_timeout_minutes: -1 })).toEqual(['sleep_timeout_minutes']);
  });

  it('recusa memória fora de 1 a 64 GiB, o mesmo intervalo da criação', async () => {
    expect(await invalidFields({ allocated_memory_mb: 1024 })).toEqual([]);
    expect(await invalidFields({ allocated_memory_mb: 65536 })).toEqual([]);
    expect(await invalidFields({ allocated_memory_mb: 1023 })).toEqual(['allocated_memory_mb']);
    expect(await invalidFields({ allocated_memory_mb: 65537 })).toEqual(['allocated_memory_mb']);
  });

  it('não deixa INTERNET passar por aqui, pois publicar exige DNS e online-mode', async () => {
    expect(await invalidFields({ access_policy: 'INTERNET' })).toEqual(['access_policy']);
  });

  it('valida campos de agendamento de backup (#205)', async () => {
    expect(
      await invalidFields({
        backup_schedule_mode: 'DAILY',
        backup_daily_time: '04:00',
        backup_interval_hours: 12,
        backup_window_start: '02:00',
        backup_window_end: '06:00',
        backup_retention_count: 5,
        backup_timezone: 'America/Sao_Paulo',
      }),
    ).toEqual([]);

    expect(await invalidFields({ backup_schedule_mode: 'INVALID' })).toEqual([
      'backup_schedule_mode',
    ]);
    expect(await invalidFields({ backup_daily_time: '25:00' })).toEqual(['backup_daily_time']);
    expect(await invalidFields({ backup_interval_hours: 0 })).toEqual(['backup_interval_hours']);
    expect(await invalidFields({ backup_retention_count: 0 })).toEqual(['backup_retention_count']);
    expect(await invalidFields({ backup_timezone: 'Invalid/Zone' })).toEqual(['backup_timezone']);
  });
});
