import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class AddServerContentTable1710000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'server_content',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'server_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'path',
            type: 'varchar',
            length: '500',
            isNullable: false,
          },
          {
            name: 'sha1',
            type: 'varchar',
            length: '40',
            isNullable: true,
          },
          {
            name: 'sha512',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'origin',
            type: 'varchar',
            length: '20',
            default: "'MANUAL'",
            isNullable: false,
          },
          {
            name: 'source',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'project_id',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'version_id',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'loaders',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'server_content',
      new TableForeignKey({
        columnNames: ['server_id'],
        referencedTableName: 'servers',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'server_content',
      new TableIndex({
        name: 'uq_server_content_server_path',
        columnNames: ['server_id', 'path'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('server_content', true);
  }
}
